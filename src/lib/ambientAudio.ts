import type { AmbientSoundId } from '../types/study';

export const AMBIENT_SOUND_OPTIONS: Array<{
  id: AmbientSoundId;
  label: string;
  subtitle: string;
}> = [
  { id: 'none', label: 'Silence', subtitle: 'No background sound' },
  { id: 'brown', label: 'Brown Noise', subtitle: 'Deep, warm low rumble' },
  { id: 'pink', label: 'Pink Noise', subtitle: 'Balanced, soft rainfall tone' },
  { id: 'white', label: 'White Noise', subtitle: 'Crisp, steady air static' },
  { id: 'rain', label: 'Window Rain', subtitle: 'Soft pattering rain ambience' },
  { id: 'forest', label: 'Quiet Wind', subtitle: 'Gentle breathing breeze' },
];

class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeFilter: BiquadFilterNode | null = null;
  private lfoOsc: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private currentSound: AmbientSoundId = 'none';
  private volume = 0.35;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private createSeamlessBuffer(ctx: AudioContext, type: Exclude<AmbientSoundId, 'none'>): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const durationSec = 4;
    const length = sampleRate * durationSec;
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);

      if (type === 'white') {
        for (let i = 0; i < length; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.25;
        }
      } else if (type === 'pink' || type === 'rain') {
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        let b3 = 0;
        let b4 = 0;
        let b5 = 0;
        let b6 = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
          b6 = white * 0.115926;
          if (type === 'rain') {
            const droplet = Math.random() > 0.9992 ? (Math.random() * 0.25) : 0;
            data[i] = pink + droplet;
          } else {
            data[i] = pink;
          }
        }
      } else {
        // brown or forest base
        let lastOut = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          lastOut = (lastOut + 0.02 * white) / 1.02;
          data[i] = lastOut * 1.8;
        }
      }

      // Crossfade edges (first/last 200ms) for click-free looping
      const fadeSamples = Math.floor(sampleRate * 0.2);
      for (let i = 0; i < fadeSamples; i++) {
        const t = i / fadeSamples;
        const startSample = data[i];
        const endSample = data[length - fadeSamples + i];
        data[i] = startSample * t + endSample * (1 - t);
      }
    }

    return buffer;
  }

  public stop(): void {
    try {
      this.activeSource?.stop();
      this.activeSource?.disconnect();
    } catch {
      // ignore if already stopped
    }
    try {
      this.lfoOsc?.stop();
      this.lfoOsc?.disconnect();
    } catch {
      // ignore
    }
    this.activeFilter?.disconnect();
    this.lfoGain?.disconnect();
    this.activeSource = null;
    this.activeFilter = null;
    this.lfoOsc = null;
    this.lfoGain = null;
    this.currentSound = 'none';
  }

  public play(sound: AmbientSoundId, volume?: number): void {
    if (typeof volume === 'number') {
      this.setVolume(volume);
    }
    if (sound === 'none') {
      this.stop();
      return;
    }
    if (this.currentSound === sound && this.activeSource) {
      return;
    }

    this.stop();
    const ctx = this.ensureContext();
    if (!this.masterGain) return;

    const buffer = this.createSeamlessBuffer(ctx, sound);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    if (sound === 'brown') {
      filter.type = 'lowpass';
      filter.frequency.value = 380;
    } else if (sound === 'pink') {
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
    } else if (sound === 'white') {
      filter.type = 'lowpass';
      filter.frequency.value = 4200;
    } else if (sound === 'rain') {
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.5;
    } else if (sound === 'forest') {
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.14;
      lfoGain.gain.value = 320;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
      this.lfoOsc = lfo;
      this.lfoGain = lfoGain;
    }

    source.connect(filter);
    filter.connect(this.masterGain);
    source.start();

    this.activeSource = source;
    this.activeFilter = filter;
    this.currentSound = sound;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public playCompletionChime(): void {
    try {
      const ctx = this.ensureContext();
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.14 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.9);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 0.95);
      });
    } catch {
      // Audio playback blocked before interaction
    }
  }
}

export const ambientAudio = new AmbientAudioEngine();
