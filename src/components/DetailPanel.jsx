import React, { useEffect, useState } from 'react';
import { CATEGORIES } from '../data/mockData.js';

const geocodeCache = new Map();

function humanizeCategory(category) {
  return CATEGORIES[category]?.label || String(category || 'unknown event').replaceAll('_', ' ');
}

function confidenceLabel(confidence) {
  if (confidence >= 0.8) return 'HIGH CONFIDENCE';
  if (confidence >= 0.55) return 'MODERATE CONFIDENCE';
  return 'LOW CONFIDENCE';
}

function ExplanationPanel({ detection, category }) {
  const explanation = detection.explanation;
  if (!explanation) return null;

  const drivers = explanation.drivers || [];
  const supporting = drivers.filter((driver) => driver.direction === 'supports');
  const opposing = drivers.filter((driver) => driver.direction === 'opposes');
  const confidence = Number(detection.confidence || 0);

  return (
    <section className="classification-insight" aria-label="Classifier explanation">
      <div className="classification-insight__eyebrow">AGNI CLASSIFIER ASSESSMENT</div>
      <div className="classification-verdict">
        <div className="classification-verdict__icon" style={{ '--category-color': category.color }}>✓</div>
        <div>
          <div className="classification-verdict__label">MOST LIKELY EVENT</div>
          <div className="classification-verdict__title" style={{ color: category.color }}>
            {humanizeCategory(detection.category)}
          </div>
        </div>
        <div className="classification-confidence">
          <strong>{Math.round(confidence * 100)}%</strong>
          <span>{confidenceLabel(confidence)}</span>
        </div>
      </div>

      <div className="confidence-meter" aria-label={`${Math.round(confidence * 100)} percent confidence`}>
        <div className="confidence-meter__fill" style={{ width: `${Math.round(confidence * 100)}%`, background: category.color }} />
      </div>

      <p className="classification-insight__plain">
        The classifier weighs the hotspot’s heat signature, timing, surrounding land use, and how often this location has been active. It is not confirming a ground-truth cause; it is ranking the most likely explanation from those signals.
      </p>

      <div className="classification-reasoning">
        <div className="classification-reasoning__heading">WHY THIS WAS SELECTED</div>
        {supporting.length ? (
          <div className="reason-list">
            {supporting.slice(0, 4).map((driver) => {
              const magnitude = Math.min(100, Math.max(10, Math.abs(driver.contribution) * 28));
              return (
                <div className="reason-card" key={driver.feature}>
                  <div className="reason-card__topline">
                    <span>{driver.feature}</span>
                    <span className="reason-card__tag">SUPPORTS</span>
                  </div>
                  <strong>{driver.value}</strong>
                  <div className="reason-card__bar"><span style={{ width: `${magnitude}%` }} /></div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="classification-insight__fallback">The model’s combined signals favored this category, but individual feature contributions are unavailable for this result.</p>
        )}
      </div>

      {opposing.length > 0 && (
        <div className="classification-counterpoint">
          <span>COUNTER-SIGNALS</span>
          {opposing.slice(0, 2).map((driver) => `${driver.feature}: ${driver.value}`).join(' · ')}
        </div>
      )}

      <details className="classification-details">
        <summary>View model context & data provenance</summary>
        <p>{explanation.summary}</p>
        <ul>
          {(explanation.context || []).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="classification-details__note">
          Model: {explanation.model || 'AGNI classifier'}.
          {explanation.referenceKm != null ? ` Context was matched to a historic observation ${explanation.referenceKm} km away.` : ''}
        </p>
      </details>
    </section>
  );
}

export default function DetailPanel({ detection, onUseInClassifier }) {
  const [place, setPlace] = useState(null);
  const [facilityContext, setFacilityContext] = useState(null);

  useEffect(() => {
    if (!detection || detection.lat == null || detection.lng == null) {
      setPlace(null);
      return;
    }

    const latNum = Number(detection.lat);
    const lngNum = Number(detection.lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      setPlace(null);
      return;
    }

    const cacheKey = `${latNum.toFixed(4)},${lngNum.toFixed(4)}`;
    if (geocodeCache.has(cacheKey)) {
      setPlace(geocodeCache.get(cacheKey));
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function fetchAddress() {
      let resolved = null;

      // 1. Try backend reverse geocoding proxy first
      try {
        const resp = await fetch(`/api/geocode/reverse?lat=${latNum}&lon=${lngNum}`, {
          signal: controller.signal,
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.place) {
            resolved = data.place;
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
      }

      // 2. Direct OpenStreetMap Nominatim query fallback
      if (!resolved) {
        try {
          const osmUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latNum}&lon=${lngNum}`;
          const osmResp = await fetch(osmUrl, { signal: controller.signal });
          if (osmResp.ok) {
            const osmData = await osmResp.json();
            resolved = osmData.display_name || osmData.name || null;
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }

      if (isMounted) {
        if (resolved) {
          geocodeCache.set(cacheKey, resolved);
          setPlace(resolved);
        } else {
          setPlace(null);
        }
      }
    }

    fetchAddress();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [detection?.id, detection?.lat, detection?.lng]);

  useEffect(() => {
    // This is a second-stage attribution for a freshly run classifier result,
    // not background context for every industrial point already on the map.
    if (!detection || detection.category !== 'industrial' || !detection.isNewDetection || !detection.explanation) {
      setFacilityContext(null);
      return undefined;
    }
    let isMounted = true;
    const controller = new AbortController();
    setFacilityContext({ loading: true });
    fetch(`/api/facilities/nearby?lat=${detection.lat}&lng=${detection.lng}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Facility lookup unavailable')))
      .then((data) => { if (isMounted) setFacilityContext(data); })
      .catch((error) => {
        if (isMounted && error.name !== 'AbortError') setFacilityContext({ error: 'Facility lookup unavailable' });
      });
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [detection?.id, detection?.category, detection?.lat, detection?.lng]);

  if (!detection) {
    return (
      <section className="panel detail-panel detail-panel--empty">
        <div className="panel__title">DETECTION DETAILS</div>
        <p className="detail-empty__hint">Click a point on the globe to inspect it.</p>
      </section>
    );
  }

  const cat = CATEGORIES[detection.category];
  const latFormatted = Number(detection.lat).toFixed(4);
  const lngFormatted = Number(detection.lng).toFixed(4);
  const hasFreshIndustrialClassification = detection.category === 'industrial'
    && detection.isNewDetection
    && detection.explanation;

  return (
    <section className="panel detail-panel">
      <div className="panel__title">
        DETECTION DETAILS
        {detection.anomaly && <span className="anomaly-badge">ANOMALY</span>}
        {detection.isFirmsHotspot && <span className="firms-badge">FIRMS HOTSPOT</span>}
      </div>

      <div className="detail-id" style={{ color: cat.color, textShadow: `0 0 10px ${cat.color}88` }}>
        {detection.id}
      </div>
      <div className="detail-region">{detection.region}</div>
      {detection.source && <div className="detail-source">{detection.source}</div>}

      <div className="detail-location">
        {place ? `Location: ${place} | ` : ''}Lat: {latFormatted}, Long: {lngFormatted}
      </div>

      <div className="stat-grid stat-grid--detail">
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
            {detection.isNewDetection ? 'HOTSPOT ONLY' : (detection.persistent ? `ACTIVE ${detection.activeMonths} MO` : 'ONE-OFF')}
          </div>
        </div>
      </div>

      <ExplanationPanel detection={detection} category={cat} />

      {(detection.bright_ti4 != null || detection.isFirmsHotspot) && (
        <div className="firms-hotspot-detail">
          <div className="model-explain__title">FIRMS HOTSPOT TELEMETRY</div>
          <div className="stat-grid stat-grid--firms">
            {detection.bright_ti4 != null && (
              <div className="stat-cell">
                <div className="stat-cell__label">VIIRS I4 TEMP</div>
                <div className="stat-cell__value">{detection.bright_ti4} K</div>
              </div>
            )}
            {detection.bright_ti5 != null && (
              <div className="stat-cell">
                <div className="stat-cell__label">VIIRS I5 TEMP</div>
                <div className="stat-cell__value">{detection.bright_ti5} K</div>
              </div>
            )}
            {detection.acqTime && (
              <div className="stat-cell">
                <div className="stat-cell__label">ACQ TIME</div>
                <div className="stat-cell__value">{detection.acqTime} UTC</div>
              </div>
            )}
            {detection.daynight && (
              <div className="stat-cell">
                <div className="stat-cell__label">PASS TYPE</div>
                <div className="stat-cell__value">{detection.daynight === 'N' ? 'NIGHT PASS' : 'DAY PASS'}</div>
              </div>
            )}
          </div>
          <p className="firms-hotspot-note">
            Real-time NASA FIRMS satellite thermal hotspot (VIIRS NOAA-20 NRT). Single-event thermal reading without multi-year persistent clustering.
          </p>
        </div>
      )}

      {hasFreshIndustrialClassification && (
        <div className="facility-context">
          <div className="facility-context__eyebrow">POST-CLASSIFICATION PROXIMITY CHECK</div>
          <div className="facility-context__classification">ML CLASS: <strong>INDUSTRIAL ACTIVITY</strong></div>
          {facilityContext?.loading && <p>Checking nearby mapped industrial facilities…</p>}
          {facilityContext?.facility && (
            <>
              <div className="facility-context__source">
                <span className="facility-context__label">POSSIBLE SOURCE</span>
                <strong>{facilityContext.facility.name}</strong>
              </div>
              <div className="facility-context__facts">
                <div><span>LIKELY FACILITY TYPE</span><b>{facilityContext.facility.type}</b></div>
                <div><span>DISTANCE TO HOTSPOT</span><b>{facilityContext.facility.distance_km} km</b></div>
              </div>
              <small>{facilityContext.facility.evidence} · Source: {facilityContext.source}</small>
              <p className="facility-context__caveat">This is a proximity-based source attribution after the ML result—not proof that the facility caused the thermal event.</p>
            </>
          )}
          {facilityContext?.error && !facilityContext.loading && (
            <p>{facilityContext.error}. The industrial classification is still available, but source attribution could not be checked.</p>
          )}
          {facilityContext && !facilityContext.loading && !facilityContext.facility && !facilityContext.error && (
            <p>No mapped industrial facility was found within 10 km. The industrial classification remains unchanged.</p>
          )}
        </div>
      )}

      <div className="detail-actions">
        {onUseInClassifier && (
          <button
            className="ghost-btn ghost-btn--highlight"
            type="button"
            onClick={() => onUseInClassifier(detection)}
          >
            LOAD INTO CLASSIFIER
          </button>
        )}
        <button className="ghost-btn" type="button">
          EXPORT DETECTION
        </button>
      </div>
    </section>
  );
}
