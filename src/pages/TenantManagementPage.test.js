import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TenantManagementPage from './TenantManagementPage';

const AUTH_TOKEN = 'test-token';

const packagesPayload = {
  packages: [
    {
      id: 'basic',
      employeeLimit: 25,
      concurrentLoginLimit: 2,
      modules: ['dashboard', 'attendance-time'],
    },
    {
      id: 'premium',
      employeeLimit: 100,
      concurrentLoginLimit: 8,
      modules: ['dashboard', 'attendance-time', 'payroll-management'],
    },
  ],
  modules: ['dashboard', 'attendance-time', 'payroll-management', 'leave-management'],
};

const subscriptionSettingsPayload = {
  settings: {
    currency: 'GHS',
    manualExtensionDays: 30,
    paymentGateways: {
      paystackEnabled: true,
    },
    plans: [
      {
        planKey: 'basic',
        label: 'Basic Plan',
        monthlyAmount: 120,
        periods: [
          { months: 1, days: 30, discountPercent: 0, amount: 120 },
          { months: 3, days: 90, discountPercent: 5, amount: 342 },
        ],
      },
      {
        planKey: 'premium',
        label: 'Premium Plan',
        monthlyAmount: 300,
        periods: [
          { months: 1, days: 30, discountPercent: 0, amount: 300 },
          { months: 6, days: 180, discountPercent: 10, amount: 1620 },
          { months: 12, days: 360, discountPercent: 15, amount: 3060 },
        ],
      },
    ],
  },
};

const tenantsPayload = {
  tenants: [
    {
      id: 'tenant-1',
      tenantId: 'acme',
      name: 'Acme Ghana',
      packageType: 'basic',
      planLabel: 'Basic Plan',
      employeeLimit: 25,
      concurrentLoginLimit: 2,
      subscriptionExpiresAt: '2026-10-10T00:00:00.000Z',
      subscriptionDaysRemaining: 32,
      status: 'active',
      grantedModules: ['dashboard', 'attendance-time'],
      activationCode: 'ACME12345678',
      periods: subscriptionSettingsPayload.settings.plans[0].periods,
    },
  ],
};

