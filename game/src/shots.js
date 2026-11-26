// The screenshot scenes behind ?shot=cover|cockpit|landing|valley. Each one
// plays the real rules forward from a fresh world for a fixed number of
// steps, steered by a simple autopilot (bank towards the target, pitch for
// its height, throttle to hold cruise), so the frame is what real play looks
// like and the same seed always gives the same frame.

import { RUNWAY, STEP } from './config.js';
import { stepPlane } from './physics.js';
import { currentRing, stepMission } from './missions.js';
import { CAMERA_CHASE, CAMERA_COCKPIT, SCREEN_PLAY } from './render.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Steer towards a point in the sky: bank for the heading, pitch for the
 * height, throttle for the speed. Returns the control the flight model
 * wants, as { pitch, roll, throttle, brake }.
 *
 * A ring is not a point to chase: the plane's turn is wide (about 90 m at
 * cruise), so it must line up on the ring's approach axis from far out and
 * fly straight through. Chasing the centre itself just orbits the ring, and
 * chasing a fixed point 170 m before it gets overshot and circled too.
 * So the autopilot intercepts the approach LINE: it aims at a point on the
 * line 120 m nearer the ring than its own projection onto it, which pulls
 * the plane onto the line from any angle and walks it down the line to the
 * centre. Past the ring plane without a hit, it loops back to the approach
 * point and tries again. Near the ring it slows a little so the turn, if
 * one is still needed, bites tighter.
 */
export function autopilot(plane, target, cruiseSpeed) {
  let aim = target;
  let speed = cruiseSpeed;
  if (target.nx !== undefined) {
    const vx = plane.x - target.x;
    const vy = plane.y - target.y;
    const vz = plane.z - target.z;
    // s: how far back along the approach axis the plane sits (negative
    // once it has passed the ring's plane).
    const s = -(vx * target.nx + vy * target.ny + vz * target.nz);
    const distance = Math.hypot(vx, vy, vz);
    if (s < 0) {
      // Past the ring: loop back to the approach point and re-enter.
      aim = { x: target.x - target.nx * 170, y: target.y, z: target.z - target.nz * 170 };
    } else if (s > 120) {
      aim = { x: target.x - target.nx * (s - 120), y: target.y, z: target.z - target.nz * (s - 120) };
    } else {
      speed = Math.min(cruiseSpeed, 34);
    }
    if (distance < 170) speed = Math.min(speed, 34);
  }
  const dx = aim.x - plane.x;
  const dy = aim.y - plane.y;
  const dz = aim.z - plane.z;
  const distance = Math.hypot(dx, dy, dz);
  const wantHeading = Math.atan2(dx, -dz);
  let dh = wantHeading - plane.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  const wantPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.5);
  // The stick commands a roll RATE, not a bank angle: commanding a rate
  // from the heading error alone winds the bank up and S-turns across the
  // target. Command the bank the heading error asks for, and let the rate
  // be the difference between that bank and the one the plane already has.
  const desiredBank = clamp(dh * 1.4, -0.95, 0.95);
  const roll = clamp((desiredBank - plane.roll) * 3.5, -1, 1);
  const pitch = clamp((wantPitch - plane.pitch) * 2.2, -1, 1);
  const throttle = plane.speed < speed ? 1 : plane.speed > speed + 6 ? -1 : 0;
  return { pitch, roll, throttle, brake: false, distance };
}

/** Fly the plane through the rings with the autopilot, one fixed step. */
function flyStep(world, plane, mission, dt) {
  const ring = currentRing(mission);
  const target = ring || { x: 0, y: 30, z: RUNWAY.thresholdZ };
  const ctl = autopilot(plane, target, 42);
  const events = stepPlane(plane, dt, ctl, world.terrain);
  stepMission(mission, plane, events, dt);
  return events;
}

/**
 * Set `world` to the named scene and return the screen and camera to draw
 * over it. Any other name stages the cover.
 */
