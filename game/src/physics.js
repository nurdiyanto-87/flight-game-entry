// The flight model: one bush plane, no aerodynamics textbook, just the
// decisions a pilot feels — throttle sets the speed, the bank turns the nose,
// the elevator trades speed for climb, the wing quits below stall speed, and
// the ground is always waiting. Pure state in, pure state out: no drawing,
// no browser, so the screenshot autopilot can fly the same rules.

import { PLANE, RUNWAY } from './config.js';

export const EVENT_NONE = 0;
export const EVENT_BOUNCE = 1;
export const EVENT_LANDED_SMOOTH = 2;
export const EVENT_LANDED_FIRM = 4;
export const EVENT_CRASHED = 8;
export const EVENT_FUEL_EMPTY = 16;

/** Forward unit vector for a heading (0 = north, towards -z) and pitch. */
export function forwardVector(heading, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(heading) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(heading) * cp,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A fresh plane, parked on the strip from `startPose()`. */
export function createPlane(pose) {
  return {
    x: pose.x, y: pose.y, z: pose.z,
    heading: pose.heading, pitch: pose.pitch, roll: pose.roll,
    speed: pose.speed,
    throttle: 0,
    fuel: PLANE.tank,
    damage: 0,
    onGround: true,
    verticalSpeed: 0,
    engineOut: false,
  };
}

/**
 * One fixed step. `ctl` is { pitch: -1..1 (up positive), roll: -1..1 (right
 * positive), throttle: -1..1 (change per second), brake: boolean }.
 * Returns an EVENT_* bitmask; `terrain.height(x, z)` answers the ground.
 */
export function stepPlane(plane, dt, ctl, terrain) {
  let events = EVENT_NONE;

  // Throttle: the lever moves at 0.8 per second, the engine answers at once.
  plane.throttle = clamp(plane.throttle + ctl.throttle * 0.8 * dt, 0, 1);
  if (plane.fuel <= 0) {
    if (!plane.engineOut) {
      plane.engineOut = true;
      events |= EVENT_FUEL_EMPTY;
    }
    plane.throttle = 0;
  }

  // Speed chases the throttle's target; a high nose costs speed, a low nose
  // and gravity give it back. Below stall speed the wing gives up lift.
  const targetSpeed = plane.throttle * PLANE.maxSpeed;
  const climbCost = Math.max(0, Math.sin(plane.pitch)) * 6;
  const diveGain = Math.max(0, -Math.sin(plane.pitch)) * 14;
  const accel = PLANE.accel * (targetSpeed - plane.speed) / PLANE.maxSpeed + diveGain - climbCost;
  plane.speed = Math.max(0, plane.speed + accel * dt);

  // Roll and pitch answer the stick; the wings level themselves when let go.
  plane.roll = clamp(plane.roll + ctl.roll * PLANE.rollRate * dt, -PLANE.maxRoll, PLANE.maxRoll);
  if (ctl.roll === 0) {
    const level = PLANE.autoLevel * dt;
    plane.roll = Math.abs(plane.roll) <= level ? 0 : plane.roll - Math.sign(plane.roll) * level;
  }
  plane.pitch = clamp(plane.pitch + ctl.pitch * PLANE.pitchRate * dt, -PLANE.maxPitch, PLANE.maxPitch);
  if (ctl.pitch === 0 && !plane.onGround) {
    const trim = 0.25 * dt;
    plane.pitch = Math.abs(plane.pitch) <= trim ? 0 : plane.pitch - Math.sign(plane.pitch) * trim;
  }

  // The bank turns the heading; the turn bites harder the faster you fly.
  const turnAuthority = clamp(plane.speed / PLANE.cruiseSpeed, 0.25, 1.4);
  plane.heading += Math.sin(plane.roll) * PLANE.turnRate * turnAuthority * dt;
  plane.heading = (plane.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI;

  // Climb and sink: the wing lifts while it flies; below stall it sinks.
  const fwd = forwardVector(plane.heading, plane.pitch);
  let vy = plane.speed * fwd.y;
  if (plane.speed < PLANE.stallSpeed && !plane.onGround) {
    vy -= (PLANE.stallSpeed - plane.speed) * 0.9;
  }
  plane.verticalSpeed = vy;
  const ground = terrain.height(plane.x, plane.z);

  if (plane.onGround) {
    // Rolling on the strip (or the grass): the wheels carry the plane, the
    // nose stays level, and the brakes bite.
    plane.y = ground + 0.4;
    plane.pitch = 0;
    plane.roll = 0;
    if (ctl.brake) plane.speed = Math.max(0, plane.speed - 22 * dt);
    plane.speed = Math.min(plane.speed, PLANE.maxSpeed);
    // Rolling on the wheels still carries the plane down the strip.
    plane.x += Math.sin(plane.heading) * plane.speed * dt;
    plane.z += -Math.cos(plane.heading) * plane.speed * dt;
    if (plane.speed > 24 && plane.pitch === 0 && ctl.pitch > 0.2) {
      // Rotate: enough speed and a pull on the stick lifts off.
      plane.onGround = false;
      plane.y += 0.2;
    }
  } else {
    plane.x += fwd.x * plane.speed * dt;
    plane.z += fwd.z * plane.speed * dt;
    plane.y += vy * dt;
  }

  // Fuel burns with the throttle; a dead engine still glides.
  if (!plane.engineOut) {
    plane.fuel = Math.max(0, plane.fuel - (PLANE.fuelIdle + (PLANE.fuelBurn - PLANE.fuelIdle) * plane.throttle) * dt);
  }

  // The ground: a gentle arrival on the strip is a landing, a hard one is
  // damage, and a fast hit anywhere is a crash.
  if (!plane.onGround) {
    const clearance = plane.y - ground;
    if (clearance <= 0.4) {
      const onStrip = Math.abs(plane.x) <= RUNWAY.halfWidth + 4
        && Math.abs(plane.z) <= RUNWAY.halfLength + 10;
      const sink = -vy;
      // A landing counts when the plane arrives along the strip, either
      // direction, slow, level and gentle.
      const headingNorth = Math.abs(plane.heading) < 0.35 || Math.abs(plane.heading) > Math.PI - 0.35;
      const landingOk = onStrip && sink < 5.5 && plane.speed < 52 && headingNorth && Math.abs(plane.roll) < 0.35;
      if (landingOk) {
        plane.onGround = true;
        plane.y = ground + 0.4;
        plane.pitch = 0;
        plane.roll = 0;
        events |= sink < 2.8 ? EVENT_LANDED_SMOOTH : EVENT_LANDED_FIRM;
      } else if (sink < 4 && plane.speed < 40) {
        // A survivable bump: bounce off, pay in damage, keep flying.
        plane.y = ground + 0.6;
        plane.pitch = Math.abs(plane.pitch) * 0.4;
        plane.speed *= 0.82;
        plane.damage = Math.min(100, plane.damage + 22);
        events |= EVENT_BOUNCE;
      } else {
        plane.damage = 100;
        events |= EVENT_CRASHED;
      }
    }
  }

  if (plane.damage >= 100) events |= EVENT_CRASHED;
  return events;
}

/** Refuel and patch up after a landing: the strip's crew earns its keep. */
export function servicePlane(plane) {
  plane.fuel = PLANE.tank;
  plane.damage = Math.max(0, plane.damage - 40);
  plane.engineOut = false;
}
