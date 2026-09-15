import React, { useState } from 'react';
import { CATEGORIES, REGIONS } from '../data/mockData.js';

function haversineKm(lat1, lng1, lat2, lng2) {
  const radians = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin((lng2 - lng1) * radians / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export default function ClassifyPanel({ coords, onCoordsChange, pickMode, onTogglePick, onAdd }) {
  const [frp, setFrp] = useState('');
  const [brightness, setBrightness] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(false);
  const [loading, setLoading] = useState(false);
  const selectedLocation = (() => {
    const lat = Number.parseFloat(coords.lat);
    const lng = Number.parseFloat(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    const nearest = REGIONS
      .map((region) => ({ ...region, distance: haversineKm(lat, lng, region.lat, region.lng) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return { lat, lng, nearest };
  })();

  async function handleClassify(e) {
    e.preventDefault();
    const lat = parseFloat(coords.lat);
    const lng = parseFloat(coords.lng);
    const frpNum = parseFloat(frp);
    const brightNum = brightness === '' ? null : parseFloat(brightness);

    if (Number.isNaN(lat) || lat < -90 || lat > 90 || Number.isNaN(lng) || lng < -180 || lng > 180) {
      setError('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }
    if (Number.isNaN(frpNum) || frpNum <= 0) {
      setError('Enter FRP in megawatts (a positive number).');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, frp: frpNum, brightness: brightNum }),
      });
      if (!response.ok) throw new Error('The AGNI classifier could not process this detection.');
      const res = await response.json();
      setResult({ ...res, lat, lng, frp: frpNum, brightness: brightNum });
      setAdded(false);
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setLoading(false);
    }
  }

  function handleAdd() {
    if (!result) return;
    onAdd(result);
    setAdded(true);
  }

  const sortedScores = result
    ? Object.entries(result.scores).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <section className="panel classify-panel">
      <div className="panel__title">CLASSIFY NEW DETECTION</div>

      <form onSubmit={handleClassify} className="classify-form">
        <div className="field-row">
          <label className="field">
            <span className="field__label">LATITUDE</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 22.35"
              value={coords.lat}
              onChange={(e) => onCoordsChange({ ...coords, lat: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">LONGITUDE</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 70.05"
              value={coords.lng}
              onChange={(e) => onCoordsChange({ ...coords, lng: e.target.value })}
            />
          </label>
        </div>

        <button
          type="button"
          className={`ghost-btn${pickMode ? ' ghost-btn--active' : ''}`}
          onClick={onTogglePick}
        >
          {pickMode ? 'CLICK THE GLOBE TO SET POINT…' : 'PICK ON GLOBE INSTEAD'}
        </button>

        {selectedLocation && (
          <div className="location-confirmation" role="status">
            <span className="location-confirmation__eyebrow">LOCATION CONFIRMED</span>
            <strong>{selectedLocation.lat.toFixed(3)}°, {selectedLocation.lng.toFixed(3)}°</strong>
            <span>Nearest AGNI monitoring region: {selectedLocation.nearest.name} · {Math.round(selectedLocation.nearest.distance)} km</span>
          </div>
        )}

        <div className="field-row">
          <label className="field">
            <span className="field__label">FRP (MW)</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 38"
              value={frp}
              onChange={(e) => setFrp(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">BRIGHTNESS (K, optional)</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 1450"
              value={brightness}
              onChange={(e) => setBrightness(e.target.value)}
            />
          </label>
        </div>

        {error && <div className="field-error">{error}</div>}

        <button type="submit" className="ghost-btn ghost-btn--solid" disabled={loading}>
          {loading ? 'RUNNING AGNI MODEL…' : 'RUN CLASSIFICATION'}
        </button>
      </form>

      {result && (
        <div className="classify-result">
          <div
            className="classify-result__headline"
            style={{ color: CATEGORIES[result.category].color, textShadow: `0 0 10px ${CATEGORIES[result.category].color}88` }}
          >
            {CATEGORIES[result.category].label} — {Math.round(result.confidence * 100)}%
          </div>

          <div className="score-bars">
            {sortedScores.map(([key, score]) => (
              <div className="score-bar" key={key}>
                <span className="score-bar__label">{CATEGORIES[key].label}</span>
                <div className="score-bar__track">
                  <div
                    className="score-bar__fill"
                    style={{ width: `${Math.round(score * 100)}%`, background: CATEGORIES[key].color }}
                  />
                </div>
                <span className="score-bar__pct">{Math.round(score * 100)}%</span>
              </div>
            ))}
          </div>

          {result.explanation && (
            <div className="model-explain">
              <div className="model-explain__title">WHY THE MODEL SAID THIS</div>
              <p className="model-explain__summary">{result.explanation.summary}</p>
              <div className="driver-list">
                {(result.explanation.drivers || []).map((driver) => {
                  const magnitude = Math.min(100, Math.abs(driver.contribution) * 28);
                  return (
                    <div className="driver" key={driver.feature}>
                      <div className="driver__meta">
                        <span className="driver__name">{driver.feature}</span>
                        <span className={`driver__dir driver__dir--${driver.direction}`}>
                          {driver.direction === 'supports' ? 'supports' : 'against'}
                        </span>
                      </div>
                      <div className="driver__value">{driver.value}</div>
                      <div className="score-bar__track">
                        <div
                          className={`driver__fill driver__fill--${driver.direction}`}
                          style={{ width: `${Math.max(8, magnitude)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <ul className="signal-list">
                {(result.explanation.context || []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {!result.explanation && (
            <ul className="signal-list">
              {result.signals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}

          <button type="button" className="ghost-btn ghost-btn--solid" onClick={handleAdd} disabled={added}>
            {added ? 'ADDED TO GLOBE' : 'ADD TO GLOBE'}
          </button>
        </div>
      )}
    </section>
  );
}
