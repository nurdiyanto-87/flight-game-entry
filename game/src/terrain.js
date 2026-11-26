// The valley itself: a heightfield over (x, z), the flat Dustline strip, the
// lake, the lighthouse hill, the turbine ridge and the village, plus the ring
// course each sortie flies. Nothing here draws or moves; it answers questions
// about the ground so the flight model and the renderer can stay honest.

import { RUNWAY, WORLD } from './config.js';
import { createRandom, fbm, valueNoise } from './random.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Build the terrain for one seed. `height(x, z)` is the ground in metres; the
 * strip is flattened to 0, the lake basin dips below the water line, and a
 * mountain wall rises far to the north so the horizon never ends in flat sky.
 */
export function createTerrain(seed) {
  const random = createRandom(seed ^ 0x5eed);
  const hillJitter = random();

  function rawHeight(x, z) {
    // Rolling hills, a broader swell, and a fine ripple on top. The valley
    // floor sits around +14 m so only the lake basin falls below the water.
    let h = 14 + fbm(x + 130, z - 70, seed) * 22 + valueNoise(x, z, 900, seed + 7) * 15;
    // The northern wall: beyond z = -1100 the ground climbs into mountains.
    const north = smoothstep(1100, 1900, -z);
    h += north * (120 + fbm(x * 0.5, z * 0.5, seed + 31) * 60);
    // The lake basin: a smooth bowl around the lake centre.
    const dx = x - WORLD.lake.x;
    const dz = z - WORLD.lake.z;
    const dLake = Math.sqrt(dx * dx + dz * dz);
    h -= (1 - smoothstep(WORLD.lake.radius * 0.5, WORLD.lake.radius * 1.6, dLake)) * 14;
    // A proud hill for the lighthouse, south-west of the strip.
    const lx = x - WORLD.lighthouse.x;
    const lz = z - WORLD.lighthouse.z;
    const dLight = Math.sqrt(lx * lx + lz * lz);
    h += (1 - smoothstep(0, 260, dLight)) * 34;
    return h;
  }

  function height(x, z) {
    let h = rawHeight(x, z);
    // Away from the lake the ground never dips below the water line, so
    // ponds only ever form in the lake basin itself.
    const dxLake = x - WORLD.lake.x;
    const dzLake = z - WORLD.lake.z;
    const dLake = Math.sqrt(dxLake * dxLake + dzLake * dzLake);
    if (dLake > WORLD.lake.radius * 1.6) h = Math.max(h, 3);
    // Flatten the strip and its apron: the ground eases to exactly 0 there.
    const dxStrip = Math.abs(x) - RUNWAY.halfWidth;
    const dzStrip = Math.abs(z) - RUNWAY.halfLength;
    const dStrip = Math.max(dxStrip, dzStrip);
    const flat = 1 - smoothstep(0, 90, dStrip);
    return h * (1 - flat);
  }

  function isWater(x, z) {
    return height(x, z) < WORLD.waterLevel - 0.4;
  }

  /** True inside the strip's flattened apron (never water, never a lake). */
  function isStripArea(x, z) {
    return Math.abs(x) <= RUNWAY.halfWidth + 90 && Math.abs(z) <= RUNWAY.halfLength + 90;
  }

  function groundType(x, z) {
    const h = height(x, z);
    if (h < WORLD.waterLevel + 0.6) return 'sand';
    if (h > 120) return 'snow';
    if (h > 58) return 'rock';
    return 'grass';
  }

  return { seed, hillJitter, height, isWater, groundType, isStripArea };
}

/**
 * The ring course for one sortie: 8 rings that weave out from the strip, over
 * the lake and the turbine ridge, and back for a landing. Each ring faces the
 * direction of travel so the plane flies through it, not past it. The sortie
 * number tightens the course: later sorties sit lower and closer together.
 */
export function buildCourse(terrain, sortie) {
  const random = createRandom((terrain.seed ^ 0x51ab) + sortie * 7919);
  const rings = [];
  // Waypoints: a loop out over the valley and home. Altitudes drop as the
  // sortie number rises, so later sorties hug the hills.
  const drop = Math.min(26, (sortie - 1) * 6);
  const waypoints = [
    { x: 0, z: -380, alt: 55 },
    { x: -260, z: -700, alt: 70 },
    { x: -560, z: -420, alt: 60 },
    { x: -420, z: 120, alt: 48 },
    { x: 240, z: 420, alt: 55 },
    { x: 700, z: 560, alt: 42 },
    { x: 620, z: 60, alt: 58 },
    { x: 180, z: -260, alt: 50 },
  ];
  for (let i = 0; i < waypoints.length; i += 1) {
    const wp = waypoints[i];
    const jitterX = (random() - 0.5) * 60;
    const jitterZ = (random() - 0.5) * 60;
    const x = wp.x + jitterX;
    const z = wp.z + jitterZ;
    const ground = terrain.height(x, z);
    const y = Math.max(wp.alt - drop, ground + 16);
    // The ring faces the way the plane arrives: its normal is the direction
    // of travel from the previous waypoint into this ring, so the crossing
    // test (from negative to positive along the normal) fires as the plane
    // flies through. Facing it at the next waypoint instead would point it
    // at the incoming plane and the crossing would never register.
    const prev = i === 0 ? { x: 0, z: 200 } : waypoints[i - 1];
    const dx = x - prev.x;
    const dz = z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    rings.push({
      x, y, z,
      nx: dx / len, ny: 0, nz: dz / len,
      radius: 13,
      passed: false,
    });
  }
  return rings;
}

/** Where a sortie starts: parked on the strip, nose north, engine idling. */
export function startPose() {
  return { x: 0, y: 0.4, z: 200, heading: 0, pitch: 0, roll: 0, speed: 0 };
}
