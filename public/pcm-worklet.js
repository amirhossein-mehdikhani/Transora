// Mono PCM16, 16kHz, 100ms packets. Runs outside the hidden document's UI thread.
class TransoraPcm extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(1600); this.index = 0; this.phase = 0; this.sum = 0; this.count = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.sum += value; this.count++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const mono = Math.max(-1, Math.min(1, this.sum / this.count));
        this.samples[this.index++] = Math.round(mono * (mono < 0 ? 32768 : 32767));
        this.sum = 0; this.count = 0;
        if (this.index === 1600) {
          this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
          this.samples = new Int16Array(1600); this.index = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('transora-pcm', TransoraPcm);
