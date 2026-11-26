// Every tuning number and colour in one place. The world is metres, speeds are
// metres per second, headings are radians (0 = north, towards -z). The renderer
// draws a fixed 1280x720 logical frame scaled to the window, so no rule below
// depends on the screen size.

export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'dustline-ridge.best';

export const PLANE = {
  maxSpeed: 68,        // m/s at full throttle, level flight
  cruiseSpeed: 42,     // m/s the autopilot and the trim hold
  stallSpeed: 17,      // below this the wing stops flying and the plane sinks
  accel: 9,            // m/s^2 towards the throttle's target speed
  drag: 0.35,          // extra drag when the nose is high
  pitchRate: 0.85,     // rad/s at full elevator
  rollRate: 1.9,       // rad/s at full aileron
  turnRate: 0.55,      // heading rad/s per radian of bank, scaled by speed
  maxPitch: 0.62,      // about 35 degrees either way
  maxRoll: 1.15,       // about 66 degrees of bank
  autoLevel: 0.9,      // rad/s the wings roll back to level with no input
  fuelBurn: 0.95,      // fuel units per second at full throttle
  fuelIdle: 0.2,        // fuel units per second at idle
  tank: 120,
};

export const RUNWAY = {
  halfWidth: 14,
  halfLength: 250,
  // The strip runs along z, centred on x = 0, z = 0. Landing heading is north
  // (towards -z): the approach comes in from z = +600, over the village.
  thresholdZ: 250,
};

export const WORLD = {
  waterLevel: 1.5,
  lake: { x: 720, z: 560, radius: 280 },
  lighthouse: { x: -640, z: -760 },
  turbines: [
    { x: 330, z: -420 }, { x: 430, z: -360 }, { x: 520, z: -470 }, { x: 380, z: -560 },
  ],
  village: { x: 130, z: 330, houses: 9 },
  // A ring course is 8 rings; a sortie ends by landing on the strip.
  ringsPerSortie: 8,
  ringRadius: 13,
};

export const SCORE = {
  ring: 100,
  ringTimeBonus: 40,   // extra when a ring is flown fast and clean
  smoothLanding: 250,
  firmLanding: 120,
  sortieComplete: 200,
};

export const PALETTE = {
  backdrop: '#0d1b2e',
  skyTop: '#2f6fb4',
  skyMid: '#7fb2dd',
  skyLow: '#cfe6f2',
  sun: '#fff3c4',
  cloud: 'rgba(255,255,255,0.92)',
  cloudShade: 'rgba(226,238,248,0.9)',
  grassLow: '#67934a',
  grassHigh: '#7fae56',
  meadow: '#8fb45a',
  sand: '#c9b078',
  rock: '#8d8578',
  snow: '#e8eef2',
  water: '#2f7fb8',
  waterDeep: '#1d5a8a',
  runway: '#3a3f46',
  runwayEdge: '#e8e8e8',
  runwayMark: '#f5d90a',
  planeBody: '#e8542f',
  planeCream: '#f7ead2',
  planeDark: '#233246',
  canopy: '#9fd4e8',
  ring: '#ffcf3d',
  ringGlow: 'rgba(255,207,61,0.35)',
  ringDone: '#58c96b',
  panel: '#101820',
  panelEdge: '#2c3a48',
  hudText: '#f2f6f8',
  hudDim: '#aebfc9',
  hudAmber: '#ffb02e',
  hudGreen: '#7be495',
  hudRed: '#ff6b57',
  gaugeFace: '#0b141c',
  gaugeTick: '#cfe0ea',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
