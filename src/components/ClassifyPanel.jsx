import React, { useEffect, useState } from 'react';
import { CATEGORIES, REGIONS } from '../data/mockData.js';

function haversineKm(lat1, lng1, lat2, lng2) {
  const radians = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin((lng2 - lng1) * radians / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export default function ClassifyPanel({ coords, onCoordsChange, pickMode, onTogglePick, onAdd, onClassified }) {
  const [frp, setFrp] = useState('');
  const [brightTi4, setBrightTi4] = useState('');
  const [brightTi5, setBrightTi5] = useState('');
  const [acqDate, setAcqDate] = useState('');
  const [acqTime, setAcqTime] = useState('');
  const [daynight, setDaynight] = useState('D');
  const [firmsStatus, setFirmsStatus] = useState('');
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

  useEffect(() => {
    if (coords?.detection) {
      const d = coords.detection;
      // FRP is always present
      if (d.frp != null) setFrp(String(d.frp));
      // bright_ti4 / bright_ti5 may be null for older records — only fill if valid
      if (d.bright_ti4 != null && d.bright_ti4 !== 'null') setBrightTi4(String(d.bright_ti4));
      else setBrightTi4('');
      if (d.bright_ti5 != null && d.bright_ti5 !== 'null') setBrightTi5(String(d.bright_ti5));
      else setBrightTi5('');
      // firstDetected is always YYYY-MM-DD which is what <input type="date"> expects
      if (d.firstDetected) setAcqDate(d.firstDetected);
      // acqTime is always HH:MM which is what <input type="time"> expects
      if (d.acqTime) setAcqTime(d.acqTime);
      if (d.daynight) setDaynight(d.daynight === 'N' ? 'N' : 'D');
      setFirmsStatus(`HOTSPOT ${d.id} SELECTED · FIRMS PARAMETERS LOADED`);
      return undefined;
    }

    if (!selectedLocation) {
      setFirmsStatus('');
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setFirmsStatus('FETCHING FIRMS THERMAL SATELLITE DATA…');
      try {
        const response = await fetch(
          `/api/firms/nearest?lat=${selectedLocation.lat}&lng=${selectedLocation.lng}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'FIRMS lookup failed.');
        setFrp(String(data.frp));
        setBrightTi4(String(data.bright_ti4));
        setBrightTi5(String(data.bright_ti5));
        setAcqDate(data.acq_date);
        setAcqTime(data.acq_time);
        setDaynight(data.daynight === 'N' ? 'N' : 'D');
        setFirmsStatus(`FIRMS HOTSPOT LOADED · ${data.distance_km} KM AWAY · ${data.source}`);
      } catch (lookupError) {
        if (lookupError.name !== 'AbortError') setFirmsStatus(lookupError.message);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [selectedLocation?.lat, selectedLocation?.lng, coords?.detection]);

  async function handleClassify(e) {
    e.preventDefault();
    const lat = parseFloat(coords.lat);
    const lng = parseFloat(coords.lng);
    const frpNum = parseFloat(frp);
    const brightTi4Num = parseFloat(brightTi4);
    const brightTi5Num = parseFloat(brightTi5);

    if (Number.isNaN(lat) || lat < -90 || lat > 90 || Number.isNaN(lng) || lng < -180 || lng > 180) {
      setError('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }
    if (Number.isNaN(frpNum) || frpNum <= 0) {
      setError('Enter FRP in megawatts (a positive number).');
      return;
    }
    if (Number.isNaN(brightTi4Num) || brightTi4Num <= 0 || Number.isNaN(brightTi5Num) || brightTi5Num <= 0) {
      setError('Enter valid VIIRS I4 and I5 brightness temperatures in kelvin.');
      return;
    }
    if (!acqDate || !acqTime) {
      setError('Enter the satellite acquisition date and UTC time.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const response = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat, lng, frp: frpNum, bright_ti4: brightTi4Num, bright_ti5: brightTi5Num,
          acq_date: acqDate, acq_time: acqTime, daynight,
        }),
      });
      if (!response.ok) throw new Error('The AGNI classifier could not process this detection.');
      const res = await response.json();
      const fullResult = {
        ...res,
        lat,
        lng,
        frp: frpNum,
        bright_ti4: brightTi4Num,
        bright_ti5: brightTi5Num,
        acq_date: acqDate,
        acq_time: acqTime,
        daynight,
        source: 'NASA FIRMS NRT · VIIRS NOAA-20',
        isFirmsHotspot: true,
        isNewDetection: true,
      };
      setResult(fullResult);
      setAdded(false);
      if (onClassified) {
        onClassified(fullResult);
      }
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

        {firmsStatus && (
          <div className={`firms-status${firmsStatus.startsWith('LIVE') ? ' firms-status--loaded' : ''}`} role="status">
            {firmsStatus}
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
            <span className="field__label">VIIRS I4 (K)</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 340"
              value={brightTi4}
              onChange={(e) => setBrightTi4(e.target.value)}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">VIIRS I5 (K)</span>
            <input type="text" inputMode="decimal" placeholder="e.g. 300" value={brightTi5} onChange={(e) => setBrightTi5(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">ACQUISITION DATE</span>
            <input type="date" value={acqDate} onChange={(e) => setAcqDate(e.target.value)} />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">UTC TIME</span>
            <input type="time" value={acqTime} onChange={(e) => setAcqTime(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">DAY / NIGHT</span>
            <select value={daynight} onChange={(e) => setDaynight(e.target.value)}>
              <option value="D">DAY</option>
              <option value="N">NIGHT</option>
            </select>
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

          <button type="button" className="ghost-btn ghost-btn--solid" onClick={handleAdd} disabled={added}>
            {added ? 'ADDED TO GLOBE' : 'ADD TO GLOBE'}
          </button>
        </div>
      )}
    </section>
  );
}
