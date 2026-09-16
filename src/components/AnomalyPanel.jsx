import React from 'react';

export default function AnomalyPanel({ anomalies, anomaliesOnly, onToggleAnomaliesOnly, onSelect, selectedId }) {
  return (
    <section className="panel anomaly-panel">
      <div className="panel__title">
        PRIORITY ANOMALIES
        <span className="anomaly-panel__count">{anomalies.length}</span>
      </div>

      <button
        type="button"
        className={`anomaly-toggle${anomaliesOnly ? ' anomaly-toggle--active' : ''}`}
        onClick={onToggleAnomaliesOnly}
        aria-pressed={anomaliesOnly}
      >
        {anomaliesOnly ? 'SHOWING ANOMALIES ONLY' : 'SHOW ANOMALIES ONLY'}
      </button>

      {anomalies.length ? (
        <div className="anomaly-list">
          {anomalies.slice(0, 5).map((detection) => (
            <button
              key={detection.id}
              type="button"
              className={`anomaly-row${detection.id === selectedId ? ' anomaly-row--selected' : ''}`}
              onClick={() => onSelect(detection)}
            >
              <span className="anomaly-row__icon" aria-hidden="true">!</span>
              <span className="anomaly-row__content">
                <strong>{detection.id}</strong>
                <small>{detection.region} · {detection.frp} MW</small>
              </span>
              <span className="anomaly-row__confidence">
                {detection.acqTime
                  ? `${detection.acqTime} UTC`
                  : detection.firstDetected ?? '—'}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="anomaly-panel__empty">No anomalous hotspots in this view.</p>
      )}
    </section>
  );
}
