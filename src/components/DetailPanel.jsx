import React, { useEffect, useState } from 'react';
import { CATEGORIES } from '../data/mockData.js';

const geocodeCache = new Map();

export default function DetailPanel({ detection }) {
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
    if (!detection || detection.category !== 'industrial') {
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

  return (
    <section className="panel detail-panel">
      <div className="panel__title">
        DETECTION DETAILS
        {detection.anomaly && <span className="anomaly-badge">ANOMALY</span>}
      </div>

      <div className="detail-id" style={{ color: cat.color, textShadow: `0 0 10px ${cat.color}88` }}>
        {detection.id}
      </div>
      <div className="detail-region">{detection.region}</div>

      <div className="detail-location">
        {place ? `Location: ${place} | ` : ''}Lat: {latFormatted}, Long: {lngFormatted}
      </div>

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

      {detection.category === 'industrial' && (
        <div className="facility-context">
          <div className="model-explain__title">NEARBY FACILITY CONTEXT</div>
          {facilityContext?.loading && <p>Checking nearby mapped facilities…</p>}
          {facilityContext?.facility && (
            <>
              <strong>{facilityContext.facility.name}</strong>
              <p>
                Likely facility type: {facilityContext.facility.type} · {facilityContext.facility.distance_km} km away
              </p>
              <small>{facilityContext.facility.evidence} · Source: {facilityContext.source}</small>
            </>
          )}
          {facilityContext && !facilityContext.loading && !facilityContext.facility && (
            <p>No mapped industrial facility was found within 10 km. This does not change the ML classification.</p>
          )}
        </div>
      )}

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
