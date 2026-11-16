import './register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { LivePlayback } = await import('../src/services/live-playback.ts');
function fixture() {
  const sources = [], changes = [];
  const context = { currentTime: 0, destination: {}, createBufferSource() {
    const source = { playbackRate: {}, connect() {}, disconnect() {}, start(time) { this.time = time; }, stop() { this.stopped = true; } };
    sources.push(source); return source;
  } };
  return { context, sources, changes, playback: new LivePlayback(context, 1, active => changes.push(active)) };
}
test('small jitter reserve is applied once, consecutive packets stay contiguous', () => {
  const { playback, sources, changes } = fixture();
  playback.enqueue({ duration: 0.1 });
  playback.enqueue({ duration: 0.1 });
  playback.enqueue({ duration: 0.1 });
  assert.equal(sources[0].time, 0.16);
  assert.equal(sources[1].time, 0.26);
  assert.equal(sources[2].time, 0.36);
  assert.deepEqual(changes, [true]);
  playback.close();
});
test('short packet gaps preserve ducking; speech release happens only after the grace period', async () => {
  const { playback, sources, context, changes } = fixture();
  playback.enqueue({ duration: 0.1 });
  context.currentTime = 0.26;
  sources[0].onended();
  assert.deepEqual(changes, [true]);
  playback.enqueue({ duration: 0.1 });
  assert.equal(sources[1].time, 0.3);
  assert.deepEqual(changes, [true]);
  sources[1].onended();
  await new Promise(resolve => setTimeout(resolve, 340));
  assert.deepEqual(changes, [true, false]);
  playback.close();
});
test('stop cancels scheduled packets and pending release without late state changes', async () => {
  const { playback, sources, changes } = fixture();
  playback.enqueue({ duration: 1 });
  playback.close();
  assert.equal(sources[0].stopped, true);
  const count = sources.length;
  playback.enqueue({ duration: 1 });
  assert.equal(sources.length, count);
  assert.deepEqual(changes, [true, false]);
});
