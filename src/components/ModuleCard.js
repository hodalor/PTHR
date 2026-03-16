function ModuleCard({ module, onSelect, isActive, tone }) {
  const cardClass = `module-card ${tone || ''} ${isActive ? 'active' : ''}`.trim();

  return (
    <button className={cardClass} type="button" onClick={() => onSelect(module.id)}>
      <span className="module-card-title">{module.name}</span>
      <span className="module-card-description">{module.description}</span>
      <span className="module-meta">
        <span>{module.status}</span>
        <span>{module.priority}</span>
      </span>
    </button>
  );
}

export default ModuleCard;
