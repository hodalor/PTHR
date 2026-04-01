import { useEffect, useMemo, useState } from 'react';
import { sidebarSections } from '../config/moduleUiData';

function UserManagementPage({ authToken }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formValues, setFormValues] = useState({
    username: '',
    fullName: '',
    password: '',
    role: 'employee',
    allowedModules: [],
  });

  const moduleIds = useMemo(
    () => sidebarSections.flatMap((section) => section.items.map((item) => item.id)),
    []
  );

  const fetchUsers = useMemo(
    () => async () => {
      if (!authToken) {
        return;
      }
      setLoading(true);
      setError('');
      try {
        const response = await fetch('http://localhost:8000/api/auth/users', {
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
    },
    [authToken]
  );

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleChange = (field, value) => {
    setFormValues((prev) => ({
      ...prev,
      [field]: value,
    }));
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
      const response = await fetch('http://localhost:8000/api/auth/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          username: formValues.username.trim(),
          fullName: formValues.fullName.trim(),
          password: formValues.password,
          role: formValues.role,
          allowedModules: Array.isArray(formValues.allowedModules)
            ? formValues.allowedModules
            : String(formValues.allowedModules || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || 'Failed to create user');
        return;
      }
      const data = await response.json();
      if (data && data.user) {
        setUsers((prev) => [data.user, ...prev]);
        setFormValues({
          username: '',
          fullName: '',
          password: '',
          role: 'employee',
          allowedModules: [],
        });
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
          <p>Create platform users and control which modules they can see.</p>
        </div>
      </div>
      <div className="form-section-grid">
        <div className="form-section">
          <div className="form-section-title">Create User</div>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              <span>Username</span>
              <input
                value={formValues.username}
                onChange={(event) => handleChange('username', event.target.value)}
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
              <span>Password</span>
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
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="superadmin">Super Admin</option>
              </select>
            </label>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#455681' }}>
                Allowed Modules
              </span>
              <div
                style={{
                  marginTop: 6,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {moduleIds.map((id) => {
                  const checked =
                    Array.isArray(formValues.allowedModules) &&
                    formValues.allowedModules.includes(id);
                  return (
                    <label
                      key={id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        borderRadius: 999,
                        padding: '2px 8px',
                        background: checked ? '#21425f' : '#eef3ff',
                        border: '1px solid #cdd8f6',
                        color: checked ? '#ffffff' : '#1d2b45',
                        fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const isChecked = event.target.checked;
                          setFormValues((prev) => {
                            const current = Array.isArray(prev.allowedModules)
                              ? prev.allowedModules
                              : [];
                            if (isChecked) {
                              if (current.includes(id)) {
                                return prev;
                              }
                              return {
                                ...prev,
                                allowedModules: [...current, id],
                              };
                            }
                            return {
                              ...prev,
                              allowedModules: current.filter((value) => value !== id),
                            };
                          });
                        }}
                      />
                      <span>{id}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </form>
          <div style={{ marginTop: 10, fontSize: 12, color: '#58688f' }}>
            You can tick and untick modules above instead of typing their names.
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
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.fullName}</td>
                      <td>{user.role}</td>
                      <td>{Array.isArray(user.allowedModules) ? user.allowedModules.join(', ') : ''}</td>
                      <td>{user.isActive ? 'Active' : 'Inactive'}</td>
                    </tr>
                  ))}
                  {!users.length ? (
                    <tr>
                      <td colSpan={5}>No users yet.</td>
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
