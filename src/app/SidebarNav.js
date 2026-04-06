import { useEffect, useMemo, useState } from 'react';

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
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1260px)').matches : false
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(max-width: 1260px)');
    const applyMatch = (matches) => {
      setIsCompactLayout(matches);
      if (!matches) {
        setIsMobileMenuOpen(false);
      }
    };
    applyMatch(mediaQuery.matches);
    const onChange = (event) => applyMatch(event.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  const firstAllowedModuleId = useMemo(() => {
    const firstAllowed = sidebarSections
      .flatMap((section) => section.items)
      .find((candidate) => allowedModulesByRole.has(candidate.id));
    return firstAllowed?.id || '';
  }, [allowedModulesByRole, sidebarSections]);

  const closeMobileMenuIfNeeded = () => {
    if (isCompactLayout) {
      setIsMobileMenuOpen(false);
    }
  };

  useEffect(() => {
    if (activeModuleId && !allowedModulesByRole.has(activeModuleId) && firstAllowedModuleId && firstAllowedModuleId !== activeModuleId) {
      setActiveModuleId(firstAllowedModuleId);
    }
  }, [activeModuleId, allowedModulesByRole, firstAllowedModuleId, setActiveModuleId]);

  return (
    <aside className={`sidebar-shell ${isCompactLayout ? 'mobile' : ''}`} style={sidebarStyle}>
      <div className="brand-block">
        <div className="brand-logo">{appInitial}</div>
        <div>
          <h1>{appSettings.appName || 'PTHR'}</h1>
          <p>HR Command Center</p>
        </div>
        {isCompactLayout ? (
          <button
            type="button"
            className="secondary-btn small sidebar-toggle-btn"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          >
            {isMobileMenuOpen ? 'Close' : 'Menu'}
          </button>
        ) : null}
      </div>
      <div className={`sidebar-content ${isCompactLayout && !isMobileMenuOpen ? 'is-hidden' : ''}`}>
        {sidebarSections.map((section) => (
          <div className="sidebar-section" key={section.title}>
            <h2>{section.title}</h2>
            <nav>
              {section.items.map((item) => {
              if (!allowedModulesByRole.has(item.id)) {
                return null;
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
                          closeMobileMenuIfNeeded();
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
                              closeMobileMenuIfNeeded();
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
                          closeMobileMenuIfNeeded();
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
                              closeMobileMenuIfNeeded();
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
                  onClick={() => {
                    handleModuleChange(item.id);
                    closeMobileMenuIfNeeded();
                  }}
                >
                  <span>{item.label}</span>
                  {Array.isArray(item.children) && item.children.length > 0 ? <span className="menu-arrow">▾</span> : null}
                </button>
              );
              })}
            </nav>
          </div>
        ))}
      </div>
    </aside>
  );
}
