// Synthetic data standing in for real classified detections coming out of
// PostGIS in the actual system (see Architecture, section 4 of the project
// doc). Shape mirrors what the classifier + historical tracker would output
// per-row: category, confidence, FRP, and persistence/anomaly status.

export const CATEGORIES = {
  industrial: { label: 'INDUSTRIAL', color: '#ff8a3d' },
  flare: { label: 'GAS FLARE', color: '#3dd6ff' },
  agricultural: { label: 'AGRICULTURAL', color: '#ffe066' },
  wildfire: { label: 'WILDFIRE', color: '#ff3b3b' },
  mining: { label: 'MINING (PERSISTENT)', color: '#b083ff' },
};

// From section 10 of the project doc — training regions, each with a
// dominant category focus, used here as anchor points for synthetic
// detections.
export const REGIONS = [
  { id: 'punjab-haryana', name: 'Punjab / Haryana, IN', lat: 30.4, lng: 75.6, category: 'agricultural' },
  { id: 'jharia-raniganj', name: 'Jharia / Raniganj Coalfield, IN', lat: 23.75, lng: 86.4, category: 'mining' },
  { id: 'jamnagar', name: 'Jamnagar, Gujarat, IN', lat: 22.35, lng: 70.05, category: 'flare' },
  { id: 'delhi-ncr', name: 'Delhi / NCR, IN', lat: 28.6, lng: 77.2, category: 'industrial' },
  { id: 'california-pnw', name: 'California / Pacific NW, US', lat: 39.5, lng: -121.5, category: 'wildfire' },
  { id: 'gulf-coast', name: 'Texas / Louisiana Gulf Coast, US', lat: 29.6, lng: -94.6, category: 'industrial' },
  { id: 'palouse', name: 'Palouse (WA) / Midwest, US', lat: 46.9, lng: -117.4, category: 'agricultural' },
];

function jitter(base, spread) {
  return base + (Math.random() - 0.5) * spread;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const CATEGORY_KEYS = Object.keys(CATEGORIES);

export function generateDetections(perRegion = 22) {
  const detections = [];
  let id = 1;

  REGIONS.forEach((region) => {
    for (let i = 0; i < perRegion; i++) {
      // ~78% match the region's dominant category (realistic clustering),
      // the rest are "noise" from a different class nearby.
      const category = Math.random() < 0.78 ? region.category : pick(CATEGORY_KEYS);
      const isPersistentType = category === 'mining' || category === 'flare';
      const persistent = isPersistentType ? Math.random() < 0.6 : Math.random() < 0.08;
      const anomaly = Math.random() < 0.09;

      detections.push({
        id: `FIRMS-${String(id).padStart(5, '0')}`,
        region: region.name,
        regionId: region.id,
        lat: jitter(region.lat, 2.4),
        lng: jitter(region.lng, 2.4),
        category,
        confidence: Math.round((0.45 + Math.random() * 0.54) * 100) / 100,
        frp: Math.round((2 + Math.random() * 180) * 10) / 10, // Fire Radiative Power, MW
        firstDetected: randomDate(),
        acqTime: randomTime(),
        persistent,
        activeMonths: persistent ? Math.round(1 + Math.random() * 48) : 0,
        anomaly,
      });
      id += 1;
    }
  });

  return detections;
}

function randomDate() {
  const start = new Date(2019, 0, 1).getTime();
  const end = new Date(2024, 11, 31).getTime();
  const d = new Date(start + Math.random() * (end - start));
  return d.toISOString().slice(0, 10);
}

function randomTime() {
  const h = String(Math.floor(Math.random() * 24)).padStart(2, '0');
  const m = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  return `${h}:${m}`;
}
