import { useEffect, useMemo, useState } from 'react';
import { toApiUrl } from '../config/api';

const buildInitialState = () => ({
  loading: false,
  saving: false,
  error: '',
  success: '',
  tenant: null,
  mode: 'manual',
  activationCode: '',
  email: '',
  selectedMonths: 1,
});

const formatMoney = (value, currency = 'GHS') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return `${currency}0.00`;
  }
  return `${currency}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function SubscriptionExtendModal({ open, tenantId, initialTenant = null, onClose, onSubscriptionUpdated }) {
  const [state, setState] = useState(buildInitialState);

  const periods = useMemo(() => (Array.isArray(state.tenant?.periods) ? state.tenant.periods : []), [state.tenant]);

  useEffect(() => {
    if (!open || !tenantId) {
      return;
    }
    let cancelled = false;
    const loadStatus = async () => {
      setState((prev) => ({
        ...prev,
        loading: true,
        error: '',
        success: '',
        tenant: initialTenant,
      }));
      try {
        const response = await fetch(
          toApiUrl(`http://localhost:8000/api/auth/subscription/public-status?tenantId=${encodeURIComponent(tenantId)}`)
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load subscription details');
        }
        if (cancelled) {
          return;
        }
        const tenant = data?.tenant || null;
        setState((prev) => ({
          ...prev,
          loading: false,
          tenant,
          selectedMonths: Number(tenant?.periods?.[0]?.months) || 1,
          email: prev.email || '',
        }));
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load subscription details',
          }));
        }
      }
    };
    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [initialTenant, open, tenantId]);

  useEffect(() => {
    if (!open) {
      setState(buildInitialState());
    }
  }, [open]);

  const handleManualExtend = async () => {
    if (!tenantId) {
      return;
    }
    setState((prev) => ({ ...prev, saving: true, error: '', success: '' }));
    try {
      const response = await fetch(toApiUrl('http://localhost:8000/api/auth/subscription/manual-extend'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          activationCode: state.activationCode,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to extend subscription');
      }
      setState((prev) => ({
        ...prev,
        saving: false,
        success: `30 days added successfully. ${data?.tenant?.subscriptionDaysRemaining ?? 0} day(s) remaining.`,
        tenant: data?.tenant || prev.tenant,
        activationCode: '',
      }));
      if (typeof onSubscriptionUpdated === 'function') {
        onSubscriptionUpdated(data?.tenant || null);
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        saving: false,
        error: error instanceof Error ? error.message : 'Failed to extend subscription',
      }));
    }
  };

  const handlePaystackPayment = async () => {
    if (!tenantId) {
      return;
    }
    setState((prev) => ({ ...prev, saving: true, error: '', success: '' }));
    try {
      const response = await fetch(toApiUrl('http://localhost:8000/api/auth/subscription/paystack/initialize'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          email: state.email,
          months: state.selectedMonths,
          returnUrl: typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '',
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to start payment');
      }
      if (data?.authorizationUrl && typeof window !== 'undefined') {
        window.location.assign(String(data.authorizationUrl));
        return;
      }
      throw new Error('Payment link not received');
    } catch (error) {
      setState((prev) => ({
        ...prev,
        saving: false,
        error: error instanceof Error ? error.message : 'Failed to start payment',
      }));
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3>Extend Subscription</h3>
          <button type="button" className="mini-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {state.loading ? <p>Loading subscription options...</p> : null}
        {state.error ? <p className="form-error">{state.error}</p> : null}
        {state.success ? (
          <p style={{ color: '#0a7a34', background: '#eaf8ef', borderRadius: 12, padding: '10px 12px' }}>{state.success}</p>
        ) : null}
        {state.tenant ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: 16,
                borderRadius: 18,
                background: '#f7faff',
              }}
            >
              <div>
                <strong>{state.tenant.tenantName}</strong>
                <div style={{ marginTop: 4, color: '#627493' }}>
                  {state.tenant.planLabel} •{' '}
                  {typeof state.tenant.subscriptionDaysRemaining === 'number'
                    ? `${state.tenant.subscriptionDaysRemaining} day(s) left`
                    : 'No expiry'}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#627493' }}>
                Expires: {state.tenant.subscriptionExpiresAt ? String(state.tenant.subscriptionExpiresAt).slice(0, 10) : 'No expiry'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={state.mode === 'manual' ? 'primary-btn' : 'neutral-btn'}
                onClick={() => setState((prev) => ({ ...prev, mode: 'manual' }))}
              >
                Manual Code
              </button>
              <button
                type="button"
                className={state.mode === 'payment' ? 'primary-btn' : 'neutral-btn'}
                onClick={() => setState((prev) => ({ ...prev, mode: 'payment' }))}
              >
                Make Payment
              </button>
            </div>

            {state.mode === 'manual' ? (
              <div className="settings-grid">
                <label style={{ gridColumn: '1 / -1' }}>
                  <span>12-Character Activation Code</span>
                  <input
                    value={state.activationCode}
                    maxLength={12}
                    onChange={(event) =>
                      setState((prev) => ({
                        ...prev,
                        activationCode: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
                      }))
                    }
                    placeholder="Enter your code"
                  />
                </label>
                <div className="panel-title-actions" style={{ gridColumn: '1 / -1' }}>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={state.saving || state.activationCode.length !== 12}
                    onClick={handleManualExtend}
                  >
                    {state.saving ? 'Applying...' : `Apply ${state.tenant.manualExtensionDays || 30} Days`}
                  </button>
                </div>
              </div>
            ) : null}

            {state.mode === 'payment' ? (
              <div style={{ display: 'grid', gap: 16 }}>
                <label>
                  <span>Payment Email</span>
                  <input
                    type="email"
                    value={state.email}
                    onChange={(event) =>
                      setState((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    placeholder="name@example.com"
                  />
                </label>
                <div>
                  <div style={{ marginBottom: 8, fontWeight: 700 }}>Choose Renewal Period</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    {periods.map((period) => (
                      <button
                        key={period.months}
                        type="button"
                        className="neutral-btn"
                        style={{
                          textAlign: 'left',
                          background: Number(state.selectedMonths) === Number(period.months) ? '#dfe9ff' : '#f8fbff',
                          border:
                            Number(state.selectedMonths) === Number(period.months)
                              ? '1px solid #92aff2'
                              : '1px solid #d7e1f1',
                        }}
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            selectedMonths: Number(period.months),
                          }))
                        }
                      >
                        <strong>{period.days} days</strong>
                        <div style={{ marginTop: 4, color: '#627493', fontSize: 13 }}>
                          {period.months} month(s) • {formatMoney(period.amount, state.tenant.currency)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="panel-title-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={state.saving || !state.email || !state.tenant.paymentGateways?.paystackEnabled}
                    onClick={handlePaystackPayment}
                  >
                    {state.saving ? 'Redirecting...' : 'Pay With Paystack'}
                  </button>
                </div>
                {!state.tenant.paymentGateways?.paystackEnabled ? (
                  <div className="login-hint">Paystack is currently disabled for subscription payments.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