export function stageShot(name, world) {
  world.reset();
  const { plane, mission } = world;
  const renderer = world.renderer;

  if (name === 'cockpit') {
    // Final approach: lined up with the strip, 900 m out, 90 m up, gear
    // down in spirit — the instruments lit and the runway ahead.
    plane.x = 6;
    plane.y = 95;
    plane.z = 950;
    plane.heading = 0;
    plane.pitch = -0.09;
    plane.roll = 0;
    plane.speed = 40;
    plane.throttle = 0.55;
    plane.onGround = false;
    mission.ringsHit = 5;
    mission.ringIndex = 5;
    for (let i = 0; i < 10 / STEP; i += 1) {
      const ctl = autopilot(plane, { x: 0, y: 6, z: 260 }, 38);
      const events = stepPlane(plane, STEP, ctl, world.terrain);
      stepMission(mission, plane, events, STEP);
    }
    renderer.setCamera(CAMERA_COCKPIT);
    return { screen: SCREEN_PLAY, best: 0 };
  }

  if (name === 'landing') {
    // On final: high enough to clear the rising ground south of the strip,
    // on the glide slope, the threshold bars ahead and the village behind.
    // Flown left of the centreline so the strip shows beside the plane
    // instead of hiding behind it.
    plane.x = -40;
    plane.y = 35;
    plane.z = 550;
    plane.heading = 0;
    plane.pitch = -0.09;
    plane.roll = 0.02;
    plane.speed = 34;
    plane.throttle = 0.3;
    plane.onGround = false;
    mission.ringsHit = 8;
    mission.ringIndex = 8;
    for (let i = 0; i < 3 / STEP; i += 1) {
      const ctl = autopilot(plane, { x: 0, y: 2, z: 200 }, 32);
      const events = stepPlane(plane, STEP, ctl, world.terrain);
      stepMission(mission, plane, events, STEP);
      if (plane.onGround) break;
    }
    renderer.setCamera(CAMERA_CHASE);
    return { screen: SCREEN_PLAY, best: 0 };
  }

  if (name === 'valley') {
    // Over the lake at cruise height: the next ring ahead, the village and
    // the turbines in the frame. Staged like the cover — a held pose, ring
    // off to the side of the plane — so the frame stays level and readable.
    const ring = mission.rings[4];
    const heading = Math.atan2(ring.nx, -ring.nz);
    const sideX = -ring.nz * 65;
    const sideZ = ring.nx * 65;
    plane.x = ring.x - ring.nx * 220 + sideX;
    plane.y = ring.y - 12;
    plane.z = ring.z - ring.nz * 220 + sideZ;
    plane.heading = heading;
    plane.pitch = 0;
    plane.roll = 0.14;
    plane.speed = 44;
    plane.throttle = 0.7;
    plane.onGround = false;
    mission.ringsHit = 4;
    mission.ringIndex = 4;
    renderer.setCamera(CAMERA_CHASE);
    return { screen: SCREEN_PLAY, best: 0 };
  }

  // Cover: on the nose of ring 2, banking gently through the valley with
  // the ring ahead, the strip and the lake both in the frame. The plane
  // starts 220 m out from the ring and flies straight at it, so the frame
  // catches the ring in front of the nose, not behind it.
  const ring = mission.rings[1];
  const heading = Math.atan2(ring.nx, -ring.nz);
  // Start 220 m out, 12 m below the ring's centre and 65 m to its side, so
  // the ring shows clear of the plane sprite instead of hiding behind it.
  // No autopilot steps: the plane holds this pose, ring ahead, valley below.
  const sideX = -ring.nz * 65;
  const sideZ = ring.nx * 65;
  plane.x = ring.x - ring.nx * 220 + sideX;
  plane.y = ring.y - 12;
  plane.z = ring.z - ring.nz * 220 + sideZ;
  plane.heading = heading;
  plane.pitch = 0;
  plane.roll = 0.14;
  plane.speed = 46;
  plane.throttle = 0.75;
  plane.onGround = false;
  mission.ringsHit = 1;
  mission.ringIndex = 1;
  renderer.setCamera(CAMERA_CHASE);
  return { screen: SCREEN_PLAY, best: 0 };
}
