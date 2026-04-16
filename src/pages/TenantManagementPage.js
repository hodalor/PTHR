import { useCallback, useEffect, useMemo, useState } from 'react';
import { toApiUrl } from '../config/api';

const buildInitialForm = (packages) => ({
  tenantId: '',
  name: '',
  packageType: packages[0]?.id || 'basic',
  grantedModules: Array.isArray(packages[0]?.modules) ? packages[0].modules : [],
  employeeLimitOverride: '',
  concurrentLoginLimitOverride: '',
  subscriptionExpiresAt: '',
  status: 'active',
  adminUsername: '',
  adminPassword: '',
  adminFullName: '',
});

export default function TenantManagementPage({ authToken }) {
  const [tenants, setTenants] = useState([]);
  const [packages, setPackages] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTenantId, setEditingTenantId] = useState('');
  const [form, setForm] = useState(() => buildInitialForm([]));

  const activePackage = useMemo(
    () => packages.find((item) => item.id === form.packageType) || packages[0] || null,
    [form.packageType, packages]
  );

  const isEditing = Boolean(editingTenantId);

  const loadData = useCallback(async () => {
    if (!authToken) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [tenantResponse, packageResponse] = await Promise.all([
        fetch(toApiUrl('http://localhost:8000/api/auth/tenants'), {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(toApiUrl('http://localhost:8000/api/auth/tenant-packages'), {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);
      if (!tenantResponse.ok || !packageResponse.ok) {
        throw new Error('Failed to load tenant data');
      }
      const tenantData = await tenantResponse.json();
      const packageData = await packageResponse.json();
      const packageRows = Array.isArray(packageData.packages) ? packageData.packages : [];
      setTenants(Array.isArray(tenantData.tenants) ? tenantData.tenants : []);
      setPackages(packageRows);
      setAllModules(Array.isArray(packageData.modules) ? packageData.modules : []);
      setForm((prev) => (prev.tenantId || isEditing ? prev : buildInitialForm(packageRows)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load tenant data');
    } finally {
      setLoading(false);
    }
  }, [authToken, isEditing]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTenantId('');
    setForm(buildInitialForm(packages));
    setError('');
    setSaving(false);
  };

  const openCreateModal = () => {
    setEditingTenantId('');
    setForm(buildInitialForm(packages));
    setIsModalOpen(true);
  };

  const openEditModal = (tenant) => {
    setEditingTenantId(tenant.tenantId);
    setForm({
      tenantId: tenant.tenantId,
      name: tenant.name || tenant.tenantId,
      packageType: tenant.packageType || 'basic',
      grantedModules: Array.isArray(tenant.grantedModules) ? tenant.grantedModules : [],
      employeeLimitOverride: tenant.employeeLimitOverride ? String(tenant.employeeLimitOverride) : '',
      concurrentLoginLimitOverride: tenant.concurrentLoginLimitOverride ? String(tenant.concurrentLoginLimitOverride) : '',
      subscriptionExpiresAt: tenant.subscriptionExpiresAt ? String(tenant.subscriptionExpiresAt).slice(0, 10) : '',
      status: tenant.status === 'inactive' ? 'inactive' : 'active',
      adminUsername: '',
      adminPassword: '',
      adminFullName: '',
    });
    setIsModalOpen(true);
  };

  const toggleModule = (moduleId) => {
    setForm((prev) => ({
      ...prev,
      grantedModules: prev.grantedModules.includes(moduleId)
        ? prev.grantedModules.filter((item) => item !== moduleId)
        : [...prev.grantedModules, moduleId],
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!authToken) {
      setError('Authentication is required');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      tenantId: form.tenantId.trim().toLowerCase(),
      name: form.name.trim(),
      employeeLimitOverride: form.employeeLimitOverride ? Number(form.employeeLimitOverride) : null,
      concurrentLoginLimitOverride: form.concurrentLoginLimitOverride ? Number(form.concurrentLoginLimitOverride) : null,
      subscriptionExpiresAt: form.subscriptionExpiresAt || null,
    };
    if (isEditing) {
      delete payload.adminUsername;
      delete payload.adminPassword;
      delete payload.adminFullName;
    }
    try {
      const endpoint = isEditing
        ? toApiUrl(`http://localhost:8000/api/auth/tenants/${encodeURIComponent(editingTenantId)}`)
        : toApiUrl('http://localhost:8000/api/auth/tenants');
      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Failed to ${isEditing ? 'update' : 'create'} tenant`);
      }
      await loadData();
      closeModal();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Failed to ${isEditing ? 'update' : 'create'} tenant`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-title-row">
        <div>
          <h2>Tenant Management</h2>
          <p>Create isolated tenant databases, override plan limits, and manage feature grants.</p>
        </div>
        <div className="panel-title-actions">
          <button type="button" className="primary-btn" onClick={openCreateModal}>
            + Add Tenant
          </button>
        </div>
      </div>
      {error && !isModalOpen ? <p className="form-error">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tenant ID</th>
              <th>Name</th>
              <th>Package</th>
              <th>Employee Limit</th>
              <th>Concurrent Logins</th>
              <th>Subscription</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}>Loading tenants...</td>
              </tr>
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={8}>No tenants found.</td>
              </tr>
            ) : (
              tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>{tenant.tenantId}</td>
                  <td>{tenant.name}</td>
                  <td>{tenant.packageType}</td>
                  <td>{tenant.employeeLimit}</td>
                  <td>{tenant.concurrentLoginLimit}</td>
                  <td>
                    {tenant.subscriptionExpiresAt
                      ? `${String(tenant.subscriptionExpiresAt).slice(0, 10)} (${tenant.subscriptionDaysRemaining ?? 0}d)`
                      : 'No expiry'}
                  </td>
                  <td>{tenant.status || 'active'}</td>
                  <td>
                    <button type="button" className="mini-btn" onClick={() => openEditModal(tenant)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{isEditing ? 'Edit Tenant' : 'Create Tenant'}</h3>
              <button type="button" className="mini-btn" onClick={closeModal}>
                Close
              </button>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <form className="settings-grid" onSubmit={handleSubmit}>
              <label>
                <span>Tenant ID</span>
                <input
                  value={form.tenantId}
                  onChange={(event) => setForm((prev) => ({ ...prev, tenantId: event.target.value.toLowerCase() }))}
                  placeholder="acme-ghana"
                  disabled={isEditing}
                  required
                />
              </label>
              <label>
                <span>Tenant Name</span>
                <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
              </label>
              <label>
                <span>Package</span>
                <select value={form.packageType} onChange={(event) => setForm((prev) => ({ ...prev, packageType: event.target.value }))}>
                  {packages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </label>
              <label>
                <span>Employee Limit Override</span>
                <input
                  type="number"
                  min="1"
                  value={form.employeeLimitOverride}
                  onChange={(event) => setForm((prev) => ({ ...prev, employeeLimitOverride: event.target.value }))}
                  placeholder={`Default: ${activePackage?.employeeLimit ?? 'n/a'}`}
                />
              </label>
              <label>
                <span>Concurrent Login Override</span>
                <input
                  type="number"
                  min="1"
                  value={form.concurrentLoginLimitOverride}
                  onChange={(event) => setForm((prev) => ({ ...prev, concurrentLoginLimitOverride: event.target.value }))}
                  placeholder={`Default: ${activePackage?.concurrentLoginLimit ?? 'n/a'}`}
                />
              </label>
              <label>
                <span>Subscription Expiry</span>
                <input
                  type="date"
                  value={form.subscriptionExpiresAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, subscriptionExpiresAt: event.target.value }))}
                />
              </label>
              {!isEditing ? (
                <>
                  <label>
                    <span>Default Admin Username</span>
                    <input
                      value={form.adminUsername}
                      onChange={(event) => setForm((prev) => ({ ...prev, adminUsername: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    <span>Default Admin Full Name</span>
                    <input
                      value={form.adminFullName}
                      onChange={(event) => setForm((prev) => ({ ...prev, adminFullName: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Default Admin Password</span>
                    <input
                      type="password"
                      value={form.adminPassword}
                      onChange={(event) => setForm((prev) => ({ ...prev, adminPassword: event.target.value }))}
                      required
                    />
                  </label>
                </>
              ) : null}
              <div style={{ gridColumn: '1 / -1' }}>
                <span className="field-title">Feature Grants (super admin override, regardless of plan)</span>
                <div className="currency-list">
                  {allModules.map((moduleId) => {
                    const selected = form.grantedModules.includes(moduleId);
                    return (
                      <button
                        key={moduleId}
                        type="button"
                        className="neutral-btn"
                        style={{
                          background: selected ? '#dfe9ff' : '#ecf1fb',
                          border: selected ? '1px solid #9db8f3' : undefined,
                        }}
                        onClick={() => toggleModule(moduleId)}
                      >
                        {selected ? '✓ ' : ''}
                        {moduleId}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="panel-title-actions" style={{ gridColumn: '1 / -1' }}>
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? 'Saving...' : isEditing ? 'Update Tenant' : 'Create Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
