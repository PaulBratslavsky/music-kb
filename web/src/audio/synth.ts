/**
 * Tiny Web Audio synth — single triangle-wave voice per note with a quick
 * AD envelope so notes don't click and they overlap naturally for chords.
 *
 * Browsers require a user gesture before audio can start; the AudioContext is
 * created lazily on the first `play*` call so that gesture is the trigger.
 */
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
   * Play one MIDI note. `durationMs` is the natural release length; the note
   * will tail off after that and disconnect itself.
   */
  playNote(midi: number, durationMs = 600): void {
    if (this.muted) return;
    const ctx = this.ensureCtx();
    if (!this.masterGain) return;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    // Quick attack, gentle decay/release so notes layer cleanly.
    const t = ctx.currentTime;
    const attack = 0.005;
    const release = durationMs / 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, t + attack + release);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + attack + release + 0.05);
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }

  /** Play multiple notes at once (chord). */
  playChord(midis: number[], durationMs = 900): void {
    midis.forEach((m) => this.playNote(m, durationMs));
  }

  /** Play notes in sequence (arpeggio / scale ascending). */
  playSequence(midis: number[], noteDurationMs = 220): void {
    if (this.muted) return;
    midis.forEach((m, i) => {
      setTimeout(() => this.playNote(m, noteDurationMs * 1.5), i * noteDurationMs);
    });
  }
}

export const synth = new Synth();
