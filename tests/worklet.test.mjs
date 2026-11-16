import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
test('AudioWorklet mixes stereo to mono and produces contiguous 100ms PCM16 packets at 16kHz', () => {
  let Worklet;
  const packets = [];
  const sandbox = { sampleRate: 48000, Int16Array, AudioWorkletProcessor: class { port = { postMessage(buffer) { packets.push(new Int16Array(buffer)); } }; }, registerProcessor(_name, implementation) { Worklet = implementation; } };
  vm.runInNewContext(fs.readFileSync(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8'), sandbox);
  const processor = new Worklet();
  // 75 render quanta * 128 samples = 200ms at 48kHz.
  for (let i = 0; i < 75; i++) processor.process([[new Float32Array(128).fill(1), new Float32Array(128).fill(0)]]);
  assert.equal(packets.length, 2);
  assert.equal(packets[0].length, 1600);
  assert.ok(packets.every(packet => packet.every(sample => sample === 16384)));
});
