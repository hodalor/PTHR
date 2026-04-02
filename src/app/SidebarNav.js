export default function SidebarNav({
  sidebarSections,
  allowedModulesByRole,
  activeModuleId,
  setActiveModuleId,
  handleModuleChange,
  sidebarStyle,
  appInitial,
  appSettings,
  leaveMenuExpanded,
  setLeaveMenuExpanded,
  leaveSubmenuItems,
  leaveViewTab,
  setLeaveViewTab,
  setLeaveRequestPageTab,
  loanMenuExpanded,
  setLoanMenuExpanded,
  loanSubmenuItems,
  loanViewTab,
  setLoanViewTab,
}) {
  return (
    <aside className="sidebar-shell" style={sidebarStyle}>
      <div className="brand-block">
        <div className="brand-logo">{appInitial}</div>
        <div>
          <h1>{appSettings.appName || 'PTHR'}</h1>
          <p>HR Command Center</p>
        </div>
      </div>
      {sidebarSections.map((section) => (
        <div className="sidebar-section" key={section.title}>
          <h2>{section.title}</h2>
          <nav>
            {section.items.map((item) => {
              if (!allowedModulesByRole.has(item.id)) {
                return null;
              }
              if (activeModuleId && !allowedModulesByRole.has(activeModuleId)) {
                const firstAllowed = sidebarSections
                  .flatMap((s) => s.items)
                  .find((candidate) => allowedModulesByRole.has(candidate.id));
                if (firstAllowed && firstAllowed.id !== activeModuleId) {
                  setActiveModuleId(firstAllowed.id);
                }
              }
              if (item.id === 'leave-management') {
                return (
                  <div key={item.id} className="menu-group">
                    <button
                      type="button"
                      className={`menu-item ${activeModuleId === item.id ? 'active' : ''}`}
                      onClick={() => {
                        if (activeModuleId !== 'leave-management') {
                          handleModuleChange('leave-management');
                          setLeaveMenuExpanded(true);
                          return;
                        }
                        setLeaveMenuExpanded((prev) => !prev);
                      }}
                    >
                      <span>{item.label}</span>
                      <span className={`menu-arrow ${leaveMenuExpanded ? 'open' : ''}`}>▾</span>
                    </button>
                    {leaveMenuExpanded ? (
                      <div className="menu-subitems">
                        {leaveSubmenuItems.map((submenu) => (
                          <button
                            key={submenu.key}
                            type="button"
                            className={`menu-subitem ${
                              activeModuleId === 'leave-management' && leaveViewTab === submenu.key ? 'active' : ''
                            }`}
                            onClick={() => {
                              if (activeModuleId !== 'leave-management') {
                                handleModuleChange('leave-management');
                              }
                              setLeaveMenuExpanded(true);
                              setLeaveViewTab(submenu.key);
                              if (submenu.key === 'requests') {
                                setLeaveRequestPageTab('requests');
                              }
                            }}
                          >
                            {submenu.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }
              if (item.id === 'loan-records') {
                return (
                  <div key={item.id} className="menu-group">
                    <button
                      type="button"
                      className={`menu-item ${activeModuleId === item.id ? 'active' : ''}`}
                      onClick={() => {
                        if (activeModuleId !== 'loan-records') {
                          handleModuleChange('loan-records');
                          setLoanMenuExpanded(true);
                          return;
                        }
                        setLoanMenuExpanded((prev) => !prev);
                      }}
                    >
                      <span>{item.label}</span>
                      <span className={`menu-arrow ${loanMenuExpanded ? 'open' : ''}`}>▾</span>
                    </button>
                    {loanMenuExpanded ? (
                      <div className="menu-subitems">
                        {loanSubmenuItems.map((submenu) => (
                          <button
                            key={submenu.key}
                            type="button"
                            className={`menu-subitem ${
                              activeModuleId === 'loan-records' && loanViewTab === submenu.key ? 'active' : ''
                            }`}
                            onClick={() => {
                              if (activeModuleId !== 'loan-records') {
                                handleModuleChange('loan-records');
                              }
                              setLoanMenuExpanded(true);
                              setLoanViewTab(submenu.key);
                            }}
                          >
                            {submenu.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`menu-item ${activeModuleId === item.id ? 'active' : ''}`}
                  onClick={() => handleModuleChange(item.id)}
                >
                  <span>{item.label}</span>
                  {Array.isArray(item.children) && item.children.length > 0 ? <span className="menu-arrow">▾</span> : null}
                </button>
              );
            })}
          </nav>
        </div>
      ))}
    </aside>
  );
}
