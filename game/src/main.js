// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between five screens:
// title, play, paused, crashed and sortie complete.
//
// ?seed=N fixes the valley and the ring course. ?shot=cover|cockpit|
// landing|valley (with &seed=N) stages that scene instead of running the
// loop, paints it twice and sets window.__shotReady for a screenshot.

import { BEST_KEY, STEP } from './config.js';
import { createTerrain, startPose } from './terrain.js';
import { createPlane, stepPlane, EVENT_CRASHED, EVENT_LANDED_FIRM, EVENT_LANDED_SMOOTH } from './physics.js';
import { createMission, resetMission, nextSortie, stepMission, MISSION_COMPLETE, MISSION_CRASHED, MISSION_LANDED } from './missions.js';
import { ACTION_CAMERA, ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESET, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_COMPLETE, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, CAMERA_CHASE, CAMERA_COCKPIT } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const terrain = createTerrain(seed);
const renderer = createRenderer(canvas, terrain);
const audio = createAudio();

const world = {
  terrain,
  renderer,
  plane: null,
  mission: null,
  reset() {
    this.plane = createPlane(startPose());
    this.mission = createMission(terrain);
    resetMission(this.mission, this.plane);
  },
};
world.reset();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

// A handle for play-testing and for the screenshot driver: the live state,
// read-only in spirit, never written by the page's own code.
window.__DUSTLINE__ = {
  seed,
  get plane() { return world.plane; },
  get mission() { return world.mission; },
  get screen() { return currentScreen; },
};

let currentScreen = SCREEN_TITLE;

function runShot(name) {
  const scene = stageShot(name, world);
  currentScreen = scene.screen;
  // The camera smooths towards the plane over frames; a staged scene has
  // only two paints, so snap it onto the plane first or it still looks
  // wherever the last frame looked.
  renderer.snapCamera(world.plane);
  let painted = 0;
  function paint() {
    renderer.draw({ plane: world.plane, mission: world.mission, screen: currentScreen, best: 0, time: 12, dt: STEP });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let time = 0;
  let lastRings = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each event.
  function announce(message) {
    status.textContent = message;
  }

  function startSortie() {
    world.reset();
    lastRings = 0;
    accumulator = 0;
    screen = SCREEN_PLAY;
    currentScreen = screen;
    audio.unlock();
    announce(`Sortie ${world.mission.sortie}. Fly the rings, then land on the strip.`);
  }

  function endSortie(crashed) {
    screen = crashed ? SCREEN_OVER : SCREEN_COMPLETE;
    currentScreen = screen;
    if (world.mission.score > best) {
      best = world.mission.score;
      saveBest(best);
    }
    announce(crashed
      ? `Crashed. Score ${world.mission.score}. Best ${best}.`
      : `Sortie complete. Score ${world.mission.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_CAMERA) {
      const next = renderer.getCamera() === CAMERA_CHASE ? CAMERA_COCKPIT : CAMERA_CHASE;
      renderer.setCamera(next);
      announce(next === CAMERA_COCKPIT ? 'Cockpit view.' : 'Chase view.');
    }
    if (actions & ACTION_RESET && screen === SCREEN_PLAY) {
      startSortie();
      return;
    }
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER) startSortie();
      else if (screen === SCREEN_COMPLETE) {
        world.plane = createPlane(startPose());
        nextSortie(world.mission, world.plane);
        screen = SCREEN_PLAY;
        currentScreen = screen;
        announce(`Sortie ${world.mission.sortie}. Fly the rings, then land.`);
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        currentScreen = screen;
        announce('Playing.');
      }
    } else if (actions & ACTION_PAUSE) {
      if (screen === SCREEN_PLAY) {
        screen = SCREEN_PAUSED;
        currentScreen = screen;
        announce('Paused.');
      } else if (screen === SCREEN_PAUSED) {
        screen = SCREEN_PLAY;
        currentScreen = screen;
        announce('Playing.');
      }
    }
  }

  function step() {
    const plane = world.plane;
    const mission = world.mission;
    if (screen === SCREEN_TITLE) {
      // The title screen flies itself: take off, then a gentle orbit over
      // the strip so the valley is alive behind the panel. The crew keeps
      // her fuelled while she circles.
      plane.fuel = 100;
      plane.damage = 0;
      let ctl;
      if (plane.onGround) {
        ctl = { pitch: 1, roll: 0, throttle: 1, brake: false };
      } else {
        const pitch = plane.y > 130 ? -0.35 : plane.y < 80 ? 0.4 : 0;
        ctl = { pitch, roll: 0.35, throttle: 0.55, brake: false };
      }
      stepPlane(plane, STEP, ctl, terrain);
      return;
    }
    const steering = input.steering();
    const ctl = {
      pitch: steering.pitch,
      roll: steering.roll,
      throttle: input.throttle(),
      brake: input.brake(),
    };
    const events = stepPlane(plane, STEP, ctl, terrain);
    const wasLanded = mission.status === MISSION_LANDED;
    stepMission(mission, plane, events, STEP);
    if (wasLanded && !plane.onGround) {
      // Wheels up again: the sortie is live once more.
      mission.status = 'fly';
    }
    audio.engine(plane.throttle, !plane.onGround);
    if (mission.ringsHit > lastRings) {
      lastRings = mission.ringsHit;
      audio.ring();
    }
    if (events & EVENT_CRASHED) {
      audio.crash();
      endSortie(true);
    } else if (events & (EVENT_LANDED_SMOOTH | EVENT_LANDED_FIRM)) {
      audio.thud();
      if (mission.status === MISSION_COMPLETE) endSortie(false);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    time += dt;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      accumulator += dt;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw({ plane: world.plane, mission: world.mission, screen, best, time, dt });
  }

  // Leaving the tab pauses a running game rather than letting the fuel burn unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      currentScreen = screen;
      announce('Paused.');
    }
  });

  announce('Dustline Ridge. Press Space or click to fly.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
