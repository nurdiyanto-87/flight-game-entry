// Drawing only: the world and the current screen in, pixels out. A small
// software 3D projector turns world points into screen points; the terrain
// is painted far to near as coloured quads, the plane is a vector sprite in
// chase view, and the cockpit view swaps the sprite for lit instruments.
// The 1280x720 logical frame is scaled to fit the window and centred.

import { FONT, FONT_MONO, PALETTE, PLANE, RUNWAY, VIEW, WORLD } from './config.js';
import { MISSION_COMPLETE, MISSION_CRASHED, currentRing, ringGuidance } from './missions.js';
import { fbm, valueNoise } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_COMPLETE = 'complete';

export const CAMERA_CHASE = 'chase';
export const CAMERA_COCKPIT = 'cockpit';

const CELL = 50;
const GRID = 44; // 44 x 44 cells of 50 m = 2.2 km of ground in view
const FOV = (68 * Math.PI) / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Parse #rrggbb into [r, g, b]. */
function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Blend two colours (as #rrggbb or [r,g,b]) by t, return a css colour. */
function mix(a, b, t) {
  const ca = typeof a === 'string' ? rgb(a) : a;
  const cb = typeof b === 'string' ? rgb(b) : b;
  const r = Math.round(lerp(ca[0], cb[0], t));
  const g = Math.round(lerp(ca[1], cb[1], t));
  const bl = Math.round(lerp(ca[2], cb[2], t));
  return `rgb(${r},${g},${bl})`;
}

function shade(hex, factor) {
  const c = rgb(hex);
  const r = Math.round(clamp(c[0] * factor, 0, 255));
  const g = Math.round(clamp(c[1] * factor, 0, 255));
  const b = Math.round(clamp(c[2] * factor, 0, 255));
  return `rgb(${r},${g},${b})`;
}

export function createRenderer(canvas, terrain) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const focal = (VIEW.height / 2) / Math.tan(FOV / 2);
  // Smoothed camera attitude, so the view never snaps with the stick.
  const cam = { heading: 0, pitch: 0, roll: 0 };
  let cameraMode = CAMERA_CHASE;

  // Clouds drift nowhere: fixed in the sky, placed by the terrain's seed.
  const clouds = [];
  {
    let s = terrain.seed ^ 0xc10d;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 0) / 4294967296);
    };
    for (let i = 0; i < 16; i += 1) {
      clouds.push({
        x: (rnd() - 0.5) * 5200,
        y: 160 + rnd() * 120,
        z: (rnd() - 0.5) * 5200,
        size: 70 + rnd() * 90,
      });
    }
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, mono) {
    const key = size + (mono ? 'm' : '');
    if (!fonts.has(key)) fonts.set(key, `${size}px ${mono ? FONT_MONO : FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function textTop(value, x, y, size, color, align, mono) {
    context.textBaseline = 'top';
    text(value, x, y, size, color, align, mono);
  }

  // ---- 3D projection -------------------------------------------------
  let camPos = { x: 0, y: 0, z: 0 };
  let basis = { fx: 0, fy: 0, fz: -1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };

  function updateCamera(plane, dt) {
    const targetHeading = plane.heading;
    const targetPitch = plane.pitch * 0.55;
    const k = 1 - Math.exp(-dt * 5);
    let dh = targetHeading - cam.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    cam.heading += dh * k;
    cam.pitch = lerp(cam.pitch, targetPitch, k);
    cam.roll = lerp(cam.roll, plane.roll * 0.35, k);

    const ch = Math.cos(cam.heading);
    const sh = Math.sin(cam.heading);
    const cp = Math.cos(cam.pitch);
    // Forward from the smoothed camera attitude.
    const fwd = { x: sh * cp, y: Math.sin(cam.pitch), z: -ch * cp };
    if (cameraMode === CAMERA_COCKPIT) {
      camPos = {
        x: plane.x + fwd.x * 1.6,
        y: plane.y + 1.1,
        z: plane.z + fwd.z * 1.6,
      };
    } else {
      camPos = {
        x: plane.x - fwd.x * 30,
        y: plane.y - fwd.y * 30 + 5.5,
        z: plane.z - fwd.z * 30,
      };
      // Never let the chase camera sink into a hillside.
      const ground = terrain.height(camPos.x, camPos.z);
      if (camPos.y < ground + 2) camPos.y = ground + 2;
    }
    const look = {
      x: plane.x + fwd.x * 40,
      y: plane.y + fwd.y * 40 + 5,
      z: plane.z + fwd.z * 40,
    };
    let fx = look.x - camPos.x;
    let fy = look.y - camPos.y;
    let fz = look.z - camPos.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // Right = forward x world-up, then up = right x forward; roll the up
    // vector a little with the bank so the horizon tilts with the plane.
    let rx = -fz;
    let rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // up = cross(right, forward), with right = (rx, 0, rz):
    //   up_x = -rz*fy, up_y = rz*fx - rx*fz, up_z = rx*fy
    let ux = -rz * fy;
    let uy = rz * fx - rx * fz;
    let uz = rx * fy;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    // Apply the camera roll around the forward axis.
    const cr = Math.cos(cam.roll);
    const sr = Math.sin(cam.roll);
    const nrx = rx * cr + ux * sr;
    const nry = 0 * cr + uy * sr;
    const nrz = rz * cr + uz * sr;
    const nux = ux * cr - rx * sr;
    const nuy = uy * cr - 0 * sr;
    const nuz = uz * cr - rz * sr;
    basis = { fx, fy, fz, rx: nrx, ry: nry, rz: nrz, ux: nux, uy: nuy, uz: nuz };
  }

  /** Project a world point to logical screen space, or null if behind. */
  function project(x, y, z) {
    const dx = x - camPos.x;
    const dy = y - camPos.y;
    const dz = z - camPos.z;
    const cz = dx * basis.fx + dy * basis.fy + dz * basis.fz;
    if (cz < 0.6) return null;
    const cx = dx * basis.rx + dy * basis.ry + dz * basis.rz;
    const cy = dx * basis.ux + dy * basis.uy + dz * basis.uz;
    const s = focal / cz;
    return { x: VIEW.width / 2 + cx * s, y: VIEW.height / 2 - cy * s, s, depth: cz };
  }

  // ---- sky, ridge, clouds ---------------------------------------------
  function drawSky(plane) {
    const gradient = context.createLinearGradient(0, 0, 0, VIEW.height);
    gradient.addColorStop(0, PALETTE.skyTop);
    gradient.addColorStop(0.55, PALETTE.skyMid);
    gradient.addColorStop(0.8, PALETTE.skyLow);
    gradient.addColorStop(1, PALETTE.skyLow);
    context.fillStyle = gradient;
    context.fillRect(0, 0, VIEW.width, VIEW.height);

    // The sun, fixed in the north-west sky.
    const sun = project(camPos.x - 2600, camPos.y + 900, camPos.z - 3200);
    if (sun) {
      context.fillStyle = PALETTE.sun;
      context.beginPath();
      context.arc(sun.x, sun.y, 34, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255,243,196,0.25)';
      context.beginPath();
      context.arc(sun.x, sun.y, 58, 0, Math.PI * 2);
      context.fill();
    }

    // The horizon line at the camera's eye level, then the jagged northern
    // ridge drawn along it so the world never ends in flat colour.
    const horizon = project(camPos.x + basis.fx * 4000, camPos.y, camPos.z + basis.fz * 4000);
    const hy = horizon ? horizon.y : VIEW.height / 2;
    context.fillStyle = mix(PALETTE.skyMid, '#5d7d99', 0.5);
    context.beginPath();
    context.moveTo(0, VIEW.height);
    context.lineTo(0, hy + 6);
    for (let x = 0; x <= VIEW.width; x += 32) {
      const peak = valueNoise(x * 0.7 + plane.heading * 900, 3.7, 140, 11) * 46
        + valueNoise(x * 0.23, 9.1, 320, 23) * 26;
      context.lineTo(x, hy + 6 - Math.abs(peak) - 8);
    }
    context.lineTo(VIEW.width, VIEW.height);
    context.closePath();
    context.fill();

    // Clouds: soft white clusters, drawn before the ground so hills can
    // pass in front of a low one.
    for (const cloud of clouds) {
      const p = project(cloud.x, cloud.y, cloud.z);
      if (!p) continue;
      const size = cloud.size * p.s;
      if (size < 4) continue;
      context.fillStyle = PALETTE.cloud;
      context.beginPath();
      context.ellipse(p.x, p.y, size, size * 0.36, 0, 0, Math.PI * 2);
      context.ellipse(p.x - size * 0.45, p.y + size * 0.08, size * 0.6, size * 0.26, 0, 0, Math.PI * 2);
      context.ellipse(p.x + size * 0.5, p.y + size * 0.06, size * 0.55, size * 0.24, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  // ---- terrain ---------------------------------------------------------
  function groundColour(x, z, h) {
    const type = terrain.groundType(x, z);
    if (type === 'sand') return PALETTE.sand;
    if (type === 'rock') return shade(PALETTE.rock, 0.92 + valueNoise(x, z, 0.011, 5) * 0.12);
    if (type === 'snow') {
      // Snow fades in over the rock above 120 m so the peaks read as
      // mountains, not a white shelf.
      const blend = clamp((h - 120) / 45, 0.15, 1);
      return mix(shade(PALETTE.rock, 0.95), PALETTE.snow, blend);
    }
    // Grass varies from low green to high meadow by the noise field.
    const n = fbm(x * 0.8, z * 0.8, 77);
    return mix(PALETTE.grassLow, PALETTE.meadow, clamp(0.5 + n * 0.7, 0, 1));
  }

  function drawTerrain(plane) {
    const items = [];
    const ox = Math.floor(camPos.x / CELL) * CELL;
    const oz = Math.floor(camPos.z / CELL) * CELL;
    const half = (GRID / 2) * CELL;
    for (let gz = 0; gz < GRID; gz += 1) {
      for (let gx = 0; gx < GRID; gx += 1) {
        const x0 = ox - half + gx * CELL;
        const z0 = oz - half + gz * CELL;
        const cx = x0 + CELL / 2;
        const cz = z0 + CELL / 2;
        const dx = cx - camPos.x;
        const dz = cz - camPos.z;
        const depth = dx * basis.fx + dz * basis.fz;
        if (depth < -CELL) continue;
        const h00 = terrain.height(x0, z0);
        const h10 = terrain.height(x0 + CELL, z0);
        const h01 = terrain.height(x0, z0 + CELL);
        const h11 = terrain.height(x0 + CELL, z0 + CELL);
        const hc = (h00 + h10 + h01 + h11) / 4;
        // Slope darkening: steep ground reads darker.
        const slope = Math.abs(h10 - h00) + Math.abs(h01 - h00);
        let colour = groundColour(cx, cz, hc);
        if (slope > 6) colour = shade(colour, 1 - Math.min(0.25, (slope - 6) * 0.012));
        // Distance haze towards the sky: light, so far hills stay hills.
        const fog = clamp((depth - 1000) / 2200, 0, 0.3);
        if (fog > 0) colour = mix(colour, PALETTE.skyLow, fog);
        items.push({ depth, kind: 'ground', x0, z0, h00, h10, h01, h11, colour });
        if (hc < WORLD.waterLevel && !terrain.isStripArea(cx, cz)) {
          items.push({ depth: depth - 0.5, kind: 'water', x0, z0, colour: mix(PALETTE.water, PALETTE.waterDeep, clamp((WORLD.waterLevel - hc) / 6, 0, 1)) });
        }
      }
    }
    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) {
      if (item.kind === 'water') {
        const p00 = project(item.x0, WORLD.waterLevel, item.z0);
        const p10 = project(item.x0 + CELL, WORLD.waterLevel, item.z0);
        const p01 = project(item.x0, WORLD.waterLevel, item.z0 + CELL);
        const p11 = project(item.x0 + CELL, WORLD.waterLevel, item.z0 + CELL);
        if (!p00 || !p10 || !p01 || !p11) continue;
        context.fillStyle = item.colour;
        context.globalAlpha = 0.85;
        context.beginPath();
        context.moveTo(p00.x, p00.y);
        context.lineTo(p10.x, p10.y);
        context.lineTo(p11.x, p11.y);
        context.lineTo(p01.x, p01.y);
        context.closePath();
        context.fill();
        context.globalAlpha = 1;
        continue;
      }
      const p00 = project(item.x0, item.h00, item.z0);
      const p10 = project(item.x0 + CELL, item.h10, item.z0);
      const p01 = project(item.x0, item.h01, item.z0 + CELL);
      const p11 = project(item.x0 + CELL, item.h11, item.z0 + CELL);
      if (!p00 || !p10 || !p01 || !p11) continue;
      context.fillStyle = item.colour;
      context.beginPath();
      context.moveTo(p00.x, p00.y);
      context.lineTo(p10.x, p10.y);
      context.lineTo(p11.x, p11.y);
      context.lineTo(p01.x, p01.y);
      context.closePath();
      context.fill();
    }
  }

  function drawQuad(points, colour, alpha) {
    const projected = points.map((p) => project(p[0], p[1], p[2]));
    if (projected.some((p) => !p)) return;
    context.globalAlpha = alpha === undefined ? 1 : alpha;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(projected[0].x, projected[0].y);
    for (let i = 1; i < projected.length; i += 1) context.lineTo(projected[i].x, projected[i].y);
    context.closePath();
    context.fill();
    context.globalAlpha = 1;
  }

  // ---- the strip and its landmarks --------------------------------------
  function drawRunway() {
    const y = 0.15;
    // Asphalt.
    drawQuad([
      [-RUNWAY.halfWidth, y, -RUNWAY.halfLength],
      [RUNWAY.halfWidth, y, -RUNWAY.halfLength],
      [RUNWAY.halfWidth, y, RUNWAY.halfLength],
      [-RUNWAY.halfWidth, y, RUNWAY.halfLength],
    ], PALETTE.runway);
    // Edge lines and centreline dashes.
    for (const side of [-1, 1]) {
      drawQuad([
        [side * (RUNWAY.halfWidth - 1.2), y + 0.02, -RUNWAY.halfLength],
        [side * (RUNWAY.halfWidth - 0.4), y + 0.02, -RUNWAY.halfLength],
        [side * (RUNWAY.halfWidth - 0.4), y + 0.02, RUNWAY.halfLength],
        [side * (RUNWAY.halfWidth - 1.2), y + 0.02, RUNWAY.halfLength],
      ], PALETTE.runwayEdge, 0.9);
    }
    for (let z = -RUNWAY.halfLength + 20; z < RUNWAY.halfLength - 10; z += 40) {
      drawQuad([
        [-1.1, y + 0.02, z], [1.1, y + 0.02, z],
        [1.1, y + 0.02, z + 18], [-1.1, y + 0.02, z + 18],
      ], PALETTE.runwayMark, 0.95);
    }
    // Threshold bars at both ends.
    for (const end of [-1, 1]) {
      const z = end * (RUNWAY.halfLength - 8);
      for (let i = -3; i <= 3; i += 1) {
        if (i === 0) continue;
        drawQuad([
          [i * 3.4 - 1.2, y + 0.02, z - 6], [i * 3.4 + 1.2, y + 0.02, z - 6],
          [i * 3.4 + 1.2, y + 0.02, z + 6], [i * 3.4 - 1.2, y + 0.02, z + 6],
        ], PALETTE.runwayEdge, 0.95);
      }
    }
    // Windsock beside the strip, leaning into the wind.
    const wx = RUNWAY.halfWidth + 18;
    const wz = 120;
    const wy = terrain.height(wx, wz);
    drawQuad([[wx - 0.2, wy, wz], [wx + 0.2, wy, wz], [wx + 0.2, wy + 7, wz], [wx - 0.2, wy + 7, wz]], '#d8d8d8');
    drawQuad([[wx, wy + 7, wz], [wx + 5.5, wy + 6.2, wz], [wx + 5.5, wy + 5.2, wz], [wx, wy + 5.6, wz]], '#ff7a1a');
  }

  function drawBox(x, y, z, w, h, d, colour, roofColour) {
    const hw = w / 2;
    const hd = d / 2;
    // Top face, then the two faces towards the camera (approx: south + east).
    drawQuad([[x - hw, y + h, z - hd], [x + hw, y + h, z - hd], [x + hw, y + h, z + hd], [x - hw, y + h, z + hd]], roofColour || shade(colour, 1.25));
    drawQuad([[x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, y + h, z + hd], [x - hw, y + h, z + hd]], colour);
    drawQuad([[x + hw, y, z - hd], [x + hw, y, z + hd], [x + hw, y + h, z + hd], [x + hw, y + h, z - hd]], shade(colour, 0.8));
  }

  function drawLandmarks(time) {
    // The lighthouse on its hill: red and white bands, a lamp room, a beam.
    const lx = WORLD.lighthouse.x;
    const lz = WORLD.lighthouse.z;
    const ly = terrain.height(lx, lz);
    const base = project(lx, ly, lz);
    if (base) {
      const top = project(lx, ly + 26, lz);
      if (top) {
        const segments = 5;
        for (let i = 0; i < segments; i += 1) {
          const y0 = ly + (i * 26) / segments;
          const y1 = ly + ((i + 1) * 26) / segments;
          const p0 = project(lx - 2.6, y0, lz);
          const p1 = project(lx + 2.6, y0, lz);
          const p2 = project(lx + 2.2, y1, lz);
          const p3 = project(lx - 2.2, y1, lz);
          if (!p0 || !p1 || !p2 || !p3) continue;
          context.fillStyle = i % 2 === 0 ? '#e8e4da' : '#c23b2e';
          context.beginPath();
          context.moveTo(p0.x, p0.y); context.lineTo(p1.x, p1.y);
          context.lineTo(p2.x, p2.y); context.lineTo(p3.x, p3.y);
          context.closePath(); context.fill();
        }
        // Lamp room and its slow beam across the valley.
        context.fillStyle = '#ffe9a8';
        context.beginPath();
        context.arc(top.x, top.y, Math.max(2, 2.4 * top.s), 0, Math.PI * 2);
        context.fill();
        const beamAngle = time * 0.25;
        const bx = lx + Math.cos(beamAngle) * 260;
        const bz = lz + Math.sin(beamAngle) * 260;
        const beamEnd = project(bx, ly + 24, bz);
        if (beamEnd) {
          context.strokeStyle = 'rgba(255,233,168,0.28)';
          context.lineWidth = Math.max(2, 7 * top.s);
          context.beginPath();
          context.moveTo(top.x, top.y);
          context.lineTo(beamEnd.x, beamEnd.y);
          context.stroke();
        }
      }
    }
    // Wind turbines on the ridge: a pole and three slow blades each.
    for (const turbine of WORLD.turbines) {
      const ty = terrain.height(turbine.x, turbine.z);
      const hub = project(turbine.x, ty + 22, turbine.z);
      const foot = project(turbine.x, ty, turbine.z);
      if (!hub || !foot) continue;
      context.strokeStyle = '#e8ecef';
      context.lineWidth = Math.max(1.5, 1.6 * hub.s);
      context.beginPath();
      context.moveTo(foot.x, foot.y);
      context.lineTo(hub.x, hub.y);
      context.stroke();
      const bladeLen = 11 * hub.s;
      const spin = time * 0.9 + turbine.x;
      for (let b = 0; b < 3; b += 1) {
        const a = spin + (b * Math.PI * 2) / 3;
        context.strokeStyle = '#f4f6f7';
        context.lineWidth = Math.max(1.5, 2.2 * hub.s);
        context.beginPath();
        context.moveTo(hub.x, hub.y);
        context.lineTo(hub.x + Math.cos(a) * bladeLen, hub.y + Math.sin(a) * bladeLen);
        context.stroke();
      }
      context.fillStyle = '#dfe5e9';
      context.beginPath();
      context.arc(hub.x, hub.y, Math.max(1.5, 1.6 * hub.s), 0, Math.PI * 2);
      context.fill();
    }
    // The village: a handful of houses with lit windows, east of the strip.
    for (let i = 0; i < WORLD.village.houses; i += 1) {
      const hx = WORLD.village.x + ((i * 37) % 90) - 45;
      const hz = WORLD.village.z + ((i * 53) % 110) - 55;
      const hy = terrain.height(hx, hz);
      const palette = ['#b98d5e', '#a86f4d', '#8f7d5a', '#7d8a6a'];
      drawBox(hx, hy, hz, 12, 6, 10, palette[i % palette.length], '#5a4632');
      const win = project(hx, hy + 3.4, hz + 5.1);
      if (win) {
        context.fillStyle = '#ffd977';
        context.fillRect(win.x - 1.5 * win.s, win.y - 1.5 * win.s, 3 * win.s, 3 * win.s);
      }
    }
  }

  // ---- rings ------------------------------------------------------------
  function drawRings(mission, time) {
    for (let i = 0; i < mission.rings.length; i += 1) {
      const ring = mission.rings[i];
      const isNext = i === mission.ringIndex;
      const done = ring.passed;
      const u1x = -ring.nz;
      const u1z = ring.nx;
      const points = [];
      let visible = true;
      for (let s = 0; s <= 20; s += 1) {
        const a = (s / 20) * Math.PI * 2;
        const px = ring.x + u1x * Math.cos(a) * ring.radius;
        const py = ring.y + Math.sin(a) * ring.radius;
        const pz = ring.z + u1z * Math.cos(a) * ring.radius;
        const p = project(px, py, pz);
        if (!p) { visible = false; break; }
        points.push(p);
      }
      if (!visible) continue;
      const colour = done ? PALETTE.ringDone : PALETTE.ring;
      const pulse = isNext ? 1 + Math.sin(time * 5) * 0.12 : 1;
      const alpha = done ? 0.5 : isNext ? 1 : 0.4;
      context.globalAlpha = alpha * 0.4;
      context.strokeStyle = PALETTE.ringGlow;
      context.lineWidth = 9 * pulse;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let s = 1; s < points.length; s += 1) context.lineTo(points[s].x, points[s].y);
      context.closePath();
      context.stroke();
      context.globalAlpha = alpha;
      context.strokeStyle = colour;
      context.lineWidth = 3 * pulse;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let s = 1; s < points.length; s += 1) context.lineTo(points[s].x, points[s].y);
      context.closePath();
      context.stroke();
      context.globalAlpha = 1;
      if (isNext) {
        const centre = project(ring.x, ring.y, ring.z);
        if (centre) {
          text('RING ' + (i + 1), centre.x, centre.y - ring.radius * centre.s - 12, 17, PALETTE.ring, 'center', true);
        }
      }
    }
  }

  // ---- the plane ---------------------------------------------------------
  function drawPlaneShadow(plane) {
    const ground = terrain.height(plane.x, plane.z);
    const alt = plane.y - ground;
    if (alt > 220) return;
    const p = project(plane.x, ground + 0.3, plane.z);
    if (!p) return;
    const size = Math.max(4, 26 * p.s * (1 - alt / 260));
    context.fillStyle = `rgba(20,30,20,${0.32 * (1 - alt / 260)})`;
    context.beginPath();
    context.ellipse(p.x, p.y, size, size * 0.32, 0, 0, Math.PI * 2);
    context.fill();
  }

  function drawPlane(plane, time) {
    const p = project(plane.x, plane.y, plane.z);
    if (!p) return;
    // The plane sits 19 m ahead of the chase camera: its screen size comes
    // straight from the projection.
    const s = p.s;
    const wingspan = 11.4 * s;
    if (wingspan < 8) return;
    context.save();
    // The camera already rolls with the bank (cam.roll), so the sprite
    // turns only by the bank left over: plane.roll - cam.roll.
    context.translate(p.x, p.y);
    context.rotate(plane.roll - cam.roll);
    const u = s; // one metre on the plane, in pixels
    // Main wings (behind the fuselage from this angle, so drawn first).
    context.fillStyle = PALETTE.planeCream;
    context.beginPath();
    context.moveTo(-wingspan / 2, -1.2 * u);
    context.lineTo(-2.2 * u, -2.6 * u);
    context.lineTo(2.2 * u, -2.6 * u);
    context.lineTo(wingspan / 2, -1.2 * u);
    context.lineTo(wingspan / 2, 1.4 * u);
    context.lineTo(2.2 * u, 2.2 * u);
    context.lineTo(-2.2 * u, 2.2 * u);
    context.lineTo(-wingspan / 2, 1.4 * u);
    context.closePath();
    context.fill();
    // Orange tips and the cream cheatline on the wings.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(-wingspan / 2, -1.2 * u);
    context.lineTo(-wingspan / 2 + 1.6 * u, -1.9 * u);
    context.lineTo(-wingspan / 2 + 1.6 * u, 1.5 * u);
    context.lineTo(-wingspan / 2, 1.4 * u);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(wingspan / 2, -1.2 * u);
    context.lineTo(wingspan / 2 - 1.6 * u, -1.9 * u);
    context.lineTo(wingspan / 2 - 1.6 * u, 1.5 * u);
    context.lineTo(wingspan / 2, 1.4 * u);
    context.closePath();
    context.fill();
    // Tailplane and fin.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(-3.4 * u, 3.4 * u);
    context.lineTo(-0.9 * u, 2.6 * u);
    context.lineTo(0.9 * u, 2.6 * u);
    context.lineTo(3.4 * u, 3.4 * u);
    context.lineTo(3.4 * u, 4.4 * u);
    context.lineTo(-3.4 * u, 4.4 * u);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(-0.5 * u, 2.8 * u);
    context.lineTo(0, 0.4 * u);
    context.lineTo(0.5 * u, 2.8 * u);
    context.closePath();
    context.fill();
    // Fuselage: nose away from us, tail towards us.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(-1.15 * u, -5.4 * u);
    context.quadraticCurveTo(-1.5 * u, -1 * u, -1.1 * u, 4.6 * u);
    context.lineTo(1.1 * u, 4.6 * u);
    context.quadraticCurveTo(1.5 * u, -1 * u, 1.15 * u, -5.4 * u);
    context.quadraticCurveTo(0, -6.4 * u, -1.15 * u, -5.4 * u);
    context.fill();
    // Cream cheatline down the fuselage and the Dustline name.
    context.fillStyle = PALETTE.planeCream;
    context.fillRect(-1.15 * u, -0.4 * u, 2.3 * u, 0.7 * u);
    context.fillStyle = PALETTE.planeDark;
    context.font = `bold ${Math.max(6, 0.9 * u)}px ${FONT}`;
    context.textAlign = 'center';
    context.fillText('DUSTLINE', 0, 3.4 * u);
    // Canopy, lit from the sun.
    context.fillStyle = PALETTE.canopy;
    context.beginPath();
    context.ellipse(0, -2.6 * u, 0.95 * u, 1.5 * u, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.55)';
    context.beginPath();
    context.ellipse(-0.3 * u, -3.1 * u, 0.35 * u, 0.6 * u, 0.3, 0, Math.PI * 2);
    context.fill();
    // Propeller blur at the nose.
    context.fillStyle = 'rgba(40,50,60,0.28)';
    context.beginPath();
    context.ellipse(0, -5.9 * u, 1.9 * u, 0.5 * u, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = PALETTE.planeDark;
    context.beginPath();
    context.arc(0, -5.9 * u, 0.45 * u, 0, Math.PI * 2);
    context.fill();
    // Navigation lights: red port, green starboard, blinking with time.
    const blink = Math.floor(time * 1.4) % 2 === 0;
    if (blink) {
      context.fillStyle = '#ff4d3d';
      context.beginPath();
      context.arc(-wingspan / 2, 0.1 * u, 0.5 * u, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#37e07a';
      context.beginPath();
      context.arc(wingspan / 2, 0.1 * u, 0.5 * u, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  // ---- HUD ----------------------------------------------------------------
  function headingDegrees(heading) {
    return ((heading * 180) / Math.PI % 360 + 360) % 360;
  }

  function drawCompass(plane) {
    const hd = headingDegrees(plane.heading);
    const cx = VIEW.width / 2;
    const y = 30;
    context.fillStyle = 'rgba(10,18,26,0.8)';
    context.fillRect(cx - 190, 8, 380, 58);
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.strokeRect(cx - 190, 8, 380, 58);
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    // Step over absolute degrees so the cardinals always land on a tick,
    // whatever the heading: stepping from the heading itself only lines
    // them up when the heading happens to be a multiple of 15.
    const start = Math.floor((hd - 60) / 15) * 15;
    for (let deg = start; deg <= hd + 60; deg += 15) {
      const wrapped = ((deg % 360) + 360) % 360;
      let d = wrapped - hd;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) > 60) continue;
      const x = cx + (d / 60) * 180;
      const isCardinal = wrapped % 45 === 0;
      context.strokeStyle = isCardinal ? PALETTE.hudText : 'rgba(255,255,255,0.45)';
      context.lineWidth = isCardinal ? 2 : 1;
      context.beginPath();
      context.moveTo(x, y + 12);
      context.lineTo(x, y + (isCardinal ? 2 : 7));
      context.stroke();
      if (isCardinal) text(labels[Math.round(wrapped / 45) % 8], x, y + 26, 13, PALETTE.hudText, 'center');
      else if (wrapped % 30 === 0) text(String(wrapped).padStart(3, '0'), x, y + 26, 11, PALETTE.hudDim, 'center');
    }
    // Centre marker and the reading.
    context.fillStyle = PALETTE.hudAmber;
    context.beginPath();
    context.moveTo(cx - 7, 8);
    context.lineTo(cx + 7, 8);
    context.lineTo(cx, 20);
    context.closePath();
    context.fill();
    text(String(Math.round(hd)).padStart(3, '0') + '°', cx, 84, 16, PALETTE.hudAmber, 'center', true);
  }

  function drawHud(plane, mission, time) {
    const altFt = Math.round(plane.y * 3.28084);
    const spdKt = Math.round(plane.speed * 1.94384);
    const vsi = Math.round(plane.verticalSpeed * 196.85); // ft/min
    // Left instrument block: altitude, speed, vertical speed.
    context.fillStyle = 'rgba(10,18,26,0.8)';
    context.fillRect(16, 16, 208, 108);
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.strokeRect(16, 16, 208, 108);
    text('ALT', 28, 40, 13, PALETTE.hudDim, 'left', true);
    text(altFt.toLocaleString('en-US') + ' FT', 28, 66, 26, PALETTE.hudText, 'left', true);
    text('SPD', 28, 90, 13, PALETTE.hudDim, 'left', true);
    text(spdKt + ' KT', 28, 114, 26, PALETTE.hudText, 'left', true);
    text((vsi >= 0 ? '+' : '') + vsi + ' FPM', 150, 114, 14, vsi >= 0 ? PALETTE.hudGreen : PALETTE.hudAmber, 'left', true);

    drawCompass(plane);

    // Right block: fuel, damage, score, rings.
    context.fillStyle = 'rgba(10,18,26,0.8)';
    context.fillRect(VIEW.width - 224, 16, 208, 108);
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.strokeRect(VIEW.width - 224, 16, 208, 108);
    const fuelColour = plane.fuel < 25 ? PALETTE.hudRed : plane.fuel < 50 ? PALETTE.hudAmber : PALETTE.hudGreen;
    const fuelPct = Math.round((plane.fuel / PLANE.tank) * 100);
    text('FUEL', VIEW.width - 212, 40, 13, PALETTE.hudDim, 'left', true);
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.fillRect(VIEW.width - 212, 46, 130, 12);
    context.fillStyle = fuelColour;
    context.fillRect(VIEW.width - 212, 46, 130 * (plane.fuel / PLANE.tank), 12);
    text(fuelPct + '%', VIEW.width - 74, 58, 14, fuelColour, 'left', true);
    text('HULL', VIEW.width - 212, 80, 13, PALETTE.hudDim, 'left', true);
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.fillRect(VIEW.width - 212, 86, 130, 12);
    context.fillStyle = plane.damage > 60 ? PALETTE.hudRed : PALETTE.hudGreen;
    context.fillRect(VIEW.width - 212, 86, 130 * (1 - plane.damage / 100), 12);
    text('SCORE ' + mission.score, VIEW.width - 212, 118, 16, PALETTE.hudText, 'left', true);
    text('RINGS ' + mission.ringsHit + '/' + mission.rings.length, VIEW.width - 108, 118, 15, PALETTE.hudAmber, 'left', true);

    // Throttle bar, bottom centre.
    const tw = 220;
    const tx = (VIEW.width - tw) / 2;
    const ty = VIEW.height - 34;
    context.fillStyle = 'rgba(10,18,26,0.8)';
    context.fillRect(tx - 8, ty - 8, tw + 16, 28);
    text('THR', tx - 52, ty + 12, 13, PALETTE.hudDim, 'left', true);
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.fillRect(tx, ty, tw, 12);
    context.fillStyle = plane.engineOut ? PALETTE.hudRed : PALETTE.hudAmber;
    context.fillRect(tx, ty, tw * plane.throttle, 12);
    text(Math.round(plane.throttle * 100) + '%', tx + tw + 10, ty + 12, 13, PALETTE.hudText, 'left', true);

    // Objectives, bottom left.
    const ring = currentRing(mission);
    context.fillStyle = 'rgba(10,18,26,0.8)';
    context.fillRect(16, VIEW.height - 96, 300, 80);
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.strokeRect(16, VIEW.height - 96, 300, 80);
    text('SORTIE ' + mission.sortie + ' — ' + (ring ? 'FLY THE RINGS' : 'LAND ON THE STRIP'), 28, VIEW.height - 70, 14, PALETTE.hudAmber, 'left', true);
    text((mission.ringsHit >= mission.rings.length ? '✓' : '○') + '  Rings ' + mission.ringsHit + ' / ' + mission.rings.length, 28, VIEW.height - 46, 15, PALETTE.hudText, 'left', true);
    const landed = mission.status === 'landed' || mission.status === 'complete';
    text((landed ? '✓' : '○') + '  Land on the Dustline strip', 28, VIEW.height - 24, 15, PALETTE.hudText, 'left', true);

    // Ring guidance: an arrow at the screen edge pointing at the next ring.
    const guide = ringGuidance(mission, plane);
    if (guide && mission.status === 'fly') {
      const ahead = Math.abs(guide.relative) < 0.5;
      if (!ahead) {
        const arrowX = VIEW.width / 2 + Math.sin(guide.relative) * 300;
        const arrowY = 150;
        context.save();
        context.translate(clamp(arrowX, 60, VIEW.width - 60), arrowY);
        context.rotate(guide.relative > 0 ? Math.PI / 2 : -Math.PI / 2);
        context.fillStyle = PALETTE.ring;
        context.beginPath();
        context.moveTo(0, -14); context.lineTo(12, 10); context.lineTo(-12, 10);
        context.closePath(); context.fill();
        context.restore();
        text('RING ' + (mission.ringIndex + 1) + '  ' + Math.round(guide.distance) + ' m', clamp(arrowX, 60, VIEW.width - 60), arrowY + 34, 15, PALETTE.ring, 'center', true);
      } else {
        text('RING ' + (mission.ringIndex + 1) + ' — ' + Math.round(guide.distance) + ' m', VIEW.width / 2, 96, 16, PALETTE.ring, 'center', true);
      }
    }

    // Stall and fuel warnings, flashing.
    if (!plane.onGround && plane.speed < 20 && Math.floor(time * 2) % 2 === 0) {
      text('STALL — NOSE DOWN, THROTTLE UP', VIEW.width / 2, 130, 20, PALETTE.hudRed, 'center', true);
    }
    if (plane.engineOut) {
      text('ENGINE OUT — GLIDE', VIEW.width / 2, 156, 20, PALETTE.hudRed, 'center', true);
    }

    // The mission message, centre screen.
    if (mission.messageTimer > 0) {
      const colour = mission.messageKind === 'good' ? PALETTE.hudGreen
        : mission.messageKind === 'warn' ? PALETTE.hudAmber
        : mission.messageKind === 'bad' ? PALETTE.hudRed : PALETTE.hudText;
      context.fillStyle = 'rgba(10,18,26,0.6)';
      context.font = `17px ${FONT}`;
      const w = context.measureText(mission.message).width + 32;
      context.fillRect((VIEW.width - w) / 2, VIEW.height - 130, w, 34);
      text(mission.message, VIEW.width / 2, VIEW.height - 106, 17, colour, 'center');
    }
  }

  // ---- cockpit instruments ----------------------------------------------
  function drawDial(cx, cy, r, label, valueText) {
    context.fillStyle = PALETTE.gaugeFace;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cx, cy, r, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = PALETTE.gaugeTick;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      context.beginPath();
      context.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      context.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
      context.stroke();
    }
    text(label, cx, cy + r + 16, 12, PALETTE.hudDim, 'center', true);
    text(valueText, cx, cy + 5, 16, PALETTE.hudText, 'center', true);
  }

  function drawCockpitPanel(plane, mission, time) {
    // The panel: a dark dash across the bottom third, lit instruments on it.
    const panelTop = VIEW.height - 210;
    context.fillStyle = PALETTE.panel;
    context.fillRect(0, panelTop, VIEW.width, 210);
    context.fillStyle = PALETTE.panelEdge;
    context.fillRect(0, panelTop, VIEW.width, 3);
    // A hint of the nose and the spinning prop at the top of the panel.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(VIEW.width / 2 - 60, panelTop);
    context.lineTo(VIEW.width / 2 + 60, panelTop);
    context.lineTo(VIEW.width / 2 + 26, panelTop - 26);
    context.lineTo(VIEW.width / 2 - 26, panelTop - 26);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(40,50,60,0.25)';
    context.beginPath();
    context.ellipse(VIEW.width / 2, panelTop - 30, 90, 10, 0, 0, Math.PI * 2);
    context.fill();

    // Artificial horizon: sky and ground split by the roll, pitched by the climb.
    const ax = VIEW.width / 2 - 300;
    const ay = panelTop + 105;
    const ar = 62;
    context.save();
    context.beginPath();
    context.arc(ax, ay, ar, 0, Math.PI * 2);
    context.clip();
    context.translate(ax, ay);
    context.rotate(-plane.roll);
    const pitchPx = plane.pitch * ar * 1.6;
    context.fillStyle = '#3f7fc1';
    context.fillRect(-ar, -ar - pitchPx, ar * 2, ar + pitchPx);
    context.fillStyle = '#6b4f2a';
    context.fillRect(-ar, -pitchPx, ar * 2, ar + pitchPx);
    context.strokeStyle = PALETTE.hudText;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-ar, -pitchPx);
    context.lineTo(ar, -pitchPx);
    context.stroke();
    context.restore();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(ax, ay, ar, 0, Math.PI * 2);
    context.stroke();
    // Fixed aircraft symbol over the horizon.
    context.strokeStyle = PALETTE.hudAmber;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(ax - 26, ay); context.lineTo(ax - 8, ay);
    context.moveTo(ax + 8, ay); context.lineTo(ax + 26, ay);
    context.moveTo(ax, ay - 3); context.lineTo(ax, ay + 3);
    context.stroke();
    text('ATTITUDE', ax, ay + ar + 18, 12, PALETTE.hudDim, 'center', true);

    // Airspeed, altitude, heading dials.
    drawDial(VIEW.width / 2 - 120, panelTop + 105, 52, 'AIRSPEED KT', String(Math.round(plane.speed * 1.94384)));
    drawDial(VIEW.width / 2 + 60, panelTop + 105, 52, 'ALTITUDE FT', String(Math.round(plane.y * 3.28084)));
    const hd = headingDegrees(plane.heading);
    drawDial(VIEW.width / 2 + 220, panelTop + 105, 52, 'HEADING', String(Math.round(hd)).padStart(3, '0') + '°');

    // Fuel and throttle, right side.
    const fx = VIEW.width - 130;
    text('FUEL', fx, panelTop + 30, 13, PALETTE.hudDim, 'left', true);
    context.fillStyle = 'rgba(255,255,255,0.15)';
    context.fillRect(fx, panelTop + 40, 90, 14);
    context.fillStyle = plane.fuel < 25 ? PALETTE.hudRed : PALETTE.hudGreen;
    context.fillRect(fx, panelTop + 40, 90 * (plane.fuel / PLANE.tank), 14);
    text('THROTTLE', fx, panelTop + 78, 13, PALETTE.hudDim, 'left', true);
    context.fillStyle = 'rgba(255,255,255,0.15)';
    context.fillRect(fx, panelTop + 88, 90, 14);
    context.fillStyle = PALETTE.hudAmber;
    context.fillRect(fx, panelTop + 88, 90 * plane.throttle, 14);
    text('SCORE ' + mission.score, fx, panelTop + 130, 15, PALETTE.hudText, 'left', true);
    text('RINGS ' + mission.ringsHit + '/' + mission.rings.length, fx, panelTop + 154, 15, PALETTE.hudAmber, 'left', true);

    // Warning lamps, lit when they matter.
    const lamp = (x, label, on, colour) => {
      context.fillStyle = on ? colour : 'rgba(255,255,255,0.12)';
      context.beginPath();
      context.arc(x, panelTop + 178, 8, 0, Math.PI * 2);
      context.fill();
      text(label, x + 14, panelTop + 183, 12, on ? colour : PALETTE.hudDim, 'left', true);
    };
    lamp(60, 'LOW FUEL', plane.fuel < 25, PALETTE.hudAmber);
    lamp(200, 'HULL DAMAGE', plane.damage > 40, PALETTE.hudRed);
    lamp(380, 'STALL', !plane.onGround && plane.speed < 20, PALETTE.hudRed);
  }

  // ---- screens ------------------------------------------------------------
  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const height = 150 + lines.length * 34;
    const x = (VIEW.width - width) / 2;
    const y = (VIEW.height - height) / 2;
    context.fillStyle = 'rgba(10,18,26,0.82)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = accent || PALETTE.hudAmber;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    context.textBaseline = 'alphabetic';
    text(title, VIEW.width / 2, y + 72, 44, PALETTE.hudText, 'center');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], VIEW.width / 2, y + 122 + i * 34, 19, PALETTE.hudDim, 'center');
    }
    text(prompt, VIEW.width / 2, y + height - 30, 20, accent || PALETTE.hudAmber, 'center');
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen. */
  function draw(viewState) {
    const { plane, mission, screen, best, time } = viewState;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    updateCamera(plane, viewState.dt);
    drawSky(plane);
    drawTerrain(plane);
    drawRunway();
    drawLandmarks(time);
    drawRings(mission, time);
    if (cameraMode === CAMERA_CHASE) {
      drawPlaneShadow(plane);
      drawPlane(plane, time);
    }
    if (screen === SCREEN_TITLE) {
      drawPanel('DUSTLINE RIDGE', [
        'A bush-plane sortie over the valley: fly the 8 rings,',
        'mind your fuel, then bring her home to the strip.',
        'Steer with ← → ↑ ↓ or A S D W, throttle with Shift / Ctrl,',
        'or steer with the mouse and the wheel. C switches camera.',
        best > 0 ? 'Best score so far: ' + best : 'No sorties flown yet — the ridge is waiting.',
      ], 'Press Space or click to fly');
      return;
    }
    if (cameraMode === CAMERA_COCKPIT) {
      drawHud(plane, mission, time);
      drawCockpitPanel(plane, mission, time);
    } else {
      drawHud(plane, mission, time);
    }
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The ridge will wait. Your fuel will not — well, it will.'], 'Press P to resume');
    } else if (screen === SCREEN_OVER) {
      drawPanel('Crashed', [
        'Score ' + mission.score + '   •   Rings ' + mission.ringsHit + ' / ' + mission.rings.length,
        'Best ' + best,
      ], 'Press Space or click to fly again', PALETTE.hudRed);
    } else if (screen === SCREEN_COMPLETE) {
      drawPanel('Sortie complete!', [
        'Score ' + mission.score + '   •   Rings ' + mission.ringsHit + ' / ' + mission.rings.length,
        'Sortie ' + (mission.sortie + 1) + ' flies lower and tighter. Best ' + best,
      ], 'Press Space for the next sortie', PALETTE.hudGreen);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return {
    draw,
    setCamera(mode) { cameraMode = mode; },
    getCamera() { return cameraMode; },
    /** Point the camera at the plane at once, with no smoothing lag: the
     * screenshot scenes stage the plane first, then snap, then paint. */
    snapCamera(plane) {
      cam.heading = plane.heading;
      cam.pitch = plane.pitch * 0.55;
      cam.roll = plane.roll * 0.35;
    },
    project,
  };
}
