import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
  prismaHealthy: boolean;
  prismaLastCheck: number;
};

// Track whether the DB is reachable so we can skip slow queries
// and fall back to dataStore immediately.
if (globalForPrisma.prismaHealthy === undefined) {
  globalForPrisma.prismaHealthy = true; // optimistic start
  globalForPrisma.prismaLastCheck = 0;
}

const HEALTH_RECHECK_MS = 60_000; // re-probe DB every 60 seconds after a failure

export function isDbOffline(): boolean {
  if (globalForPrisma.prismaHealthy) return false;
  // If enough time has passed since the last failure, allow one re-probe
  if (Date.now() - globalForPrisma.prismaLastCheck > HEALTH_RECHECK_MS) {
    globalForPrisma.prismaHealthy = true; // allow re-probe
    return false;
  }
  return true; // offline
}

export function markDbOffline(): void {
  if (globalForPrisma.prismaHealthy) {
    console.warn('\n[Prisma] Database marked as OFFLINE due to timeout. Future requests will instantly fall back to dataStore for 60s.\n');
  }
  globalForPrisma.prismaHealthy = false;
  globalForPrisma.prismaLastCheck = Date.now();
}

export function markDbOnline(): void {
  globalForPrisma.prismaHealthy = true;
}

const realPrisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = realPrisma;

// We wrap the PrismaClient in a Proxy.
// When any method (e.g. prisma.user.findUnique) is called, it returns a Promise.
// We intercept that Promise. If the DB is known to be offline, we reject INSTANTLY (0ms).
// Otherwise, we race the real Prisma promise against a short timeout.
export const prisma = new Proxy(realPrisma, {
  get(target, prop) {
    const value = Reflect.get(target, prop);
    
    if (typeof value === 'function') {
      return function (...args: any[]) {
        return value.apply(target, args);
      };
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return new Proxy(value, {
        get(modelTarget, modelProp) {
          const modelValue = Reflect.get(modelTarget, modelProp);
          if (typeof modelValue === 'function') {
            return function (...args: any[]) {
              if (isDbOffline()) {
                return Promise.reject(new Error('Database is offline (cached), bypassing Prisma'));
              }
              const realPromise = modelValue.apply(modelTarget, args);
              
              let timer: NodeJS.Timeout;
              const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                  markDbOffline();
                  reject(new Error('Database query timed out (fast proxy)'));
                }, 1500); // 1.5-second HARD timeout
              });

              return Promise.race([realPromise, timeoutPromise]).finally(() => {
                clearTimeout(timer);
              });
            };
          }
          return modelValue;
        }
      });
    }
    return value;
  }
}) as PrismaClient;

/**
 * True when `err` is a genuine response FROM the database (a real constraint
 * violation, missing row, etc.) rather than a connectivity/timeout failure.
 * Prisma's known request errors always carry a `.code` like "P2003"
 * (foreign key constraint) or "P2025" (record not found); the offline/
 * timeout errors thrown by the proxy above are plain Errors with no `.code`.
 * Callers should surface these to the user instead of silently falling
 * back to the dataStore mirror — the record was NOT deleted/changed.
 */
export function isPrismaConstraintError(err: unknown): err is { code: string; meta?: any } {
  return Boolean(
    err &&
      typeof err === 'object' &&
      typeof (err as any).code === 'string' &&
      /^P2\d{3}$/.test((err as any).code)
  );
}

/** Friendly message for the common delete-blocking constraint codes. */
export function prismaConstraintMessage(err: { code: string }, entityLabel: string): string {
  if (err.code === 'P2025') return `${entityLabel} was already deleted or could not be found.`;
  if (err.code === 'P2003' || err.code === 'P2014') {
    return `Cannot delete this ${entityLabel.toLowerCase()} because other records (orders, invoices, or history) still reference it.`;
  }
  return `Could not delete this ${entityLabel.toLowerCase()} because of a database constraint.`;
}

export async function withDbTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = 1500
): Promise<T> {
  // The fast proxy already handles the timeout and rejection instantly!
  // We just return the operation directly to keep the API compatible.
  return operation();
}
