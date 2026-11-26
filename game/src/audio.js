// Sound, all synthesised with WebAudio — no audio files, nothing fetched.
// The engine is a low oscillator whose pitch follows the throttle, rings
// chime, landings thud and crashes rumble. Everything is guarded: no gesture
// yet, no context; muted, silent. Created lazily on the first user gesture.

export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineGain = null;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(context.destination);
      engineOsc.start();
      return true;
    } catch {
      return false;
    }
  }

  function blip(frequency, duration, type, volume) {
    if (!context || muted) return;
    try {
      const osc = context.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume || 0.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + duration);
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  return {
    /** Call from a user gesture (start, key press) so the context may run. */
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
    },
    /** Continuous engine hum: throttle 0..1, airborne or not. */
    engine(throttle, airborne) {
      if (!context || muted) return;
      try {
        const target = airborne ? 0.05 + throttle * 0.05 : 0.02 + throttle * 0.02;
        engineGain.gain.setTargetAtTime(target, context.currentTime, 0.1);
        engineOsc.frequency.setTargetAtTime(52 + throttle * 68, context.currentTime, 0.1);
      } catch {
        // Ignore audio errors mid-flight.
      }
    },
    ring() {
      blip(880, 0.18, 'sine', 0.14);
      setTimeout(() => blip(1318, 0.3, 'sine', 0.12), 90);
    },
    thud() {
      blip(70, 0.25, 'triangle', 0.2);
    },
    crash() {
      blip(48, 0.7, 'sawtooth', 0.22);
    },
    toggleMute() {
      muted = !muted;
      if (engineGain && context) engineGain.gain.value = 0;
      return muted;
    },
    isMuted() {
      return muted;
    },
  };
}
