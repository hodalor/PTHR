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
  activationCode: '',
  status: 'active',
  adminUsername: '',
  adminPassword: '',
  adminFullName: '',
});

const buildDefaultSubscriptionForm = () => ({
  currency: 'GHS',
  manualExtensionDays: 30,
  paymentGateways: {
    paystackEnabled: true,
  },
  plans: [],
});

const formatMoney = (value, currency = 'GHS') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return `${currency}0.00`;
  }
  return `${currency}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDateLabel = (value) => {
  if (!value) {
    return 'No expiry';
  }
  return String(value).slice(0, 10);
};

export default function TenantManagementPage({ authToken }) {
  const [activeTab, setActiveTab] = useState('tenants');
  const [tenants, setTenants] = useState([]);
  const [packages, setPackages] = useState([]);
  const [allModules, setAllModules] = useState([]);
  const [subscriptionForm, setSubscriptionForm] = useState(buildDefaultSubscriptionForm);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const [activationCodeRefreshing, setActivationCodeRefreshing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTenantId, setEditingTenantId] = useState('');
  const [selectedPlanKey, setSelectedPlanKey] = useState('basic');
  const [form, setForm] = useState(() => buildInitialForm([]));
  const [tenantSubscriptionModal, setTenantSubscriptionModal] = useState({
    open: false,
    loading: false,
    saving: false,
    tenantId: '',
    tenant: null,
    payments: [],
    error: '',
    daysDelta: '',
    activationCode: '',
    reason: '',
  });

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }),
    [authToken]
  );

  const activePackage = useMemo(
    () => packages.find((item) => item.id === form.packageType) || packages[0] || null,
    [form.packageType, packages]
  );

  const selectedPlan = useMemo(
    () => subscriptionForm.plans.find((plan) => plan.planKey === selectedPlanKey) || subscriptionForm.plans[0] || null,
    [selectedPlanKey, subscriptionForm.plans]
  );

  const paymentSummary = useMemo(() => {
    return payments.reduce(
      (acc, payment) => {
        const amount = Number(payment?.amount) || 0;
        acc.totalCollected += amount;
        acc.transactions += 1;
        if (String(payment?.provider || '').toLowerCase() === 'paystack') {
          acc.paystackCollected += amount;
        } else if (String(payment?.provider || '').toLowerCase() === 'manual-code') {
          acc.manualCount += 1;
        }
        return acc;
      },
      { totalCollected: 0, transactions: 0, paystackCollected: 0, manualCount: 0 }
    );
  }, [payments]);

  const isEditing = Boolean(editingTenantId);

  const loadData = useCallback(async () => {
    if (!authToken) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [tenantResponse, packageResponse, subscriptionResponse, paymentResponse] = await Promise.all([
        fetch(toApiUrl('http://localhost:8000/api/auth/tenants'), {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(toApiUrl('http://localhost:8000/api/auth/tenant-packages'), {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(toApiUrl('http://localhost:8000/api/auth/subscription/settings'), {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        fetch(toApiUrl('http://localhost:8000/api/auth/subscription/payments'), {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);
      if (!tenantResponse.ok || !packageResponse.ok || !subscriptionResponse.ok || !paymentResponse.ok) {
        throw new Error('Failed to load tenant subscription data');
      }
      const tenantData = await tenantResponse.json();
      const packageData = await packageResponse.json();
      const subscriptionData = await subscriptionResponse.json();
      const paymentData = await paymentResponse.json();
      const packageRows = Array.isArray(packageData.packages) ? packageData.packages : [];
      setTenants(Array.isArray(tenantData.tenants) ? tenantData.tenants : []);
      setPackages(packageRows);
      setAllModules(Array.isArray(packageData.modules) ? packageData.modules : []);
      setSubscriptionForm(subscriptionData.settings || buildDefaultSubscriptionForm());
      setPayments(Array.isArray(paymentData.payments) ? paymentData.payments : []);
      setSelectedPlanKey((prev) => prev || subscriptionData?.settings?.plans?.[0]?.planKey || 'basic');
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
    setActivationCodeRefreshing(false);
    setForm(buildInitialForm(packages));
    setError('');
    setSaving(false);
  };

  const closeTenantSubscriptionModal = () => {
    setTenantSubscriptionModal({
      open: false,
      loading: false,
      saving: false,
      tenantId: '',
      tenant: null,
      payments: [],
      error: '',
      daysDelta: '',
      activationCode: '',
      reason: '',
    });
  };

  const openCreateModal = () => {
    setEditingTenantId('');
    setActivationCodeRefreshing(false);
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
      activationCode: String(tenant.activationCode || '').toUpperCase(),
      status: tenant.status === 'inactive' ? 'inactive' : 'active',
      adminUsername: '',
      adminPassword: '',
      adminFullName: '',
    });
    setIsModalOpen(true);
  };

  const openTenantSubscriptionModal = async (tenantId) => {
    if (!tenantId || !authToken) {
      return;
    }
    setTenantSubscriptionModal((prev) => ({
      ...prev,
      open: true,
      loading: true,
      tenantId,
      error: '',
    }));
    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/auth/tenants/${encodeURIComponent(tenantId)}/subscription`),
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load tenant subscription');
      }
      setTenantSubscriptionModal({
        open: true,
        loading: false,
        saving: false,
        tenantId,
        tenant: data?.tenant || null,
        payments: Array.isArray(data?.payments) ? data.payments : [],
        error: '',
        daysDelta: '',
        activationCode: String(data?.tenant?.activationCode || ''),
        reason: '',
      });
    } catch (loadError) {
      setTenantSubscriptionModal((prev) => ({
        ...prev,
        loading: false,
        error: loadError instanceof Error ? loadError.message : 'Failed to load tenant subscription',
      }));
    }
  };

  const toggleModule = (moduleId) => {
    setForm((prev) => ({
      ...prev,
      grantedModules: prev.grantedModules.includes(moduleId)
        ? prev.grantedModules.filter((item) => item !== moduleId)
        : [...prev.grantedModules, moduleId],
    }));
  };

  const updateSelectedPlan = (updater) => {
    setSubscriptionForm((prev) => ({
      ...prev,
      plans: prev.plans.map((plan) => (plan.planKey === selectedPlanKey ? updater(plan) : plan)),
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
      activationCode: String(form.activationCode || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 12),
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
        headers: authHeaders,
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

  const handleRefreshEditActivationCode = async () => {
    if (!authToken || !editingTenantId) {
      return;
    }
    setActivationCodeRefreshing(true);
    setError('');
    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/auth/tenants/${encodeURIComponent(editingTenantId)}/subscription`),
        {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({
            daysDelta: 0,
            activationCode: form.activationCode,
            regenerateActivationCode: true,
            reason: 'Regenerated from tenant detail page',
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to regenerate activation code');
      }
      const nextCode = String(data?.tenant?.activationCode || '').toUpperCase();
      setForm((prev) => ({
        ...prev,
        activationCode: nextCode || prev.activationCode,
      }));
      await loadData();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to regenerate activation code');
    } finally {
      setActivationCodeRefreshing(false);
    }
  };

  const handleDeleteTenant = async (tenant) => {
    if (!authToken || !tenant?.tenantId || tenant.tenantId === 'master') {
      return;
    }
    const shouldDelete = window.confirm(
      `Delete tenant "${tenant.tenantId}"?\n\nThis will permanently delete the tenant database and all tenant data.`
    );
    if (!shouldDelete) {
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/auth/tenants/${encodeURIComponent(tenant.tenantId)}`),
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to delete tenant');
      }
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete tenant');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSubscriptionSettings = async () => {
    if (!authToken) {
      return;
    }
    setSubscriptionSaving(true);
    setError('');
    try {
      const response = await fetch(toApiUrl('http://localhost:8000/api/auth/subscription/settings'), {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(subscriptionForm),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save subscription settings');
      }
      setSubscriptionForm(data?.settings || subscriptionForm);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save subscription settings');
    } finally {
      setSubscriptionSaving(false);
    }
  };

  const handleSaveTenantSubscription = async (options = {}) => {
    if (!authToken || !tenantSubscriptionModal.tenantId) {
      return;
    }
    setTenantSubscriptionModal((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/auth/tenants/${encodeURIComponent(tenantSubscriptionModal.tenantId)}/subscription`),
        {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({
            daysDelta: tenantSubscriptionModal.daysDelta ? Number(tenantSubscriptionModal.daysDelta) : 0,
            activationCode: tenantSubscriptionModal.activationCode,
            regenerateActivationCode: Boolean(options.regenerateActivationCode),
            reason: tenantSubscriptionModal.reason,
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to update tenant subscription');
      }
      setTenantSubscriptionModal((prev) => ({
        ...prev,
        saving: false,
        tenant: data?.tenant || prev.tenant,
        activationCode: String(data?.tenant?.activationCode || prev.activationCode || ''),
        daysDelta: '',
        reason: '',
      }));
      await loadData();
      await openTenantSubscriptionModal(tenantSubscriptionModal.tenantId);
    } catch (saveError) {
      setTenantSubscriptionModal((prev) => ({
        ...prev,
        saving: false,
        error: saveError instanceof Error ? saveError.message : 'Failed to update tenant subscription',
      }));
    }
  };

  return (
    <section className="panel">
      <div className="panel-title-row">
        <div>
          <h2>Tenant Management</h2>
          <p>Create isolated tenant databases, configure subscriptions, and control payment renewals.</p>
        </div>
        <div className="panel-title-actions">
          {activeTab === 'tenants' ? (
            <button type="button" className="primary-btn" onClick={openCreateModal}>
              + Add Tenant
            </button>
          ) : (
            <button
              type="button"
              className="primary-btn"
              onClick={handleSaveSubscriptionSettings}
              disabled={subscriptionSaving}
            >
              {subscriptionSaving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      <div className="settings-tab-strip" style={{ marginBottom: 18 }}>
        {[
          { id: 'tenants', label: 'Tenants' },
          { id: 'subscription', label: 'Subscription Management' },
          { id: 'payments', label: 'Payment Management' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`settings-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && !isModalOpen ? <p className="form-error">{error}</p> : null}

      {activeTab === 'tenants' ? (
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
                    <td>{tenant.planLabel || tenant.packageType}</td>
                    <td>{tenant.employeeLimit}</td>
                    <td>{tenant.concurrentLoginLimit}</td>
                    <td>
                      {tenant.subscriptionExpiresAt
                        ? `${formatDateLabel(tenant.subscriptionExpiresAt)} (${tenant.subscriptionDaysRemaining ?? 0}d)`
                        : 'No expiry'}
                    </td>
                    <td>{tenant.status || 'active'}</td>
                    <td>
                      <button type="button" className="mini-btn" onClick={() => openEditModal(tenant)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="mini-btn"
                        style={{ marginLeft: 8 }}
                        onClick={() => openTenantSubscriptionModal(tenant.tenantId)}
                      >
                        Subscription
                      </button>
                      <button
                        type="button"
                        className="mini-btn"
                        style={{ marginLeft: 8, background: '#ffe7ec', color: '#9a1f33' }}
                        onClick={() => handleDeleteTenant(tenant)}
                        disabled={saving || tenant.tenantId === 'master'}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === 'subscription' ? (
        <div className="settings-grid">
          <label>
            <span>Billing Currency</span>
            <input
              value={subscriptionForm.currency || 'GHS'}
              onChange={(event) =>
                setSubscriptionForm((prev) => ({
                  ...prev,
                  currency: event.target.value.toUpperCase(),
                }))
              }
            />
          </label>
          <label>
            <span>Manual Extension Days</span>
            <input
              type="number"
              min="1"
              value={subscriptionForm.manualExtensionDays || 30}
              onChange={(event) =>
                setSubscriptionForm((prev) => ({
                  ...prev,
                  manualExtensionDays: Number(event.target.value) || 30,
                }))
              }
            />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <span className="field-title">Subscription Plans</span>
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18 }}>
              <div style={{ display: 'grid', gap: 10 }}>
                {subscriptionForm.plans.map((plan) => (
                  <button
                    key={plan.planKey}
                    type="button"
                    className="neutral-btn"
                    style={{
                      textAlign: 'left',
                      background: selectedPlanKey === plan.planKey ? '#dfe9ff' : '#f7f9ff',
                      border: selectedPlanKey === plan.planKey ? '1px solid #93b0f5' : '1px solid #d8e1f3',
                    }}
                    onClick={() => setSelectedPlanKey(plan.planKey)}
                  >
                    <strong>{plan.label}</strong>
                    <div style={{ fontSize: 13, color: '#5d6f91', marginTop: 4 }}>
                      {plan.planKey} • {formatMoney(plan.monthlyAmount, subscriptionForm.currency)}
                      {' / month'}
                    </div>
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gap: 14 }}>
                {selectedPlan ? (
                  <>
                    <div className="settings-grid">
                      <label>
                        <span>Plan Key</span>
                        <input value={selectedPlan.planKey} disabled />
                      </label>
                      <label>
                        <span>Plan Label</span>
                        <input
                          value={selectedPlan.label}
                          onChange={(event) =>
                            updateSelectedPlan((plan) => ({
                              ...plan,
                              label: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Monthly Amount</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={selectedPlan.monthlyAmount}
                          onChange={(event) =>
                            updateSelectedPlan((plan) => ({
                              ...plan,
                              monthlyAmount: Number(event.target.value) || 0,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div>
                      <div className="panel-title-row" style={{ marginBottom: 10 }}>
                        <div>
                          <h3 style={{ marginBottom: 4 }}>Renewal Periods</h3>
                          <p style={{ margin: 0 }}>Configure what tenants can pay for from 30 days to 12 months.</p>
                        </div>
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() =>
                            updateSelectedPlan((plan) => ({
                              ...plan,
                              periods: [
                                ...(Array.isArray(plan.periods) ? plan.periods : []),
                                { months: 1, days: 30, discountPercent: 0, amount: plan.monthlyAmount || 0 },
                              ],
                            }))
                          }
                        >
                          Add Period
                        </button>
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Months</th>
                              <th>Discount %</th>
                              <th>Amount After Discount</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedPlan.periods || []).map((period, index) => (
                              <tr key={`${selectedPlan.planKey}-${index}`}>
                                <td>
                                  <input
                                    type="number"
                                    min="1"
                                    max="12"
                                    value={period.months}
                                    onChange={(event) =>
                                      updateSelectedPlan((plan) => ({
                                        ...plan,
                                        periods: plan.periods.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                months: Number(event.target.value) || 1,
                                                days: (Number(event.target.value) || 1) * 30,
                                              }
                                            : item
                                        ),
                                      }))
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    value={period.discountPercent}
                                    onChange={(event) =>
                                      updateSelectedPlan((plan) => ({
                                        ...plan,
                                        periods: plan.periods.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                discountPercent: Number(event.target.value) || 0,
                                              }
                                            : item
                                        ),
                                      }))
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={period.amount}
                                    onChange={(event) =>
                                      updateSelectedPlan((plan) => ({
                                        ...plan,
                                        periods: plan.periods.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                amount: Number(event.target.value) || 0,
                                              }
                                            : item
                                        ),
                                      }))
                                    }
                                  />
                                  <div style={{ fontSize: 12, color: '#6d7d9a', marginTop: 4 }}>
                                    {formatMoney(period.amount, subscriptionForm.currency)}
                                  </div>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="mini-btn"
                                    style={{ background: '#fff0f2', color: '#b42338' }}
                                    onClick={() =>
                                      updateSelectedPlan((plan) => ({
                                        ...plan,
                                        periods: plan.periods.filter((_, itemIndex) => itemIndex !== index),
                                      }))
                                    }
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'payments' ? (
        <div style={{ display: 'grid', gap: 18 }}>
          <section className="panel" style={{ padding: 18 }}>
            <div className="panel-title-row">
              <div>
                <h3 style={{ marginBottom: 4 }}>Payment Gateway Controls</h3>
                <p style={{ margin: 0 }}>Enable only the payment methods tenants should see when extending subscriptions.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              <div
                style={{
                  border: '1px solid #d9e3f4',
                  borderRadius: 16,
                  padding: 16,
                  background: '#fbfdff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <strong>Paystack</strong>
                    <div style={{ fontSize: 13, color: '#687998', marginTop: 4 }}>
                      Hosted checkout for card and supported Paystack channels.
                    </div>
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(subscriptionForm.paymentGateways?.paystackEnabled)}
                      onChange={(event) =>
                        setSubscriptionForm((prev) => ({
                          ...prev,
                          paymentGateways: {
                            ...(prev.paymentGateways || {}),
                            paystackEnabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>{subscriptionForm.paymentGateways?.paystackEnabled ? 'On' : 'Off'}</span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <div className="panel" style={{ padding: 18 }}>
              <div style={{ color: '#7687a8', fontSize: 14 }}>Total Collected</div>
              <div style={{ fontSize: 34, fontWeight: 800 }}>{paymentSummary.totalCollected.toLocaleString()}</div>
            </div>
            <div className="panel" style={{ padding: 18 }}>
              <div style={{ color: '#7687a8', fontSize: 14 }}>Transactions</div>
              <div style={{ fontSize: 34, fontWeight: 800 }}>{paymentSummary.transactions}</div>
            </div>
            <div className="panel" style={{ padding: 18 }}>
              <div style={{ color: '#7687a8', fontSize: 14 }}>Paystack Collected</div>
              <div style={{ fontSize: 34, fontWeight: 800 }}>{paymentSummary.paystackCollected.toLocaleString()}</div>
            </div>
            <div className="panel" style={{ padding: 18 }}>
              <div style={{ color: '#7687a8', fontSize: 14 }}>Manual Activations</div>
              <div style={{ fontSize: 34, fontWeight: 800 }}>{paymentSummary.manualCount}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Days Added</th>
                  <th>Reference</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No payment history yet.</td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.reference}>
                      <td>{payment.tenantName || payment.tenantId}</td>
                      <td>{payment.provider}</td>
                      <td>{payment.status}</td>
                      <td>{formatMoney(payment.amount, payment.currency || subscriptionForm.currency)}</td>
                      <td>{payment.daysAdded}</td>
                      <td style={{ fontFamily: 'monospace' }}>{payment.reference}</td>
                      <td>{formatDateLabel(payment.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

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
              {isEditing ? (
                <label>
                  <span>Activation Code</span>
                  <div className="tenant-code-field">
                    <input
                      className="tenant-code-input"
                      value={form.activationCode}
                      maxLength={12}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          activationCode: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
                        }))
                      }
                      placeholder="12-character code"
                    />
                    <button
                      type="button"
                      className="neutral-btn tenant-code-refresh-btn"
                      onClick={handleRefreshEditActivationCode}
                      disabled={activationCodeRefreshing || saving}
                      title="Generate a new unique activation code"
                      aria-label="Generate a new unique activation code"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M20 12a8 8 0 1 1-2.34-5.66"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M20 4v6h-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </label>
              ) : null}
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

      {tenantSubscriptionModal.open ? (
        <div className="modal-backdrop" onClick={closeTenantSubscriptionModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 920 }}>
            <div className="modal-header">
              <h3>Tenant Subscription</h3>
              <button type="button" className="mini-btn" onClick={closeTenantSubscriptionModal}>
                Close
              </button>
            </div>
            {tenantSubscriptionModal.loading ? <p>Loading tenant subscription...</p> : null}
            {tenantSubscriptionModal.error ? <p className="form-error">{tenantSubscriptionModal.error}</p> : null}
            {tenantSubscriptionModal.tenant ? (
              <div style={{ display: 'grid', gap: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                  <div className="panel" style={{ padding: 16 }}>
                    <div style={{ color: '#7383a0', fontSize: 13 }}>Tenant</div>
                    <strong>{tenantSubscriptionModal.tenant.tenantName}</strong>
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div style={{ color: '#7383a0', fontSize: 13 }}>Plan</div>
                    <strong>{tenantSubscriptionModal.tenant.planLabel}</strong>
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div style={{ color: '#7383a0', fontSize: 13 }}>Days Remaining</div>
                    <strong>{tenantSubscriptionModal.tenant.subscriptionDaysRemaining ?? 0}</strong>
                  </div>
                  <div className="panel" style={{ padding: 16 }}>
                    <div style={{ color: '#7383a0', fontSize: 13 }}>Expiry</div>
                    <strong>{formatDateLabel(tenantSubscriptionModal.tenant.subscriptionExpiresAt)}</strong>
                  </div>
                </div>

                <div className="settings-grid">
                  <label>
                    <span>Activation Code</span>
                    <div className="tenant-code-field">
                      <input
                        className="tenant-code-input"
                        value={tenantSubscriptionModal.activationCode}
                        maxLength={12}
                        onChange={(event) =>
                          setTenantSubscriptionModal((prev) => ({
                            ...prev,
                            activationCode: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="neutral-btn tenant-code-refresh-btn"
                        onClick={() => handleSaveTenantSubscription({ regenerateActivationCode: true })}
                        disabled={tenantSubscriptionModal.saving}
                        title="Generate a new unique activation code"
                        aria-label="Generate a new unique activation code"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M20 12a8 8 0 1 1-2.34-5.66"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M20 4v6h-6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </label>
                  <label>
                    <span>Add or Remove Days</span>
                    <input
                      type="number"
                      value={tenantSubscriptionModal.daysDelta}
                      onChange={(event) =>
                        setTenantSubscriptionModal((prev) => ({
                          ...prev,
                          daysDelta: event.target.value,
                        }))
                      }
                      placeholder="Use 1, -1, 30, -30"
                    />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>
                    <span>Reason</span>
                    <input
                      value={tenantSubscriptionModal.reason}
                      onChange={(event) =>
                        setTenantSubscriptionModal((prev) => ({
                          ...prev,
                          reason: event.target.value,
                        }))
                      }
                      placeholder="Admin note for the extension or deduction"
                    />
                  </label>
                </div>

                <div className="panel-title-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => handleSaveTenantSubscription()}
                    disabled={tenantSubscriptionModal.saving}
                  >
                    {tenantSubscriptionModal.saving ? 'Saving...' : 'Apply Changes'}
                  </button>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Status</th>
                        <th>Amount</th>
                        <th>Days</th>
                        <th>Reference</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenantSubscriptionModal.payments.length === 0 ? (
                        <tr>
                          <td colSpan={6}>No subscription history for this tenant yet.</td>
                        </tr>
                      ) : (
                        tenantSubscriptionModal.payments.map((payment) => (
                          <tr key={payment.reference}>
                            <td>{payment.provider}</td>
                            <td>{payment.status}</td>
                            <td>{formatMoney(payment.amount, payment.currency || subscriptionForm.currency)}</td>
                            <td>{payment.daysAdded}</td>
                            <td style={{ fontFamily: 'monospace' }}>{payment.reference}</td>
                            <td>{formatDateLabel(payment.createdAt)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
