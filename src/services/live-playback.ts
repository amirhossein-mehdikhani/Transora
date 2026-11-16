import type { UserSettings } from '../types';

// Schedule PCM packets against the audio clock, keeping a small reserve for network jitter.
export class LivePlayback {
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private release?: ReturnType<typeof setTimeout>;
  private speaking = false;
  private closed = false;
  private context: AudioContext;
  private speed: UserSettings['voiceSpeed'];
  private onSpeaking: (speaking: boolean) => void;
  constructor(context: AudioContext, speed: UserSettings['voiceSpeed'], onSpeaking: (speaking: boolean) => void) {
    this.context = context; this.speed = speed; this.onSpeaking = onSpeaking;
  }
  get queuedMs() { return Math.round(Math.max(0, this.nextTime - this.context.currentTime) * 1000); }
  enqueue(buffer: AudioBuffer) {
    if (this.closed) return;
    if (this.queuedMs > 15000) throw new Error('Live playback is more than 15 seconds behind. Increase voice speed or restart.');
    clearTimeout(this.release);
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.speed;
    source.connect(this.context.destination);
    // Only prebuffer at the start of a burst. Applying a padding to every packet creates gaps.
    const time = this.sources.size === 0 ? now + (this.speaking ? 0.04 : 0.16) : Math.max(now + 0.005, this.nextTime);
    this.nextTime = time + buffer.duration / this.speed;
    this.sources.add(source);
    if (!this.speaking) { this.speaking = true; this.onSpeaking(true); }
    source.onended = () => {
      source.disconnect(); this.sources.delete(source);
      if (this.sources.size || this.closed) return;
      // Bridge small packet gaps so the original audio does not pump up and down.
      this.release = setTimeout(() => {
        if (this.sources.size || this.closed) return;
        this.speaking = false; this.onSpeaking(false);
      }, 300);
    };
    source.start(time);
  }
  clear() {
    clearTimeout(this.release);
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); }
    this.sources.clear(); this.nextTime = 0;
    if (this.speaking) this.onSpeaking(false);
    this.speaking = false;
  }
  close() { this.clear(); this.closed = true; }
}
