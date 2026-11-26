// A small seeded random number generator (mulberry32) and a 2D value-noise
// field built on it: the same seed gives the same valley, which is what makes
// the screenshot scenes repeatable.

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic integer hash of a grid point: stable across runs and seeds. */
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Value noise in [-1, 1] at (x, z) for one wavelength, from the seed. */
export function valueNoise(x, z, wavelength, seed) {
  const gx = x / wavelength;
  const gz = z / wavelength;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = smooth(gx - ix);
  const fz = smooth(gz - iz);
  const a = hash2(ix, iz, seed) * 2 - 1;
  const b = hash2(ix + 1, iz, seed) * 2 - 1;
  const c = hash2(ix, iz + 1, seed) * 2 - 1;
  const d = hash2(ix + 1, iz + 1, seed) * 2 - 1;
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

/** Fractal noise: several octaves of value noise, still in roughly [-1, 1]. */
export function fbm(x, z, seed) {
  let total = 0;
  let amplitude = 0.55;
  let wavelength = 420;
  for (let octave = 0; octave < 4; octave += 1) {
    total += valueNoise(x, z, wavelength, seed + octave * 101) * amplitude;
    amplitude *= 0.5;
    wavelength *= 0.45;
  }
  return total;
}
