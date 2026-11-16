# Transora

Chrome Manifest V3 extension for tab-audio translation, dubbed speech, bilingual subtitles, and transcript export. React 18, TypeScript, Vite, and Tailwind. Requires Chrome 116 or newer.

## Setup

Use Node.js 24 or newer for the build and regression tests.

```sh
npm ci
npm test
npm run build
```

Open `chrome://extensions`, enable Developer mode, and load the `dist` directory. After changes, rebuild and reload the extension and the video tab. `npm run dev` watches both extension views and the injected content script; it does not automatically reload Chrome.

## Use

1. Open Settings and enter your own Google API key. The key tester checks model-list access; it does not prove audio translation, TTS access, billing, or quota availability.
2. Play a video or open a browser meeting. Click the extension toolbar icon once on that tab to grant capture access.
3. Start from the popup, side panel, floating controls, or Alt+Shift+D. Only one tab is dubbed at a time. All controls share one session.
4. Stop from any control. Closing or navigating the captured tab also stops the session.

The optional HTTP engine records audio in complete, independently decodable WebM segments, then sent to Gemini for transcription and translation. Processing and speech are serialized to preserve order. Gemini TTS is attempted first, followed by Google Cloud TTS and an installed browser voice for the target language. Browser-voice playback suppresses translation of overlapping captured segments to prevent the dubbed voice feeding back into translation; this fallback can skip original dialogue. Missing native browser voices produce an explicit error; Persian is never substituted with English phonetics.

In the HTTP engine, Video mode uses the configured segment duration (1–8 seconds). Live Call caps it at 1.5 seconds. Speed, ducking, language, and duration changes apply to future segments. Original tab sound is ducked during translated playback. If processing falls too far behind, the session stops with an actionable error instead of building an unlimited queue.

The HTTP engine uses recorded-segment processing. Latency includes recording, translation, synthesis and any queue wait. MediaRecorder restarts can introduce small recording gaps. Platform support, protected media, voice quality, and end-to-end latency require real-browser testing. Meeting mode translates captured tab audio; it does not inject a translated microphone into a call.

## Gemini Live streaming (default)

Select the Live engine in the popup or studio. The default Live model is Gemini 3.5 Live Translate. The selector also includes Gemini 2.5 Flash Native Audio Dialog, Gemini 3 Flash Live (using the documented 3.1 preview ID), Gemini 3.5 Transcribe Live, Gemini 3.8 Live, and Gemini 3.8 Live Extended Thinking. Account model discovery and custom IDs remain available.

Live capture uses an AudioWorklet to mix to mono and resample to PCM16 at 16kHz, sent in 100ms packets over a Google WebSocket. It waits for setup acknowledgment before streaming. Returned PCM is scheduled contiguously on the audio clock with a 160ms initial reserve to absorb packet jitter. A 300ms grace period keeps original audio ducked across short gaps. Voice speed is preserved; no packets are dropped to catch up. Status updates are coalesced to at most 10 per second, and subtitles use a compact, gently fading display. Fullscreen player containers retain the overlay. The extra startup reserve trades a small amount of latency for smoother playback. This path does not call the HTTP translation or separate TTS APIs, and never silently switches to those APIs when a Live model fails.

Live Translate uses Google's dedicated translation configuration. Dialogue models use interpreter instructions and may answer or omit speech despite those instructions; Live Translate is preferred for dubbing. Transcribe Live provides source-language captions and transcript export only: it does not translate or generate dubbed speech. Sample voice tests are restricted to HTTP mode; test Live with a playing tab.

Changing engine, or a Live model/language/key/voice/speed, stops the session; start again to apply it. Audio segment settings apply only to HTTP mode. Live playback uses the selected speed. In Live mode the latency badge reports approximate playback queue delay, not end-to-end translation latency. Live SRT times are relative to the session, and input/output transcript pairing is best-effort because Google sends them independently. Session expiry, quota errors and connection loss stop with a message; restart to reconnect. Automatic session resumption is not implemented.

“Unlimited” in selected AI Studio quota columns is not a guarantee of unlimited tokens, concurrency, session duration, or free usage. Account access, limits and billing are enforced by Google. No live account or paid request was used to verify these models.

Official references: [Live translation](https://aistudio.google.com/docs/live-api/live-translate), [Live capabilities](https://aistudio.google.com/docs/live-api/capabilities), and [WebSocket protocol](https://aistudio.google.com/api-reference/live).

## State and exports

- The background worker owns session state. Acknowledged capture startup, session IDs, abort signals, and browser-session storage prevent duplicate starts and stale results after stop.
- The offscreen document owns capture, audio graphs, and playback. Its audio meter uses a timer because hidden documents suspend animation frames. Extension APIs are reached through runtime messaging.
- The content script renders the HUD/subtitles and handles installed browser speech fallback. It has no independent capture pipeline or YouTube DOM dependency.
- The last 150 transcript items are stored locally. TXT includes history; SRT exports the newest recorded session with known media positions (or elapsed session time for tabs without a video). Old entries without timing remain available as TXT. Seeking during recording can require manual subtitle editing; this is not forced alignment.

## Privacy, credentials and models

The API key and transcript history are stored in Chrome local storage without encryption. Audio and text are sent directly to Google. Browser speech may use the selected system voice's service. There is no Transora server. Broad site access enables the overlay on video sites; Chrome internal pages cannot be captured.

The optional HTTP translation model defaults to `gemini-flash-lite-latest`. Use model discovery or enter a model available to your project. Model-list access is not proof of audio-input support. Only unavailable/unsupported translation models fall back to the default. Gemini speech uses `gemini-3.1-flash-tts-preview`; availability and pricing depend on the project. Google Cloud TTS may need separate API enablement and billing. No free-tier, model-latency, or zero-lag guarantees are made.

## Main files

- `src/background/index.ts`: session ownership and routing
- `src/offscreen/index.ts`: capture, completed recordings, ordered translation/playback
- `src/content/index.tsx`: HUD, subtitles, browser speech endpoint
- `src/services/google-gemini-live.ts`: Google HTTP calls and audio decoding
- `src/services/speech.ts`: shared synthesis and browser fallback
- `src/services/storage.ts`: validated settings and serialized storage writes
- `src/services/gemini-live-session.ts`: Live setup, streaming protocol, transcripts, and PCM playback
- `public/pcm-worklet.js`: mono mixing and streaming sample-rate conversion
- `src/components/LiveControls.tsx`: shared engine and Live model selector
- `src/services/session.ts`: timing and SRT export
- `tests/`: mocked regression tests; these do not validate live Google accounts or Chrome permissions
