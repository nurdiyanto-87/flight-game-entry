// The sortie: rings in order, then a landing, then the next sortie. One
// sortie is a loop out over the valley and home to the Dustline strip; the
// score is rings plus landing quality, and the fuel gauge is the clock —
// run dry and the engine quits, so every sortie is a decision about how
// much throttle the rings are worth.

import { RUNWAY, SCORE } from './config.js';
import { buildCourse } from './terrain.js';
import { EVENT_BOUNCE, EVENT_CRASHED, EVENT_FUEL_EMPTY, EVENT_LANDED_FIRM, EVENT_LANDED_SMOOTH, servicePlane } from './physics.js';

export const MISSION_FLY = 'fly';
export const MISSION_LANDED = 'landed';
export const MISSION_CRASHED = 'crashed';
export const MISSION_COMPLETE = 'complete';

export function createMission(terrain) {
  const mission = {
    sortie: 1,
    rings: buildCourse(terrain, 1),
    ringIndex: 0,
    score: 0,
    status: MISSION_FLY,
    message: '',
    messageTimer: 0,
    messageKind: 'info',
    elapsed: 0,
    ringsHit: 0,
    landings: 0,
    // Where the plane was last frame, for the ring-plane crossing test.
    prevX: 0, prevY: 0, prevZ: 0,
    terrain,
  };
  return mission;
}

function say(mission, text, kind, seconds) {
  mission.message = text;
  mission.messageKind = kind || 'info';
  mission.messageTimer = seconds || 3;
}

export function resetMission(mission, plane) {
  mission.rings = buildCourse(mission.terrain, mission.sortie);
  mission.ringIndex = 0;
  mission.status = MISSION_FLY;
  mission.elapsed = 0;
  mission.ringsHit = 0;
  mission.landings = 0;
  mission.prevX = plane.x;
  mission.prevY = plane.y;
  mission.prevZ = plane.z;
  say(mission, `Sortie ${mission.sortie} — fly the ${mission.rings.length} rings, then land on the strip.`, 'info', 4);
}

/** The ring the pilot is chasing now, or null once all are flown. */
export function currentRing(mission) {
  return mission.ringIndex < mission.rings.length ? mission.rings[mission.ringIndex] : null;
}

/** Distance and bearing to the current ring, for the HUD arrow. */
export function ringGuidance(mission, plane) {
  const ring = currentRing(mission);
  if (!ring) return null;
  const dx = ring.x - plane.x;
  const dy = ring.y - plane.y;
  const dz = ring.z - plane.z;
  const distance = Math.hypot(dx, dy, dz);
  const bearing = Math.atan2(dx, -dz); // 0 = north, matching heading
  let relative = bearing - plane.heading;
  while (relative > Math.PI) relative -= Math.PI * 2;
  while (relative < -Math.PI) relative += Math.PI * 2;
  return { distance, relative, dy };
}

/**
 * Advance the mission one step: ring crossings, landing and crash events,
 * fuel warnings, and the sortie-complete state. `events` is the bitmask from
 * stepPlane. Returns nothing; the mission and the plane are updated in place.
 */
export function stepMission(mission, plane, events, dt) {
  mission.elapsed += dt;
  if (mission.messageTimer > 0) mission.messageTimer -= dt;

  // Ring crossing: the plane's segment this step crossed the ring's plane,
  // and passed close enough to its centre.
  const ring = currentRing(mission);
  if (ring && mission.status === MISSION_FLY) {
    const dPrev = (mission.prevX - ring.x) * ring.nx + (mission.prevY - ring.y) * ring.ny + (mission.prevZ - ring.z) * ring.nz;
    const dNow = (plane.x - ring.x) * ring.nx + (plane.y - ring.y) * ring.ny + (plane.z - ring.z) * ring.nz;
    if (dPrev < 0 && dNow >= 0) {
      const offCentre = Math.hypot(
        plane.x - ring.x - dNow * ring.nx,
        plane.y - ring.y - dNow * ring.ny,
        plane.z - ring.z - dNow * ring.nz,
      );
      if (offCentre <= ring.radius) {
        ring.passed = true;
        mission.ringIndex += 1;
        mission.ringsHit += 1;
        const fast = plane.speed > 38 ? SCORE.ringTimeBonus : 0;
        mission.score += SCORE.ring + fast;
        if (mission.ringIndex >= mission.rings.length) {
          say(mission, `All rings flown! Bring her home — land on the Dustline strip.`, 'good', 4);
        } else {
          say(mission, `Ring ${mission.ringIndex} of ${mission.rings.length} — +${SCORE.ring + fast} pts`, 'good', 2.5);
        }
      } else {
        say(mission, `Missed the ring by ${Math.round(offCentre - ring.radius)} m — turn back for it.`, 'warn', 3);
      }
    }
  }

  if (events & EVENT_FUEL_EMPTY) {
    say(mission, 'Fuel empty — engine out! Glide her down, gently.', 'warn', 4);
  }
  if (events & EVENT_BOUNCE) {
    say(mission, `Rough ground contact — hull damage ${Math.round(plane.damage)}%.`, 'warn', 3);
  }
  if (events & EVENT_LANDED_SMOOTH || events & EVENT_LANDED_FIRM) {
    const smooth = Boolean(events & EVENT_LANDED_SMOOTH);
    const onStrip = Math.abs(plane.x) <= RUNWAY.halfWidth + 4
      && Math.abs(plane.z) <= RUNWAY.halfLength + 10;
    mission.landings += 1;
    if (onStrip && mission.ringIndex >= mission.rings.length && mission.status === MISSION_FLY) {
      // The sortie is done: rings flown, wheels on the strip.
      const bonus = smooth ? SCORE.smoothLanding : SCORE.firmLanding;
      mission.score += bonus + SCORE.sortieComplete;
      mission.status = MISSION_COMPLETE;
      servicePlane(plane);
      say(mission, smooth
        ? `Butter-smooth touchdown! Sortie complete — +${bonus + SCORE.sortieComplete} pts.`
        : `Down safe, if not pretty. Sortie complete — +${bonus + SCORE.sortieComplete} pts.`, 'good', 5);
    } else if (onStrip) {
      servicePlane(plane);
      mission.status = MISSION_LANDED;
      say(mission, smooth
        ? 'Smooth landing — tank full, hull patched. Space to take off again.'
        : 'Down on the strip — tank full, hull patched. Space to take off again.', 'good', 4);
    } else {
      say(mission, 'Off-strip landing — the crew will tow her back. Space to go again.', 'warn', 4);
      mission.status = MISSION_LANDED;
    }
  }
  if (events & EVENT_CRASHED) {
    mission.status = MISSION_CRASHED;
    say(mission, 'Crashed. The ridge wins this one.', 'bad', 6);
  }

  // A low-fuel nudge while there is still time to do something about it.
  if (mission.status === MISSION_FLY && plane.fuel < 25 && plane.fuel > 0 && !plane.engineOut) {
    if (mission.messageTimer <= 0) say(mission, `Fuel low — ${Math.round(plane.fuel)} left. The strip refuels you.`, 'warn', 2.5);
  }

  mission.prevX = plane.x;
  mission.prevY = plane.y;
  mission.prevZ = plane.z;
}

/** Start the next sortie after a completed one: a fresh, tighter course. */
export function nextSortie(mission, plane) {
  mission.sortie += 1;
  resetMission(mission, plane);
}
