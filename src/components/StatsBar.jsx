import React from 'react';

export default function StatsBar({ stats }) {
  return (
    <section className="stats-bar">
      {stats.map((s) => (
        <div className="stats-card" key={s.label}>
          <div className="stats-card__value" style={s.color ? { color: s.color } : undefined}>
            {s.value}
          </div>
          <div className="stats-card__label">{s.label}</div>
        </div>
      ))}
    </section>
  );
}
