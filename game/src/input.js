// Keyboard and pointer input. Held keys steer; one-shot presses (start,
// pause, camera, mute) are queued as bit flags and taken once by the loop,
// so a press between two frames is never lost and never counted twice.
// The mouse steers too: where the pointer sits against the centre of the
// screen banks and pitches the plane, and the wheel works the throttle.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_CAMERA = 4;
export const ACTION_MUTE = 8;
export const ACTION_RESET = 16;

const PITCH_UP = new Set(['ArrowDown', 'KeyS']);
const PITCH_DOWN = new Set(['ArrowUp', 'KeyW']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyA']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyD']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'KeyE']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'KeyQ']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const CAMERA = new Set(['KeyC']);
const MUTE = new Set(['KeyM']);
const RESET = new Set(['KeyR']);
const BRAKE = new Set(['KeyB']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;
  // Pointer position in -1..1 across the screen; 0,0 is the centre.
  const pointer = { x: 0, y: 0, active: false };
  let wheel = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      // A held key still steers; only one-shot presses are repeat-guarded.
      if (PITCH_UP.has(event.code) || PITCH_DOWN.has(event.code)
        || ROLL_LEFT.has(event.code) || ROLL_RIGHT.has(event.code)
        || THROTTLE_UP.has(event.code) || THROTTLE_DOWN.has(event.code)
        || BRAKE.has(event.code)) {
        held.add(event.code);
        event.preventDefault();
      }
      return;
    }
    if (PITCH_UP.has(event.code) || PITCH_DOWN.has(event.code)
      || ROLL_LEFT.has(event.code) || ROLL_RIGHT.has(event.code)
      || THROTTLE_UP.has(event.code) || THROTTLE_DOWN.has(event.code)
      || BRAKE.has(event.code)) {
      held.add(event.code);
    } else if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (CAMERA.has(event.code)) actions |= ACTION_CAMERA;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
    else if (RESET.has(event.code)) actions |= ACTION_RESET;
    else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of
  // everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    pointer.active = false;
  });
  target.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') {
      pointer.active = true;
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    } else {
      actions |= ACTION_CONFIRM;
    }
  });
  target.addEventListener('pointermove', (event) => {
    if (pointer.active && event.pointerType === 'mouse') {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    }
  });
  target.addEventListener('pointerup', () => {
    pointer.active = false;
    pointer.x = 0;
    pointer.y = 0;
  });
  target.addEventListener('wheel', (event) => {
    wheel += event.deltaY < 0 ? 1 : -1;
    event.preventDefault();
  }, { passive: false });

  function hasAny(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  return {
    /** Steering for this frame: pitch up positive, roll right positive. */
    steering() {
      let pitch = 0;
      let roll = 0;
      if (hasAny(PITCH_UP)) pitch += 1;
      if (hasAny(PITCH_DOWN)) pitch -= 1;
      if (hasAny(ROLL_LEFT)) roll -= 1;
      if (hasAny(ROLL_RIGHT)) roll += 1;
      if (pointer.active) {
        // The mouse steers gently: bank towards the pointer, pitch away
        // from it (push forward to dive, pull back to climb).
        roll += Math.max(-1, Math.min(1, pointer.x * 1.4));
        pitch += Math.max(-1, Math.min(1, -pointer.y * 1.2));
      }
      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
      };
    },
    /** Throttle change this frame: +1 up, -1 down, 0 still. */
    throttle() {
      let change = 0;
      if (hasAny(THROTTLE_UP)) change += 1;
      if (hasAny(THROTTLE_DOWN)) change -= 1;
      if (wheel !== 0) {
        change += wheel > 0 ? 1 : -1;
        wheel = 0;
      }
      return change;
    },
    brake() {
      return hasAny(BRAKE);
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
