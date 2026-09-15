import React, { useEffect, useMemo, useRef, useState } from 'react';
import GlobeGL from 'react-globe.gl';
import { CATEGORIES } from '../data/mockData.js';

export default function Globe({ detections, selectedId, pickedCoords, onSelect, flyTo, onGlobeClick }) {
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
    g.controls().autoRotate = true;
    g.controls().autoRotateSpeed = 0.35;
    g.controls().enableZoom = true;
    g.pointOfView({ lat: 20, lng: 40, altitude: 2.4 }, 0);
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g || !flyTo) return;
    g.controls().autoRotate = false;
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
      globeImageUrl="https://unpkg.com/three-globe/example/img/earth-night.jpg"
      bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
      backgroundColor="rgba(0,0,0,0)"
      atmosphereColor="#39ff88"
      atmosphereAltitude={0.18}
      width={size.width}
      height={size.height}
      pointsData={detections}
      pointLat="lat"
      pointLng="lng"
      pointColor={(d) => (d.id === selectedId ? '#ffffff' : CATEGORIES[d.category].color)}
      pointAltitude={(d) => 0.006 + d.confidence * 0.02}
      pointRadius={(d) => (d.id === selectedId ? 0.16 : 0.035 + d.confidence * 0.025)}
      pointResolution={8}
      pointsMerge={false}
      pointLabel={(d) => `<b>${d.id}</b><br/>${CATEGORIES[d.category].label}<br/>${d.frp} MW FRP · ${Math.round(d.confidence * 100)}%`}
      onPointClick={(d) => onSelect(d.id)}
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
      ringColor={() => (t) => `rgba(255,59,59,${1 - t})`}
      ringMaxRadius={0.75}
      ringPropagationSpeed={1.8}
      ringRepeatPeriod={1400}
    />
  );
}
