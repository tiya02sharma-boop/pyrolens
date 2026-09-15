// Simplified, transparent stand-in for the real pipeline (section 2/4 of
// the project doc): land-cover + OSM proximity, Sentinel-2 spectral
// indices, the physics-based flare test, and a trained Random
// Forest/XGBoost classifier. None of that is available client-side, so
// this approximates the *signals* the real system uses — proximity to
// known industrial/mining activity, FRP magnitude, and the flare
// heat/brightness relationship — with plain arithmetic, and exposes the
// reasoning so it's obvious this is a stand-in, not the trained model.
//
// Swap the body of `classifyDetection` for a `fetch()` to the real
// classifier API and keep the same return shape to drop it in.

import { CATEGORIES, REGIONS } from '../data/mockData.js';

const CATEGORY_KEYS = Object.keys(CATEGORIES);

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function argmax(scores) {
  return Object.entries(scores).reduce((best, [k, v]) => (v > best[1] ? [k, v] : best), ['industrial', -1])[0];
}

/**
 * @param {{lat:number, lng:number, frp:number, brightness:?number}} input
 * @returns {{category:string, confidence:number, scores:Object, signals:string[]}}
 */
export function classifyDetection({ lat, lng, frp, brightness }) {
  // --- Signal 1: proximity to known activity (stand-in for OSM
  // industrial/mining polygons + land-cover class at the pixel) ---
  const withDistance = REGIONS.map((r) => ({ ...r, dist: haversineKm(lat, lng, r.lat, r.lng) }));
  const nearest = [...withDistance].sort((a, b) => a.dist - b.dist)[0];

  const proximity = {};
  CATEGORY_KEYS.forEach((k) => (proximity[k] = 0));
  withDistance.forEach((r) => {
    proximity[r.category] += Math.exp(-r.dist / 500); // ~500km decay radius
  });
  const proxTotal = Object.values(proximity).reduce((a, b) => a + b, 0) || 1;
  CATEGORY_KEYS.forEach((k) => (proximity[k] /= proxTotal));

  // --- Signal 2: FRP magnitude (rough per-category profile) ---
  const frpRaw = {
    wildfire: clamp01((frp - 80) / 150),
    industrial: clamp01(1 - Math.abs(frp - 45) / 60),
    agricultural: clamp01(1 - frp / 40),
    mining: clamp01(1 - Math.abs(frp - 25) / 40),
    flare: clamp01(1 - Math.abs(frp - 20) / 35),
  };
  const frpTotal = Object.values(frpRaw).reduce((a, b) => a + b, 0) || 1;
  const frpSignal = {};
  CATEGORY_KEYS.forEach((k) => (frpSignal[k] = frpRaw[k] / frpTotal));

  // --- Combine ---
  const scores = {};
  CATEGORY_KEYS.forEach((k) => (scores[k] = 0.55 * proximity[k] + 0.45 * frpSignal[k]));

  // --- Signal 3: physics-based flare test (only if brightness supplied) ---
  let flareStrength = null;
  if (brightness != null && !Number.isNaN(brightness)) {
    // Flares burn hot but dim/small: high brightness temp, comparatively
    // low FRP. This is a coarse stand-in for the real temperature/FRP
    // ratio test described in the doc.
    flareStrength = clamp01((brightness - 850) / 900) * clamp01(1 - frp / 150);
    scores.flare += flareStrength * 0.6;
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  CATEGORY_KEYS.forEach((k) => (scores[k] /= total));

  const category = argmax(scores);
  const confidence = Math.round(scores[category] * 100) / 100;

  const bestFrpCategory = argmax(frpSignal);

  const signals = [
    `Nearest known activity: ${CATEGORIES[nearest.category].label} zone near ${nearest.name}, ~${Math.round(
      nearest.dist
    )} km away.`,
    `${frp} MW FRP is most consistent with the ${CATEGORIES[bestFrpCategory].label} profile.`,
  ];

  if (flareStrength != null) {
    signals.push(
      flareStrength > 0.5
        ? `${brightness} K brightness against ${frp} MW FRP matches a gas-flare signature (hot, low-power).`
        : `${brightness} K brightness against ${frp} MW FRP does not match the flare profile.`
    );
  } else {
    signals.push('No brightness temperature supplied — physics-based flare test skipped.');
  }

  return { category, confidence, scores, signals };
}
