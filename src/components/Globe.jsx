import React, { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL from 'react-globe.gl';
import { CATEGORIES } from '../data/mockData.js';

const THERMAL_HOTSPOT = '#ff2b24';

export default function Globe({ detections, selectedId, pickedCoords, onSelect, flyTo, onGlobeClick, onPointClick }) {
  const globeRef = useRef();
  const [size, setSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    // The globe is intentionally stationary so a selected FIRMS hotspot stays
    // under the user's cursor while its classifier result is reviewed.
    g.controls().autoRotate = false;
    g.controls().autoRotateSpeed = 0;
    g.controls().enableZoom = true;
    g.pointOfView({ lat: 20, lng: 40, altitude: 2.4 }, 0);
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g || !flyTo) return;
    g.pointOfView({ lat: flyTo[0], lng: flyTo[1], altitude: 1.1 }, 900);
  }, [flyTo]);

  // Anomalous points get a pulsing ring on top of the point cloud.
  const rings = useMemo(
    () =>
      detections
        .filter((d) => d.anomaly)
        .map((d) => ({ lat: d.lat, lng: d.lng, id: d.id })),
    [detections]
  );

  // Render standard hotspots first and anomalies last, so the high-priority
  // markers remain visible even where ordinary FIRMS points are dense.
  const orderedDetections = useMemo(
    () => [...detections].sort((a, b) => Number(a.anomaly) - Number(b.anomaly)),
    [detections]
  );

  const pickedPoint = useMemo(() => {
    const lat = Number.parseFloat(pickedCoords.lat);
    const lng = Number.parseFloat(pickedCoords.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? [{ lat, lng, text: 'SELECTED LOCATION' }]
      : [];
  }, [pickedCoords]);

  return (
    <GlobeGL
      ref={globeRef}
      globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
      backgroundColor="rgba(0,0,0,0)"
      atmosphereColor="#77caff"
      atmosphereAltitude={0.12}
      width={size.width}
      height={size.height}
      pointsData={orderedDetections}
      pointLat="lat"
      pointLng="lng"
      // Ordinary hotspots fade into the background. Anomalies have a bright
      // high-contrast core and are larger than surrounding thermal readings.
      pointColor={(d) => (d.id === selectedId ? '#ffffff' : d.anomaly ? '#ffe66d' : THERMAL_HOTSPOT)}
      pointAltitude={(d) => d.anomaly ? 0.028 : 0.004 + d.confidence * 0.008}
      pointRadius={(d) => (d.id === selectedId ? 0.13 : d.anomaly ? 0.075 : 0.018 + d.confidence * 0.01)}
      pointResolution={8}
      pointsMerge={false}
      pointLabel={(d) => `${d.anomaly ? '<b>⚠ PRIORITY ANOMALY</b><br/>' : ''}<b>THERMAL HOTSPOT · ${d.id}</b><br/>AGNI classification: ${CATEGORIES[d.category].label}<br/>${d.frp} MW FRP · ${Math.round(d.confidence * 100)}%`}
      onPointClick={(d) => {
        onSelect(d.id);
        if (onPointClick) onPointClick(d);
      }}
      onGlobeClick={onGlobeClick}
      labelsData={pickedPoint}
      labelLat="lat"
      labelLng="lng"
      labelText="text"
      labelColor={() => '#39ff88'}
      labelSize={0.72}
      labelDotRadius={0.14}
      labelAltitude={0.02}
      ringsData={rings}
      ringLat="lat"
      ringLng="lng"
      ringColor={() => (t) => `rgba(255,230,109,${1 - t})`}
      ringMaxRadius={1.05}
      ringPropagationSpeed={1.35}
      ringRepeatPeriod={1700}
    />
  );
}
