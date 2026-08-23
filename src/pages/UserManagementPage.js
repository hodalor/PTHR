import { useCallback, useEffect, useMemo, useState } from 'react';
import { sidebarSections } from '../config/moduleUiData';
import { toApiUrl } from '../config/api';

const roleModulePresets = {
  employee: ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual'],
  manager: ['employee-management', 'attendance-time', 'leave-management', 'monitoring-tracking', 'manual'],
  hr: ['employee-management', 'attendance-time', 'loan-records', 'leave-management', 'reports-analytics', 'user-management', 'manual'],
  admin: sidebarSections
    .flatMap((section) => section.items.map((item) => item.id))
    .filter((moduleId) => moduleId !== 'tenant-management'),
  'tenant-admin': sidebarSections
    .flatMap((section) => section.items.map((item) => item.id))
    .filter((moduleId) => moduleId !== 'tenant-management'),
};

const normalizeModuleList = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

const areModuleListsEqual = (left, right) => {
  const leftList = [...new Set(normalizeModuleList(left))].sort();
  const rightList = [...new Set(normalizeModuleList(right))].sort();
  if (leftList.length !== rightList.length) {
    return false;
  }
  return leftList.every((item, index) => item === rightList[index]);
};

const getDefaultModulesForRole = (role) => [...(roleModulePresets[String(role || '').trim().toLowerCase()] || [])];

const buildInitialFormValues = () => ({
  username: '',
  fullName: '',
  password: '',
  role: 'employee',
  employeeId: '',
  allowedModules: getDefaultModulesForRole('employee'),
  isActive: 'Active',
});