const paymentsPayload = {
  payments: [
    {
      reference: 'PAY-001',
      tenantId: 'acme',
      tenantName: 'Acme Ghana',
      provider: 'paystack',
      status: 'success',
      amount: 120,
      currency: 'GHS',
      daysAdded: 30,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
};

const tenantSubscriptionPayload = {
  tenant: {
    tenantId: 'acme',
    tenantName: 'Acme Ghana',
    planLabel: 'Basic Plan',
    subscriptionDaysRemaining: 32,
    subscriptionExpiresAt: '2026-10-10T00:00:00.000Z',
    activationCode: 'ACME12345678',
    currency: 'GHS',
    periods: subscriptionSettingsPayload.settings.plans[0].periods,
    subscriptionPricingOverrides: {
      month_3: 330,
    },
  },
  payments: [
    {
      reference: 'PAY-001',
      provider: 'paystack',
      status: 'success',
      amount: 120,
      currency: 'GHS',
      daysAdded: 30,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
};

const jsonResponse = (payload, ok = true) =>
  Promise.resolve({
    ok,
    json: async () => payload,
  });

const createDeferredResponse = () => {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const createFetchMock = (overrides = {}) =>
  jest.fn((url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const requestUrl = String(url);

    if (requestUrl.includes('/api/auth/tenants/') && requestUrl.includes('/subscription')) {
      if (method === 'GET') {
        return overrides.tenantSubscriptionGet || jsonResponse(tenantSubscriptionPayload);
      }
      if (method === 'PUT') {
        return overrides.tenantSubscriptionPut || jsonResponse(tenantSubscriptionPayload);
      }
    }

    if (requestUrl.endsWith('/api/auth/tenants')) {
      if (method === 'POST') {
        return overrides.createTenant || jsonResponse({ tenant: { tenantId: 'zenith' } });
      }
      return overrides.tenants || jsonResponse(tenantsPayload);
    }

    if (requestUrl.endsWith('/api/auth/tenant-packages')) {
      return overrides.packages || jsonResponse(packagesPayload);
    }

    if (requestUrl.endsWith('/api/auth/subscription/settings')) {
      if (method === 'PUT') {
        return overrides.saveSubscriptionSettings || jsonResponse(subscriptionSettingsPayload);
      }
      return overrides.subscriptionSettings || jsonResponse(subscriptionSettingsPayload);
    }

    if (requestUrl.endsWith('/api/auth/subscription/payments')) {
      return overrides.payments || jsonResponse(paymentsPayload);
    }

    if (requestUrl.includes('/api/auth/tenants/') && method === 'PUT') {
      return overrides.updateTenant || jsonResponse({ tenant: { tenantId: 'acme' } });
    }

    if (requestUrl.includes('/api/auth/tenants/') && method === 'DELETE') {
      return overrides.deleteTenant || jsonResponse({ success: true });
    }

    throw new Error(`Unhandled fetch: ${method} ${requestUrl}`);
  });

const renderPage = (props = {}) =>
  render(<TenantManagementPage authToken={AUTH_TOKEN} {...props} />);

describe('TenantManagementPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows loading state before tenant data resolves', async () => {
    const deferredTenants = createDeferredResponse();
    global.fetch = createFetchMock({
      tenants: deferredTenants.promise,
    });

    renderPage();

    expect(screen.getByText(/loading tenants/i)).toBeInTheDocument();

    deferredTenants.resolve(
      jsonResponse({
        tenants: tenantsPayload.tenants,
      })
    );

    expect(await screen.findByText(/Acme Ghana/i)).toBeInTheDocument();
  });

  test('renders tenant rows after successful loading', async () => {
    global.fetch = createFetchMock();

    renderPage();

    expect(await screen.findByText('acme')).toBeInTheDocument();
    expect(screen.getByText('Acme Ghana')).toBeInTheDocument();
    expect(screen.getByText('Basic Plan')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  test('renders empty tenant state when no tenants exist', async () => {
    global.fetch = createFetchMock({
      tenants: jsonResponse({ tenants: [] }),
      payments: jsonResponse({ payments: [] }),
    });

    renderPage();

    expect(await screen.findByText(/no tenants found/i)).toBeInTheDocument();
  });

  test('renders API failure state when loading fails', async () => {
    global.fetch = createFetchMock({
      tenants: jsonResponse({ error: 'boom' }, false),
    });

    renderPage();

    expect(await screen.findByText(/failed to load tenant subscription data/i)).toBeInTheDocument();
  });

  test('shows required create form fields and updates pricing periods when package changes', async () => {
    global.fetch = createFetchMock();

    renderPage();
    await screen.findByText('Acme Ghana');

    fireEvent.click(screen.getByRole('button', { name: /\+ add tenant/i }));

    expect(screen.getByLabelText(/tenant id/i)).toBeRequired();
    expect(screen.getByLabelText(/tenant name/i)).toBeRequired();
    expect(screen.getByLabelText(/default admin username/i)).toBeRequired();
    expect(screen.getByLabelText(/default admin password/i)).toBeRequired();

    expect(screen.getByText('90 days')).toBeInTheDocument();
    expect(screen.queryByText('180 days')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^package$/i), {
      target: { value: 'premium' },
    });

    expect(await screen.findByText('180 days')).toBeInTheDocument();
    expect(screen.getByText('360 days')).toBeInTheDocument();
  });

  test('creates a tenant successfully and submits normalized payload', async () => {
    const createTenant = jsonResponse({ tenant: { tenantId: 'zenith' } });
    global.fetch = createFetchMock({
      createTenant,
      tenants: jsonResponse({
        tenants: [
          ...tenantsPayload.tenants,
          {
            id: 'tenant-2',
            tenantId: 'zenith',
            name: 'Zenith Corp',
            packageType: 'premium',
            planLabel: 'Premium Plan',
            employeeLimit: 100,
            concurrentLoginLimit: 8,
            subscriptionExpiresAt: null,
            subscriptionDaysRemaining: 0,
            status: 'active',
            grantedModules: ['dashboard', 'attendance-time', 'payroll-management'],
          },
        ],
      }),
    });

    renderPage();
    await screen.findByText('Acme Ghana');

    fireEvent.click(screen.getByRole('button', { name: /\+ add tenant/i }));
    fireEvent.change(screen.getByLabelText(/tenant id/i), {
      target: { value: 'Zenith' },
    });
    fireEvent.change(screen.getByLabelText(/tenant name/i), {
      target: { value: 'Zenith Corp' },
    });
    fireEvent.change(screen.getByLabelText(/default admin username/i), {
      target: { value: 'superadmin' },
    });
    fireEvent.change(screen.getByLabelText(/default admin password/i), {
      target: { value: 'Pass1234' },
    });
    fireEvent.change(screen.getByLabelText(/^package$/i), {
      target: { value: 'premium' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create tenant/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/tenants'),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );
    });

    const createCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        String(url).includes('/api/auth/tenants') && String(options?.method || 'GET').toUpperCase() === 'POST'
    );
    const payload = JSON.parse(createCall[1].body);

    expect(payload.tenantId).toBe('zenith');
    expect(payload.name).toBe('Zenith Corp');
    expect(payload.packageType).toBe('premium');
    expect(payload.adminUsername).toBe('superadmin');
    expect(payload.adminPassword).toBe('Pass1234');

    expect(await screen.findByText('Zenith Corp')).toBeInTheDocument();
  });

  test('shows failed submission state when tenant creation fails', async () => {
    global.fetch = createFetchMock({
      createTenant: jsonResponse({ error: 'Tenant already exists' }, false),
    });

    renderPage();
    await screen.findByText('Acme Ghana');

    fireEvent.click(screen.getByRole('button', { name: /\+ add tenant/i }));
    fireEvent.change(screen.getByLabelText(/tenant id/i), {
      target: { value: 'acme-2' },
    });
    fireEvent.change(screen.getByLabelText(/tenant name/i), {
      target: { value: 'Acme 2' },
    });
    fireEvent.change(screen.getByLabelText(/default admin username/i), {
      target: { value: 'admin2' },
    });
    fireEvent.change(screen.getByLabelText(/default admin password/i), {
      target: { value: 'Pass1234' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create tenant/i }));

    expect(await screen.findByText(/tenant already exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create tenant/i })).toBeInTheDocument();
  });

  test('loads tenant subscription details and applies subscription updates', async () => {
    global.fetch = createFetchMock();

    renderPage();
    await screen.findByText('Acme Ghana');

    const tenantRow = screen.getByRole('row', { name: /acme acme ghana basic plan/i });
    fireEvent.click(within(tenantRow).getByRole('button', { name: /^subscription$/i }));

    expect(await screen.findByText(/tenant subscription/i)).toBeInTheDocument();
    expect(screen.getByText(/days remaining/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('ACME12345678')).toBeInTheDocument();
    expect(screen.queryByText(/no subscription history/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/use 1, -1, 30, -30/i), {
      target: { value: '15' },
    });
    fireEvent.change(screen.getByPlaceholderText(/admin note for the extension or deduction/i), {
      target: { value: 'Manual extension' },
    });
    fireEvent.click(screen.getByRole('button', { name: /apply changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/subscription'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.any(String),
        })
      );
    });

    const subscriptionCall = global.fetch.mock.calls.find(
      ([url, options]) =>
        String(url).includes('/subscription') && String(options?.method || 'GET').toUpperCase() === 'PUT'
    );
    const payload = JSON.parse(subscriptionCall[1].body);

    expect(payload.daysDelta).toBe(15);
    expect(payload.reason).toBe('Manual extension');
    expect(payload.activationCode).toBe('ACME12345678');
  });

  test('renders payment management summary and gateway controls', async () => {
    global.fetch = createFetchMock();

    renderPage();
    await screen.findByText('Acme Ghana');

    fireEvent.click(screen.getByRole('button', { name: /payment management/i }));

    expect(await screen.findByText(/payment gateway controls/i)).toBeInTheDocument();
    expect(screen.getByText(/total collected/i)).toBeInTheDocument();
    expect(screen.getAllByText('120')).toHaveLength(2);
    expect(screen.getByRole('row', { name: /acme ghana paystack success ghs120\.00 30 pay-001 2026-09-01/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
