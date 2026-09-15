import React from 'react';
import { CATEGORIES } from '../data/mockData.js';

export default function DetailPanel({ detection }) {
  if (!detection) {
    return (
      <section className="panel detail-panel detail-panel--empty">
        <div className="panel__title">DETECTION DETAIL</div>
        <p className="detail-empty__hint">Click a point on the globe to inspect it.</p>
      </section>
    );
  }

  const cat = CATEGORIES[detection.category];

  return (
    <section className="panel detail-panel">
      <div className="panel__title">
        DETECTION DETAIL
        {detection.anomaly && <span className="anomaly-badge">ANOMALY</span>}
      </div>

      <div className="detail-id" style={{ color: cat.color, textShadow: `0 0 10px ${cat.color}88` }}>
        {detection.id}
      </div>
      <div className="detail-region">{detection.region}</div>

      <div className="stat-grid stat-grid--detail">
        <div className="stat-cell">
          <div className="stat-cell__label">CATEGORY</div>
          <div className="stat-cell__value" style={{ color: cat.color }}>
            {cat.label}
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__label">CONFIDENCE</div>
          <div className="stat-cell__value">{Math.round(detection.confidence * 100)}%</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__label">FRP</div>
          <div className="stat-cell__value">{detection.frp} MW</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__label">FIRST DETECTED</div>
          <div className="stat-cell__value">{detection.firstDetected}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__label">LAT / LNG</div>
          <div className="stat-cell__value">
            {detection.lat.toFixed(2)}, {detection.lng.toFixed(2)}
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-cell__label">PERSISTENCE</div>
          <div className="stat-cell__value">
            {detection.persistent ? `ACTIVE ${detection.activeMonths} MO` : 'ONE-OFF'}
          </div>
        </div>
      </div>

      {detection.explanation && (
        <div className="model-explain model-explain--detail">
          <div className="model-explain__title">MODEL EXPLANATION</div>
          <p className="model-explain__summary">{detection.explanation.summary}</p>
          <ul className="signal-list">
            {(detection.explanation.drivers || []).slice(0, 4).map((driver) => (
              <li key={driver.feature}>
                {driver.feature}: {driver.value} ({driver.direction} this class)
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="detail-actions">
        <button className="ghost-btn" type="button">
          EXPORT DETECTION
        </button>
        <button className="ghost-btn" type="button">
          OPEN MULTI-YEAR TIMELINE
        </button>
      </div>
    </section>
  );
}
