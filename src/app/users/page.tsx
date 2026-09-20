'use client';

import React, { useState, useEffect } from 'react';
import { Users, Plus, KeyRound, CheckCircle2, ShieldAlert, Check, Minus, Trash2, Power } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateTime } from '@/lib/utils';
import { User, UserRole, Depot } from '@/types/erp';
import ImageUploadField from '@/components/ui/ImageUploadField';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { SearchInput, Input, Select } from '@/components/ui/Input';
import { Drawer, Modal, ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const DEFAULT_PASSWORD = 'ChangeMe@Arib2026!';

const ROLE_OPTIONS: { label: string; value: UserRole }[] = [
  { label: 'Super Admin', value: 'SUPER_ADMIN' },
  { label: 'Manager', value: 'MANAGER' },
  { label: 'ERP User', value: 'ERP_USER' },
  { label: 'Depot User', value: 'DEPOT_USER' },
];

const ROLE_TONE: Record<string, 'primary' | 'info' | 'warning' | 'neutral'> = {
  SUPER_ADMIN: 'primary',
  MANAGER: 'info',
  ERP_USER: 'neutral',
  DEPOT_USER: 'warning',
};

interface UserFormState {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  assignedDepotId: string;
  phone: string;
  avatar: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export default function UsersManagementPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormState>({
    name: '',
    email: '',
    password: DEFAULT_PASSWORD,
    role: 'DEPOT_USER',
    assignedDepotId: '',
    phone: '',
    avatar: '',
    status: 'ACTIVE',
  });
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState(DEFAULT_PASSWORD);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async (query = '') => {
    try {
      const q = query.trim();
      const usersUrl = q ? `/api/users?q=${encodeURIComponent(q)}` : '/api/users';
      const [usersRes, depotsRes] = await Promise.all([fetch(usersUrl), fetch('/api/depots')]);
      const usersData = usersRes.ok ? await usersRes.json() : [];
      const depotsData = depotsRes.ok ? await depotsRes.json() : [];
      setUsers(Array.isArray(usersData) ? usersData : []);
      setDepots(Array.isArray(depotsData) ? depotsData : []);
    } catch {
      toast({ title: 'Unable to load users', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(debouncedSearch);
  }, [debouncedSearch]);

  const openCreate = () => {
    setForm({
      name: '',
      email: '',
      password: DEFAULT_PASSWORD,
      role: 'DEPOT_USER',
      assignedDepotId: depots[0]?.id || '',
      phone: '',
      avatar: '',
      status: 'ACTIVE',
    });
    setFormError('');
    setDrawerMode('create');
  };

  const openEdit = (u: User) => {
    setEditingUser(u);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      assignedDepotId: u.assignedDepotId || depots[0]?.id || '',
      phone: u.phone || '',
      avatar: u.avatar || '',
      status: u.status,
    });
    setFormError('');
    setDrawerMode('edit');
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingUser(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.name.trim() || !form.email.trim()) {
      setFormError('Name and email are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isEdit = drawerMode === 'edit' && editingUser;
      const depot = depots.find((d) => d.id === form.assignedDepotId);
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        assignedDepotId: form.role === 'DEPOT_USER' ? form.assignedDepotId : undefined,
        assignedDepotName: form.role === 'DEPOT_USER' && depot ? depot.name : undefined,
        phone: form.phone.trim(),
        avatar: form.avatar.trim(),
        status: form.status,
      };
      if (!isEdit) payload.password = form.password || DEFAULT_PASSWORD;

      const res = await fetch(isEdit ? `/api/users/${editingUser.id}` : '/api/users', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${isEdit ? 'update' : 'create'} user`);
      }

      toast({ title: isEdit ? 'User updated' : 'User created', variant: 'success' });
      await loadData(debouncedSearch);
      closeDrawer();
    } catch (err: any) {
      setFormError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to change user status');
      }
      toast({
        title: nextStatus === 'ACTIVE' ? 'User activated' : 'User deactivated',
        variant: 'success',
      });
      await loadData(debouncedSearch);
    } catch (err: any) {
      toast({ title: err.message || 'Status change failed', variant: 'error' });
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError('');
    setIsResetting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: resetTarget.id, newPassword: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      toast({ title: `Password reset for ${resetTarget.name}`, variant: 'success' });
      setResetTarget(null);
      setResetPassword(DEFAULT_PASSWORD);
    } catch (err: any) {
      setResetError(err.message || 'Failed to reset password');
    } finally {
      setIsResetting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');
      toast({ title: `${deleteTarget.name} removed`, variant: 'success' });
      setDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.assignedDepotName || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader
        title="Users & Roles"
        description="System operators, role-based access control, and depot assignments."
        actions={
          activeTab === 'users' ? (
            <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
              New User
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 h-9 rounded-full px-3.5 text-xs font-semibold transition-colors ${
            activeTab === 'users'
              ? 'bg-ink text-white'
              : 'bg-white text-ink-secondary border border-line hover:bg-surface'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>Team Members ({users.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`flex items-center gap-2 h-9 rounded-full px-3.5 text-xs font-semibold transition-colors ${
            activeTab === 'roles'
              ? 'bg-ink text-white'
              : 'bg-white text-ink-secondary border border-line hover:bg-surface'
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>Roles & Permissions Matrix</span>
        </button>
      </div>

      {activeTab === 'roles' ? (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 border-l-4 border-l-primary bg-white">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink">Super Admin</span>
                <Badge tone="primary">Full Access</Badge>
              </div>
              <p className="text-xs text-muted mt-2 leading-relaxed">
                Unrestricted administrative and executive control. User management, settings, financial profit reports, and multi-depot overview.
              </p>
            </Card>
            <Card className="p-4 border-l-4 border-l-sky-500 bg-white">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink">Manager</span>
                <Badge tone="info">Operations Lead</Badge>
              </div>
              <p className="text-xs text-muted mt-2 leading-relaxed">
                Full sales, billing, inventory, and logistics authorization. Can create proformas, approve invoices, and dispatch shipments.
              </p>
            </Card>
            <Card className="p-4 border-l-4 border-l-slate-400 bg-white">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink">ERP User</span>
                <Badge tone="neutral">Sales & Orders</Badge>
              </div>
              <p className="text-xs text-muted mt-2 leading-relaxed">
                Front-office sales representative. Generates quotations and proformas, views catalog pricing and customer records.
              </p>
            </Card>
            <Card className="p-4 border-l-4 border-l-amber-500 bg-white">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink">Depot User</span>
                <Badge tone="warning">Warehouse Only</Badge>
              </div>
              <p className="text-xs text-muted mt-2 leading-relaxed">
                Sandboxed to their assigned physical depot. Barcode scanner UI, shelf item picking, packing validation, and airway bill handover.
              </p>
            </Card>
          </div>

          <Card className="overflow-hidden p-0 border-0 rounded-none bg-transparent">
            <div className="px-5 py-3.5 bg-surface border-b border-line">
              <h3 className="text-xs font-bold text-ink uppercase tracking-wider">Access Control Matrix</h3>
            </div>
            <Table>
              <TableHeader>
                <TableHead>Functional Module</TableHead>
                <TableHead>Super Admin</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>ERP User</TableHead>
                <TableHead>Depot User</TableHead>
              </TableHeader>
              <TableBody>
                {[
                  { module: 'Sales & Proformas', desc: 'Quotations, proforma invoices, email sending, converting to tax invoice', sa: 'Full Access', m: 'Full Access', eu: 'Full Access', du: 'None' },
                  { module: 'Tax Invoices & Billing', desc: 'Tax invoices, service invoices, financial PDFs, payment tracking', sa: 'Full Access', m: 'Full Access', eu: 'View Only', du: 'None' },
                  { module: 'Product Catalog & Pricing', desc: 'Product specs, pricing, margins, barcode generation, bulk import', sa: 'Full Access', m: 'Full Access', eu: 'View Only', du: 'Stock Only' },
                  { module: 'Inventory & Serial Tracking', desc: 'Multi-warehouse stock, serial tracking, transfers, stock adjustments', sa: 'Full Access', m: 'Full Access', eu: 'View Only', du: 'Assigned Depot' },
                  { module: 'Depot & Fulfilment', desc: 'Barcode scanning, order picking, packing station, shipment dispatch', sa: 'Full Access', m: 'Full Access', eu: 'None', du: 'Assigned Depot' },
                  { module: 'Shipments & Airway Bills', desc: 'AWB generation, carrier tracking, delivery confirmation', sa: 'Full Access', m: 'Full Access', eu: 'View Only', du: 'Assigned Depot' },
                  { module: 'Financial Reports & Analytics', desc: 'Profitability, sales analytics, gross margin reports, inventory value', sa: 'Full Access', m: 'Full Access', eu: 'None', du: 'None' },
                  { module: 'Users & Administration', desc: 'Team member accounts, role assignment, audit logs, system settings', sa: 'Full Access', m: 'None', eu: 'None', du: 'None' },
                ].map((row) => (
                  <TableRow key={row.module}>
                    <TableCell>
                      <div className="font-semibold text-ink text-xs">{row.module}</div>
                      <div className="text-[11px] text-muted mt-0.5">{row.desc}</div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <Check className="h-3 w-3" /> {row.sa}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${
                        row.m === 'Full Access' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-muted bg-surface border-line'
                      }`}>
                        {row.m === 'Full Access' ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />} {row.m}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${
                        row.eu === 'Full Access' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : row.eu === 'View Only' ? 'text-sky-700 bg-sky-50 border-sky-200' : 'text-muted bg-surface border-line'
                      }`}>
                        {row.eu === 'Full Access' ? <Check className="h-3 w-3" /> : row.eu === 'View Only' ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />} {row.eu}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${
                        row.du.includes('Assigned') ? 'text-amber-700 bg-amber-50 border-amber-200' : row.du === 'Stock Only' ? 'text-sky-700 bg-sky-50 border-sky-200' : 'text-muted bg-surface border-line'
                      }`}>
                        {row.du === 'None' ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />} {row.du}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <SearchInput
              placeholder="Search name, email, or depot..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              wrapperClassName="w-full sm:w-80"
            />
            <Select
              options={[{ label: 'All roles', value: 'ALL' }, ...ROLE_OPTIONS]}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              wrapperClassName="w-full sm:w-44"
            />
            <span className="text-xs text-muted sm:ml-auto">{filteredUsers.length} users</span>
          </div>

          {loading ? (
            <SkeletonTable rows={5} cols={6} />
          ) : filteredUsers.length === 0 ? (
            <EmptyState
              icon={Users}
              title={users.length === 0 ? 'No users yet' : 'No matching users'}
              description={
                users.length === 0
                  ? 'Add team members and assign their roles to control access.'
                  : 'No users match your search or role filter.'
              }
              action={
                users.length === 0 && (
                  <Button iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
                    Add User
                  </Button>
                )
              }
            />
          ) : (
            <>
            <Card className="hidden md:block overflow-hidden p-0 border-0 rounded-none bg-transparent">
              <Table>
                <TableHeader>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Depot</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Action</TableHead>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} src={u.avatar} size="sm" />
                          <div className="min-w-0">
                            <div className="font-semibold text-ink truncate">{u.name}</div>
                            <div className="text-xs text-muted truncate mt-0.5">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge tone={ROLE_TONE[u.role] || 'neutral'}>{u.role.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-muted">
                        {u.role === 'DEPOT_USER' ? u.assignedDepotName || '—' : 'All depots'}
                      </TableCell>
                      <TableCell className="text-muted text-xs">
                        {u.lastLogin ? formatDateTime(u.lastLogin) : 'Never'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={u.status} />
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleStatus(u)}
                            className={u.status === 'ACTIVE' ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}
                            title={u.status === 'ACTIVE' ? 'Deactivate user' : 'Activate user'}
                          >
                            {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setResetTarget(u)}>
                            Reset
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted hover:text-danger hover:bg-danger-soft px-2"
                            onClick={() => setDeleteTarget(u)}
                            title="Delete User"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <div className="md:hidden space-y-3">
              {filteredUsers.map((u) => (
                <Card key={u.id} className="p-4 space-y-2.5">
                  <div className="flex items-start gap-3">
                    <Avatar name={u.name} src={u.avatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink truncate">{u.name}</div>
                      <div className="text-xs text-muted truncate">{u.email}</div>
                    </div>
                    <StatusBadge status={u.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line-soft">
                    <Badge tone={ROLE_TONE[u.role] || 'neutral'}>{u.role.replace(/_/g, ' ')}</Badge>
                    <span className="text-muted">
                      {u.role === 'DEPOT_USER' ? u.assignedDepotName || '—' : 'All depots'}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted">
                    Last login: {u.lastLogin ? formatDateTime(u.lastLogin) : 'Never'}
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleStatus(u)}
                      className={u.status === 'ACTIVE' ? 'text-amber-600' : 'text-emerald-600'}
                    >
                      {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setResetTarget(u)}>
                      Reset
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                      Edit
                    </Button>
                    <IconButton
                      label="Delete User"
                      className="text-muted hover:text-danger hover:bg-danger-soft"
                      onClick={() => setDeleteTarget(u)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </Card>
              ))}
            </div>
            </>
          )}
        </>
      )}

      <Drawer
        open={drawerMode !== null}
        onClose={closeDrawer}
        width="md"
        title={drawerMode === 'edit' ? `Edit ${editingUser?.name || 'User'}` : 'New User'}
        description={
          drawerMode === 'edit'
            ? 'Update role, depot assignment, and account status.'
            : 'Create a system account and assign its access level.'
        }
        footer={
          <>
            {drawerMode === 'edit' && editingUser && (
              <Button
                variant="destructive"
                onClick={() => setDeleteTarget(editingUser)}
                disabled={isSubmitting}
                className="mr-auto"
              >
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={closeDrawer} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" loading={isSubmitting} iconLeft={!isSubmitting ? <CheckCircle2 className="h-4 w-4" /> : undefined}>
              {drawerMode === 'edit' ? 'Save Changes' : 'Create User'}
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          {formError && (
            <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
              {formError}
            </div>
          )}

          <Input
            label="Full Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Alex Morgan"
          />
          <Input
            label="Work Email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="alex@aribglobal.com"
          />
          <Input
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+971 4 800 0100"
          />

          {drawerMode === 'create' && (
            <Input
              label="Initial Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              hint="The user should change this after first sign-in."
            />
          )}

          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
          />

          {form.role === 'DEPOT_USER' && (
            <Select
              label="Assigned Depot"
              options={depots.map((d) => ({ label: d.name, value: d.id }))}
              value={form.assignedDepotId}
              onChange={(e) => setForm({ ...form, assignedDepotId: e.target.value })}
              hint="Depot users can only access data for their assigned depot."
            />
          )}

          {drawerMode === 'edit' && (
            <Select
              label="Account Status"
              options={[
                { label: 'Active', value: 'ACTIVE' },
                { label: 'Inactive', value: 'INACTIVE' },
              ]}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}
            />
          )}

          <ImageUploadField
            label="Profile Photo"
            value={form.avatar}
            onChange={(url) => setForm({ ...form, avatar: url })}
          />
        </form>
      </Drawer>

      {/* Reset Password Modal */}
      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title={`Reset Password for ${resetTarget?.name || 'User'}`}
        description="Set a new temporary password for this user. They should change it upon next login."
        footer={
          <>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={isResetting}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} loading={isResetting} iconLeft={<KeyRound className="h-4 w-4" />}>
              Save Password
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {resetError && (
            <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
              {resetError}
            </div>
          )}
          <Input
            label="New Password"
            type="text"
            required
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            hint="Minimum 8 characters with letters, numbers, and symbols recommended."
          />
        </div>
      </Modal>

      {/* Delete User Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Remove ${deleteTarget?.name || 'user'}?`}
        description="This permanently removes the account and revokes all access. This cannot be undone."
        confirmLabel="Remove User"
        destructive
        loading={isDeleting}
      />
    </div>
  );
}
