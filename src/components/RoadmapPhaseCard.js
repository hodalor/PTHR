function RoadmapPhaseCard({ phase }) {
  return (
    <article className="phase-card">
      <h3>{phase.phase}</h3>
      <h4>{phase.title}</h4>
      <ul>
        {phase.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

export default RoadmapPhaseCard;