function UserManagementPage({ authToken, currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formValues, setFormValues] = useState(buildInitialFormValues);
  const [editingUserId, setEditingUserId] = useState('');

  const allModuleOptions = useMemo(
    () =>
      sidebarSections.flatMap((section) =>
        section.items.map((item) => ({
          value: item.id,
          label: item.label,
        }))
      ),
    []
  );
  const moduleLabelMap = useMemo(
    () =>
      allModuleOptions.reduce((accumulator, option) => {
        accumulator[option.value] = option.label;
        return accumulator;
      }, {}),
    [allModuleOptions]
  );
  const normalizedRole = String(currentUser?.role || '').toLowerCase();
  const isMasterSuperAdmin =
    normalizedRole === 'superadmin' && String(currentUser?.tenantId || '').toLowerCase() === 'master';
  const currentUserAllowedModules = useMemo(() => {
    if (isMasterSuperAdmin) {
      return allModuleOptions.map((option) => option.value);
    }
    return normalizeModuleList(currentUser?.allowedModules);
  }, [allModuleOptions, currentUser?.allowedModules, isMasterSuperAdmin]);
  const assignableModuleOptions = useMemo(() => {
    if (isMasterSuperAdmin) {
      return allModuleOptions;
    }
    const allowedSet = new Set(currentUserAllowedModules);
    return allModuleOptions.filter((option) => allowedSet.has(option.value));
  }, [allModuleOptions, currentUserAllowedModules, isMasterSuperAdmin]);
  const assignableRoles = useMemo(() => {
    if (isMasterSuperAdmin) {
      return [
        { value: 'employee', label: 'Employee' },
        { value: 'manager', label: 'Manager' },
        { value: 'hr', label: 'HR' },
        { value: 'admin', label: 'Admin' },
        { value: 'tenant-admin', label: 'Tenant Admin' },
        { value: 'superadmin', label: 'Super Admin' },
      ];
    }
    if (normalizedRole === 'admin' || normalizedRole === 'tenant-admin') {
      return [
        { value: 'employee', label: 'Employee' },
        { value: 'manager', label: 'Manager' },
        { value: 'hr', label: 'HR' },
      ];
    }
    if (normalizedRole === 'manager' || normalizedRole === 'hr') {
      return [{ value: 'employee', label: 'Employee' }];
    }
    return [{ value: 'employee', label: 'Employee' }];
  }, [isMasterSuperAdmin, normalizedRole]);
  const editingUser = useMemo(
    () => users.find((user) => String(user.id) === String(editingUserId)) || null,
    [editingUserId, users]
  );

  const fetchUsers = useCallback(async () => {
      if (!authToken) {
        return;
      }
      setLoading(true);
      setError('');
      try {
        const response = await fetch(toApiUrl('http://localhost:8000/api/auth/users'), {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (!response.ok) {
          setError('Unable to load users');
          setUsers([]);
          return;
        }
        const data = await response.json();
        setUsers(Array.isArray(data.users) ? data.users : []);
      } catch (fetchError) {
        setError('Unable to reach server');
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }, [authToken]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleChange = (field, value) => {
    setFormValues((prev) => {
      if (field === 'role') {
        const previousRole = String(prev.role || '').trim().toLowerCase();
        const previousModules = normalizeModuleList(prev.allowedModules);
        const previousPreset = getDefaultModulesForRole(previousRole);
        const nextModules =
          previousModules.length === 0 || areModuleListsEqual(previousModules, previousPreset)
            ? getDefaultModulesForRole(value)
            : previousModules;
        return {
          ...prev,
          role: value,
          allowedModules: nextModules,
        };
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const resetForm = () => {
    setEditingUserId('');
    setError('');
    setFormValues(buildInitialFormValues());
  };

  const startEdit = (user) => {
    setEditingUserId(String(user.id || ''));
    setError('');
    setFormValues({
      username: String(user.username || ''),
      fullName: String(user.fullName || ''),
      password: '',
      role: String(user.role || 'employee'),
      employeeId: String(user.employeeId || ''),
      allowedModules: normalizeModuleList(user.allowedModules),
      isActive: user.isActive === false ? 'Inactive' : 'Active',
    });
  };

  const formatModuleList = (value) => {
    const modules = normalizeModuleList(value);
    if (!modules.length) {
      return 'Default access';
    }
    return modules.map((moduleId) => moduleLabelMap[moduleId] || moduleId).join(', ');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!authToken) {
      setError('You are not authenticated');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const isEditing = Boolean(editingUserId);
      const response = await fetch(
        toApiUrl(
          isEditing
            ? `http://localhost:8000/api/auth/users/${encodeURIComponent(editingUserId)}`
            : 'http://localhost:8000/api/auth/users'
        ),
        {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          username: formValues.username.trim(),
          fullName: formValues.fullName.trim(),
          password: formValues.password,
          role: formValues.role,
          employeeId: formValues.employeeId.trim(),
          allowedModules: normalizeModuleList(formValues.allowedModules),
          isActive: formValues.isActive !== 'Inactive',
        }),
      }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || (isEditing ? 'Failed to update user' : 'Failed to create user'));
        return;
      }
      const data = await response.json();
      if (data && data.user) {
        setUsers((prev) =>
          isEditing
            ? prev.map((user) => (user.id === data.user.id ? data.user : user))
            : [data.user, ...prev]
        );
        resetForm();
      }
    } catch (submitError) {
      setError('Unable to reach server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-title-row">
        <div>
          <h2>User Management</h2>
          <p>Edit roles, authentication, and module grants for employee accounts with ease.</p>
        </div>
      </div>
      <div className="form-section-grid">
        <div className="form-section">
          <div className="form-section-title">{editingUser ? 'Edit User Access' : 'Create User'}</div>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              <span>Username</span>
              <input
                value={formValues.username}
                onChange={(event) => handleChange('username', event.target.value)}
                readOnly={Boolean(editingUser)}
              />
            </label>
            <label>
              <span>Employee ID {editingUser ? '' : '(optional)'}</span>
              <input
                value={formValues.employeeId}
                onChange={(event) => handleChange('employeeId', event.target.value)}
                readOnly={Boolean(editingUser)}
              />
            </label>
            <label>
              <span>Full Name</span>
              <input
                value={formValues.fullName}
                onChange={(event) => handleChange('fullName', event.target.value)}
              />
            </label>
            <label>
              <span>{editingUser ? 'New Password (optional)' : 'Password'}</span>
              <input
                type="password"
                value={formValues.password}
                onChange={(event) => handleChange('password', event.target.value)}
              />
            </label>
            <label>
              <span>Role</span>
              <select
                className="filter-select"
                value={formValues.role}
                onChange={(event) => handleChange('role', event.target.value)}
              >
                {assignableRoles.map((roleOption) => (
                  <option key={roleOption.value} value={roleOption.value}>
                    {roleOption.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Allowed Modules</span>
              <select
                className="filter-select"
                multiple
                size={Math.min(8, Math.max(4, assignableModuleOptions.length || 4))}
                value={normalizeModuleList(formValues.allowedModules)}
                onChange={(event) =>
                  handleChange(
                    'allowedModules',
                    Array.from(event.target.selectedOptions).map((option) => option.value)
                  )
                }
              >
                {assignableModuleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                className="filter-select"
                value={formValues.isActive}
                onChange={(event) => handleChange('isActive', event.target.value)}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="form-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? (editingUser ? 'Saving...' : 'Creating...') : editingUser ? 'Save Changes' : 'Create User'}
              </button>
              {editingUser ? (
                <button type="button" className="neutral-btn" onClick={resetForm} disabled={saving}>
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>
          <div style={{ marginTop: 10, fontSize: 12, color: '#58688f' }}>
            Hold `Cmd` while clicking to choose multiple modules from the dropdown.
          </div>
        </div>
        <div className="form-section">
          <div className="form-section-title">Existing Users</div>
          {loading ? (
            <div>Loading users...</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Full Name</th>
                    <th>Role</th>
                    <th>Allowed Modules</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.fullName}</td>
                      <td>{user.role}</td>
                      <td>{formatModuleList(user.allowedModules)}</td>
                      <td>{user.isActive ? 'Active' : 'Inactive'}</td>
                      <td>
                        <button type="button" className="mini-btn" onClick={() => startEdit(user)}>
                          Edit Access
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!users.length ? (
                    <tr>
                      <td colSpan={6}>No users yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default UserManagementPage;
