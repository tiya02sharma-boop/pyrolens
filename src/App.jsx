import React, { useEffect, useMemo, useState } from 'react';
import Globe from './components/Globe.jsx';
import HUDFrame from './components/HUDFrame.jsx';
import TopBar from './components/TopBar.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import ClassifyPanel from './components/ClassifyPanel.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import StatsBar from './components/StatsBar.jsx';
import { REGIONS, CATEGORIES } from './data/mockData.js';

const ALL_CATEGORY_KEYS = Object.keys(CATEGORIES);

let userDetectionSeq = 1;

export default function App() {
  const [detections, setDetections] = useState([]);
  const [dataError, setDataError] = useState(null);

  const [regionId, setRegionId] = useState('all');
  const [activeCategories, setActiveCategories] = useState(new Set(ALL_CATEGORY_KEYS));
  const [minConfidence, setMinConfidence] = useState(0.4);
  const [selectedId, setSelectedId] = useState(null);

  const [pickedCoords, setPickedCoords] = useState({ lat: '', lng: '' });
  const [pickMode, setPickMode] = useState(false);
  const [manualFocus, setManualFocus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const loadDetections = () => {
      fetch('/api/detections?limit=3000')
        .then((response) => {
          if (!response.ok) throw new Error('Could not load AGNI detections.');
          return response.json();
        })
        .then((items) => { if (!cancelled) setDetections(items); })
        .catch((error) => { if (!cancelled) setDataError(error.message); });
    };
    loadDetections();
    // Keep the dashboard current as the scheduled real-time poller inserts
    // newly classified FIRMS detections.
    const intervalId = setInterval(loadDetections, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, []);

  const regionFiltered = useMemo(() => {
    if (regionId === 'all') return detections;
    return detections.filter((d) => d.regionId === regionId);
  }, [detections, regionId]);

  const visibleDetections = useMemo(
    () =>
      regionFiltered.filter(
        (d) => activeCategories.has(d.category) && d.confidence >= minConfidence
      ),
    [regionFiltered, activeCategories, minConfidence]
  );

  const counts = useMemo(() => {
    const c = {};
    regionFiltered.forEach((d) => {
      c[d.category] = (c[d.category] || 0) + 1;
    });
    return c;
  }, [regionFiltered]);

  const [classifiedPreview, setClassifiedPreview] = useState(null);

  const selectedDetection = useMemo(
    () => visibleDetections.find((d) => d.id === selectedId) || (selectedId === classifiedPreview?.id ? classifiedPreview : null),
    [visibleDetections, selectedId, classifiedPreview]
  );

  const regionFlyTo = useMemo(() => {
    if (regionId === 'all') return null;
    const r = REGIONS.find((r) => r.id === regionId);
    return r ? [r.lat, r.lng] : null;
  }, [regionId]);

  const flyTo = manualFocus || regionFlyTo;

  const stats = useMemo(() => {
    const anomalies = visibleDetections.filter((d) => d.anomaly).length;
    const persistent = visibleDetections.filter((d) => d.persistent).length;
    const avgConf =
      visibleDetections.length === 0
        ? 0
        : visibleDetections.reduce((sum, d) => sum + d.confidence, 0) / visibleDetections.length;

    return [
      { label: 'TOTAL DETECTIONS', value: visibleDetections.length.toLocaleString() },
      { label: 'ACTIVE ANOMALIES', value: anomalies, color: anomalies > 0 ? '#ff3b3b' : undefined },
      { label: 'PERSISTENT SOURCES', value: persistent, color: '#b083ff' },
      { label: 'AVG CONFIDENCE', value: `${Math.round(avgConf * 100)}%` },
    ];
  }, [visibleDetections]);

  function toggleCategory(key) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleRegionChange(id) {
    setRegionId(id);
    setSelectedId(null);
    setManualFocus(null);
  }

  function handleGlobeClick(coords) {
    if (!pickMode || !coords) return;
    setPickedCoords({ lat: coords.lat.toFixed(3), lng: coords.lng.toFixed(3) });
    setPickMode(false);
  }

  function buildFirmsDetection(result, id) {
    const nearest = REGIONS
      .map((r) => {
        const d = Math.sqrt((r.lat - result.lat) ** 2 + ((r.lng - result.lng) * Math.cos(r.lat * Math.PI / 180)) ** 2) * 111;
        return { ...r, distance: d };
      })
      .sort((a, b) => a.distance - b.distance)[0];

    const regionName = nearest && nearest.distance < 400
      ? `${nearest.label} (~${Math.round(nearest.distance)} km)`
      : 'Real-time FIRMS Hotspot';

    return {
      id,
      region: regionName,
      regionId: nearest?.id || 'user-input',
      lat: result.lat,
      lng: result.lng,
      category: result.category,
      confidence: result.confidence,
      frp: result.frp,
      bright_ti4: result.bright_ti4,
      bright_ti5: result.bright_ti5,
      acqDate: result.acq_date,
      acqTime: result.acq_time,
      daynight: result.daynight,
      source: result.source || 'NASA FIRMS NRT · VIIRS NOAA-20',
      isFirmsHotspot: true,
      isNewDetection: true,
      firstDetected: result.acq_date || new Date().toISOString().slice(0, 10),
      persistent: false,
      activeMonths: 0,
      anomaly: false,
      explanation: result.explanation || null,
    };
  }

  function handleClassified(result) {
    const id = `FIRMS-HOTSPOT-${String(userDetectionSeq).padStart(4, '0')}`;
    const preview = buildFirmsDetection(result, id);
    setClassifiedPreview(preview);
    setSelectedId(id);
    setManualFocus([result.lat, result.lng]);
  }

  function handleAddDetection(result) {
    const id = `FIRMS-HOTSPOT-${String(userDetectionSeq).padStart(4, '0')}`;
    userDetectionSeq += 1;

    const newDetection = buildFirmsDetection(result, id);

    setDetections((prev) => [...prev, newDetection]);
    setClassifiedPreview(null);
    setActiveCategories((prev) => new Set(prev).add(result.category));
    setMinConfidence((prev) => Math.min(prev, result.confidence));
    setRegionId('all');
    setSelectedId(id);
    setManualFocus([result.lat, result.lng]);
  }

  return (
    <div className={`app${pickMode ? ' app--pick' : ''}`}>
      <div className="app__globe">
        <Globe
          detections={visibleDetections}
          selectedId={selectedId}
          pickedCoords={pickedCoords}
          onSelect={setSelectedId}
          flyTo={flyTo}
          onGlobeClick={handleGlobeClick}
        />
      </div>

      <TopBar
        regionId={regionId}
        onRegionChange={handleRegionChange}
        totalCount={visibleDetections.length}
        pickMode={pickMode}
      />
      {dataError && <div className="api-status">{dataError}</div>}

      <div className="dock dock--left">
        <FilterPanel
          activeCategories={activeCategories}
          onToggleCategory={toggleCategory}
          minConfidence={minConfidence}
          onConfidenceChange={setMinConfidence}
          counts={counts}
        />
        <ClassifyPanel
          coords={pickedCoords}
          onCoordsChange={setPickedCoords}
          pickMode={pickMode}
          onTogglePick={() => setPickMode((p) => !p)}
          onAdd={handleAddDetection}
          onClassified={handleClassified}
        />
      </div>

      <div className="dock dock--right">
        <DetailPanel detection={selectedDetection} />
      </div>

      <StatsBar stats={stats} />
      <HUDFrame />
    </div>
  );
}
