import React, { useEffect, useState } from 'react';
import { REGIONS } from '../data/mockData.js';

function formatUTC(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

export default function TopBar({ regionId, onRegionChange, totalCount, pickMode }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar__row">
        <div className="topbar__brand">
          <span className="topbar__mark" />
          PYROLENS
          <span className="topbar__sub">/ THERMAL ANOMALY CLASSIFIER</span>
        </div>

        <div className="topbar__controls">
          <label className="select-wrap">
            <span className="select-wrap__label">REGION</span>
            <select value={regionId} onChange={(e) => onRegionChange(e.target.value)}>
              <option value="all">ALL REGIONS</option>
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="select-wrap">
            <span className="select-wrap__label">DATE RANGE</span>
            <select defaultValue="2019-2024">
              <option value="2019-2024">2019 – 2024</option>
            </select>
          </label>
        </div>

        <div className="topbar__status">
          <span className="live-dot" />
          LIVE
          <span className="topbar__divider" />
          {totalCount.toLocaleString()} DETECTIONS
          <span className="topbar__divider" />
          {formatUTC(time)}
        </div>
      </div>

      <div className="topbar__hint">
        {pickMode
          ? 'CLICK ANYWHERE ON THE GLOBE TO SET THE CLASSIFY-PANEL COORDINATES'
          : 'DRAG TO ROTATE // SCROLL TO ZOOM // CLICK A POINT TO INSPECT'}
      </div>
    </header>
  );
}
