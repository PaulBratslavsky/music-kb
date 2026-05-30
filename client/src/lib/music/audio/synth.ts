/**
 * Tiny Web Audio synth. One oscillator voice per note with a quick AD
 * envelope so notes don't click and chords overlap naturally. Voices add
 * a per-instrument timbre (oscillator type + envelope + optional lowpass)
 * so the composer can give melody, chords, and bass distinct sounds.
 *
 * Browsers require a user gesture before audio can start; the
 * AudioContext is created lazily on the first `play*` call so that
 * gesture is the trigger.
 */

export type Voice = 'default' | 'piano' | 'string' | 'bass';

type VoiceParams = {
  type: OscillatorType;
  /** Attack time in seconds. */
  attack: number;
  /** Peak gain for one voice (kept low for layered voices like chords). */
  peak: number;
  /** Lowpass cutoff in Hz, or null for no filter. Tames buzzy sawtooths. */
  cutoff: number | null;
};

const VOICES: Record<Voice, VoiceParams> = {
  // Unchanged from the original single-voice synth (Circle, intervals…).
  default: { type: 'triangle', attack: 0.005, peak: 0.5, cutoff: null },
  // Melody — bright and percussive.
  piano: { type: 'triangle', attack: 0.003, peak: 0.5, cutoff: 4500 },
  // Chords — softer sawtooth pad, filtered so stacked notes don't buzz.
  string: { type: 'sawtooth', attack: 0.05, peak: 0.26, cutoff: 2200 },
  // Bass — smooth sine with a touch more level.
  bass: { type: 'sine', attack: 0.006, peak: 0.6, cutoff: 800 },
};

class Synth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.3;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : 0.3;
  }

  /**
   * Play one MIDI note with the given voice. `durationMs` is the natural
   * release length; the note tails off after that and disconnects itself.
   */
  playNote(midi: number, durationMs = 600, voice: Voice = 'default'): void {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!this.masterGain) return;
    const v = VOICES[voice];
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = v.type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    const t = ctx.currentTime;
    const attack = v.attack;
    const release = durationMs / 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(v.peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t + attack + release);

    // Optional lowpass to round off harsher waveforms (string/bass).
    let tail: AudioNode = osc;
    let filter: BiquadFilterNode | null = null;
    if (v.cutoff != null) {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(v.cutoff, t);
      osc.connect(filter);
      tail = filter;
    }
    tail.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + attack + release + 0.05);
    osc.onended = () => {
      try {
        gain.disconnect();
        filter?.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  /** Play multiple notes at once (chord). */
  playChord(midis: number[], durationMs = 900, voice: Voice = 'default'): void {
    midis.forEach((m) => this.playNote(m, durationMs, voice));
  }

  /** Play notes in sequence (arpeggio / scale ascending). */
  playSequence(midis: number[], noteDurationMs = 220, voice: Voice = 'default'): void {
    if (this.muted) return;
    midis.forEach((m, i) => {
      setTimeout(() => this.playNote(m, noteDurationMs * 1.5, voice), i * noteDurationMs);
    });
  }
}

export const synth = new Synth();
