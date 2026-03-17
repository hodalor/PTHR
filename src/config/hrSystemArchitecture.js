export const coreModules = [
  {
    id: 'auth-roles',
    name: 'Authentication & Roles',
    description: 'Secure login, role-based permissions, and access policies.',
    status: 'Foundation',
    priority: 'High',
  },
  {
    id: 'employee-management',
    name: 'Employee Management',
    description: 'Employee profiles, departments, positions, and lifecycle changes.',
    status: 'In Planning',
    priority: 'High',
  },
  {
    id: 'attendance-time',
    name: 'Attendance & Time Tracking',
    description: 'Shift logs, check-in/out, overtime, and attendance summaries.',
    status: 'In Planning',
    priority: 'High',
  },
  {
    id: 'fingerprint',
    name: 'Fingerprint',
    description: 'Employee fingerprint enrollment and biometric device synchronization.',
    status: 'In Planning',
    priority: 'High',
  },
  {
    id: 'leave-management',
    name: 'Leave Management',
    description: 'Leave policies, requests, approvals, and leave balance tracking.',
    status: 'In Planning',
    priority: 'High',
  },
  {
    id: 'payroll-management',
    name: 'Payroll Management',
    description: 'Salary setup, payroll cycles, deductions, and payslip generation.',
    status: 'In Planning',
    priority: 'High',
  },
  {
    id: 'documents-records',
    name: 'Documents & Records',
    description: 'Contracts, IDs, and employee document repository workflows.',
    status: 'In Planning',
    priority: 'Medium',
  },
  {
    id: 'reports-analytics',
    name: 'Reports & Analytics',
    description: 'Operational dashboards and exportable HR performance reports.',
    status: 'In Planning',
    priority: 'Medium',
  },
];

export const advancedModules = [
  {
    id: 'recruitment',
    name: 'Recruitment',
    description: 'Job postings, candidate pipeline, and interview tracking.',
    status: 'Backlog',
    priority: 'Medium',
  },
  {
    id: 'performance',
    name: 'Performance Evaluation',
    description: 'KPI templates, review cycles, and manager feedback.',
    status: 'Backlog',
    priority: 'Medium',
  },
  {
    id: 'training',
    name: 'Training Management',
    description: 'Learning plans, sessions, certifications, and progress metrics.',
    status: 'Backlog',
    priority: 'Low',
  },
];

export const systemPhases = [
  {
    phase: 'Phase 1',
    title: 'Foundation',
    items: ['Authentication & Roles', 'Employee Management', 'Attendance & Time Tracking', 'Fingerprint'],
  },
  {
    phase: 'Phase 2',
    title: 'Operations',
    items: ['Leave Management', 'Payroll Management', 'Documents & Records'],
  },
  {
    phase: 'Phase 3',
    title: 'Insights & Scale',
    items: ['Reports & Analytics', 'Recruitment', 'Performance Evaluation', 'Training Management'],
  },
];
