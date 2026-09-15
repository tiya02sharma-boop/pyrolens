import React from 'react';
import { CATEGORIES } from '../data/mockData.js';

export default function FilterPanel({
  activeCategories,
  onToggleCategory,
  minConfidence,
  onConfidenceChange,
  counts,
}) {
  return (
    <section className="panel filter-panel">
      <div className="panel__title">CLASSIFICATION FILTER</div>

      <div className="cat-list">
        {Object.entries(CATEGORIES).map(([key, cat]) => {
          const active = activeCategories.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`cat-row${active ? ' cat-row--active' : ''}`}
              onClick={() => onToggleCategory(key)}
              aria-pressed={active}
            >
              <span className="cat-row__swatch" style={{ background: cat.color, opacity: active ? 1 : 0.3 }} />
              <span className="cat-row__label">{cat.label}</span>
              <span className="cat-row__count">{counts[key] || 0}</span>
            </button>
          );
        })}
      </div>

      <div className="confidence-block">
        <div className="confidence-block__label">
          MIN CONFIDENCE
          <span className="confidence-block__value">{Math.round(minConfidence * 100)}%</span>
        </div>
        <input
          type="range"
          min="0.4"
          max="0.99"
          step="0.01"
          value={minConfidence}
          onChange={(e) => onConfidenceChange(Number(e.target.value))}
        />
      </div>
    </section>
  );
}
