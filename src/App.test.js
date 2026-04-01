import { render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

test('renders login screen when not authenticated', () => {
  render(<App />);
  expect(screen.getByText(/sign in to continue/i)).toBeInTheDocument();
});

const getTodayIsoDateForTest = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createAuthPayload = (user, lastModuleId) => ({
  token: 'test-token',
  user,
  lastModuleId,
});

test('employee sees only own leave requests', async () => {
  const employeeUser = {
    id: 'user-1',
    username: 'amina',
    fullName: 'Amina Yusuf',
    role: 'employee',
    employeeId: 'HR00000001',
  };
  window.localStorage.setItem(
    'pthr_auth',
    JSON.stringify(createAuthPayload(employeeUser, 'leave-management'))
  );

  const leaveRecords = [
    {
      id: 'LEV-EMP-1',
      employee: 'Amina Yusuf',
      employeeId: 'HR00000001',
      department: 'Human Resources',
      type: 'Annual',
      startDate: '2026-01-10',
      endDate: '2026-01-12',
      daysRequested: '3',
      status: 'Approved',
      departmentApproval: 'Approved',
      managerApproval: 'Approved',
      hrApproval: 'Approved',
    },
    {
      id: 'LEV-OTHER-1',
      employee: 'Liam Osei',
      employeeId: 'IT00000004',
      department: 'Information Technology',
      type: 'Annual',
      startDate: '2026-01-15',
      endDate: '2026-01-16',
      daysRequested: '2',
      status: 'Approved',
      departmentApproval: 'Approved',
      managerApproval: 'Approved',
      hrApproval: 'Approved',
    },
  ];

  global.fetch = jest.fn((url) => {
    if (typeof url === 'string' && url.endsWith('/health')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok', mongo: 'connected' }),
      });
    }
    if (
      typeof url === 'string' &&
      url.endsWith('/api/modules/leave-management')
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ records: leaveRecords }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    });
  });

  render(<App initialModuleId="leave-management" />);

  const ownRow = await screen.findByText(/Amina Yusuf \(HR00000001\)/i);
  expect(ownRow).toBeInTheDocument();
  expect(screen.queryByText(/Liam Osei/i)).not.toBeInTheDocument();
});

test('employee sees only own attendance logs for today', async () => {
  const employeeUser = {
    id: 'user-2',
    username: 'amina',
    fullName: 'Amina Yusuf',
    role: 'employee',
    employeeId: 'HR00000001',
  };
  window.localStorage.setItem(
    'pthr_auth',
    JSON.stringify(createAuthPayload(employeeUser, 'attendance-time'))
  );

  const today = getTodayIsoDateForTest();

  const attendanceRecords = [
    {
      id: 'ATT-EMP-1',
      employee: 'Amina Yusuf',
      employeeId: 'HR00000001',
      date: today,
      shift: 'Morning',
      checkIn: '08:05',
      checkOut: '17:01',
      status: 'On Time',
      lateMinutes: 0,
    },
    {
      id: 'ATT-OTHER-1',
      employee: 'David Kimani',
      employeeId: 'EN00000002',
      date: today,
      shift: 'Morning',
      checkIn: '08:30',
      checkOut: '17:05',
      status: 'Late',
      lateMinutes: 10,
    },
  ];

  global.fetch = jest.fn((url) => {
    if (typeof url === 'string' && url.endsWith('/health')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok', mongo: 'connected' }),
      });
    }
    if (
      typeof url === 'string' &&
      url.endsWith('/api/modules/attendance-time')
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ records: attendanceRecords }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    });
  });

  render(<App initialModuleId="attendance-time" />);

  const employeeCell = await screen.findByText(
    /Amina Yusuf \(HR00000001\)/i
  );
  expect(employeeCell).toBeInTheDocument();
  expect(screen.queryByText(/David Kimani/i)).not.toBeInTheDocument();
});

test('employee sees only own loan records', async () => {
  const employeeUser = {
    id: 'user-3',
    username: 'amina',
    fullName: 'Amina Yusuf',
    role: 'employee',
    employeeId: 'HR00000001',
  };
  window.localStorage.setItem(
    'pthr_auth',
    JSON.stringify(createAuthPayload(employeeUser, 'loan-records'))
  );

  const loanRecords = [
    {
      id: 'LON-EMP-1',
      employee: 'Amina Yusuf',
      employeeId: 'HR00000001',
      type: 'Salary Advance',
      amount: '2500',
      issuedOn: '2026-01-18',
      balance: '1200',
      status: 'Active',
    },
    {
      id: 'LON-OTHER-1',
      employee: 'Liam Osei',
      employeeId: 'IT00000011',
      type: 'Medical Loan',
      amount: '4000',
      issuedOn: '2026-01-20',
      balance: '600',
      status: 'Active',
    },
  ];

  global.fetch = jest.fn((url) => {
    if (typeof url === 'string' && url.endsWith('/health')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok', mongo: 'connected' }),
      });
    }
    if (
      typeof url === 'string' &&
      url.endsWith('/api/modules/loan-records')
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ records: loanRecords }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    });
  });

  render(<App initialModuleId="loan-records" />);

  const ownRow = await screen.findByText(/Amina Yusuf/i);
  expect(ownRow).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.queryByText(/Liam Osei/i)).not.toBeInTheDocument();
  });
});
