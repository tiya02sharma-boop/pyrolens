import React, { useEffect, useMemo, useState } from 'react';
import Globe from './components/Globe.jsx';
import HUDFrame from './components/HUDFrame.jsx';
import TopBar from './components/TopBar.jsx';
import ClassifyPanel from './components/ClassifyPanel.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import AnomalyPanel from './components/AnomalyPanel.jsx';
import { REGIONS } from './data/mockData.js';

let userDetectionSeq = 1;

export default function App() {
  const [detections, setDetections] = useState([]);
  const [dataError, setDataError] = useState(null);

  const [regionId, setRegionId] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);

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

  const [classifiedPreview, setClassifiedPreview] = useState(null);

  const visibleDetections = useMemo(
    () => anomaliesOnly ? regionFiltered.filter((d) => d.anomaly) : regionFiltered,
    [regionFiltered, anomaliesOnly]
  );

  const priorityAnomalies = useMemo(
    () => regionFiltered
      .filter((d) => d.anomaly)
      .sort((a, b) => (b.frp * b.confidence) - (a.frp * a.confidence)),
    [regionFiltered]
  );

  const selectedDetection = useMemo(
    () => regionFiltered.find((d) => d.id === selectedId) || (selectedId === classifiedPreview?.id ? classifiedPreview : null),
    [regionFiltered, selectedId, classifiedPreview]
  );

  const regionFlyTo = useMemo(() => {
    if (regionId === 'all') return null;
    const r = REGIONS.find((r) => r.id === regionId);
    return r ? [r.lat, r.lng] : null;
  }, [regionId]);

  const flyTo = manualFocus || regionFlyTo;

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
    setRegionId('all');
    setSelectedId(id);
    setManualFocus([result.lat, result.lng]);
  }

  function handlePointClick(detection) {
    // Always load the full detection data into the classifier when clicking
    // any hotspot on the globe, regardless of pickMode state.
    setPickedCoords({
      lat: Number(detection.lat).toFixed(4),
      lng: Number(detection.lng).toFixed(4),
      detection,
    });
    if (pickMode) setPickMode(false);
  }

  function handleUseHotspotInClassifier(detection) {
    setPickedCoords({
      lat: Number(detection.lat).toFixed(4),
      lng: Number(detection.lng).toFixed(4),
      detection,
    });
    setPickMode(false);
  }

  function handlePriorityAnomaly(detection) {
    setSelectedId(detection.id);
    setManualFocus([detection.lat, detection.lng]);
    setPickedCoords({
      lat: Number(detection.lat).toFixed(4),
      lng: Number(detection.lng).toFixed(4),
      detection,
    });
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
          onPointClick={handlePointClick}
        />
      </div>

      <TopBar
        regionId={regionId}
        onRegionChange={handleRegionChange}
        totalCount={regionFiltered.length}
        pickMode={pickMode}
      />
      {dataError && <div className="api-status">{dataError}</div>}

      <div className="dock dock--left">
        <AnomalyPanel
          anomalies={priorityAnomalies}
          anomaliesOnly={anomaliesOnly}
          onToggleAnomaliesOnly={() => setAnomaliesOnly((value) => !value)}
          onSelect={handlePriorityAnomaly}
          selectedId={selectedId}
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
        <DetailPanel detection={selectedDetection} onUseInClassifier={handleUseHotspotInClassifier} />
      </div>

      <HUDFrame />
    </div>
  );
}
