import { LIVE_MODELS, type UserSettings } from '../types';
interface Props { settings: UserSettings; onChange: (patch: Partial<UserSettings>) => void; }
export function LiveControls({ settings, onChange }: Props) {
  const selected = LIVE_MODELS.find(model => model.id === settings.liveModel);
  return <div className="rounded-xl border border-white/10 p-3 space-y-2 text-xs">
    <button type="button" aria-pressed={settings.hudVisible} onClick={() => onChange({ hudVisible: !settings.hudVisible })}
      className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
      {settings.hudVisible ? 'Hide floating controls' : 'Show floating controls'}
    </button>
    <p className="text-slate-400">Dubbing and subtitles continue while controls are hidden.</p>
    <label className="block text-slate-300">Audio engine
      <select value={settings.engine} onChange={event => onChange({ engine: event.target.value as UserSettings['engine'] })} className="mt-1 w-full rounded-lg bg-slate-950 p-2 text-white border border-white/10">
        <option value="gemini_live">Gemini Live — streaming audio</option>
        <option value="http">HTTP — recorded segments + TTS</option>
      </select>
    </label>
    {settings.engine === 'gemini_live' && <>
      <label className="block text-slate-300">Live model
        <select value={settings.liveModel} onChange={event => onChange({ liveModel: event.target.value })} className="mt-1 w-full rounded-lg bg-slate-950 p-2 text-white border border-white/10">
          {LIVE_MODELS.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          {!selected && <option value={settings.liveModel}>{settings.liveModel}</option>}
        </select>
      </label>
      {selected?.kind === 'translate' && <div className="space-y-2">
        <p className="text-amber-200">Live Translate follows source speaker voices; Google notes these can change after pauses.</p>
        <button type="button" className="w-full rounded-lg bg-indigo-600 p-2 text-white"
          onClick={() => onChange({ liveModel: 'gemini-3.8-live', liveVoiceName: 'Kore' })}>Use fixed narrator — Gemini 3.8 Live</button>
        <p className="text-slate-400">Uses interpreter instructions and one selected voice. Requires access to this model; restart dubbing after switching.</p>
      </div>}
      {selected?.kind === 'dialog' && <label className="block text-slate-300">Narrator voice
        <select value={settings.liveVoiceName} onChange={event => onChange({ liveVoiceName: event.target.value as UserSettings['liveVoiceName'] })}
          className="mt-1 w-full rounded-lg bg-slate-950 p-2 text-white border border-white/10">
          <option value="Kore">Kore</option><option value="Puck">Puck</option><option value="Aoede">Aoede</option><option value="Charon">Charon</option>
        </select>
      </label>}
      <p className="text-cyan-200">{selected?.description || 'Custom Live API model. Your project must have access.'}</p>
      <p className="text-slate-400">“Unlimited” in one quota column does not remove token, session or billing limits. Check your Google project.</p>
      <p className="text-slate-400">Changing Live model, language, voice or speed stops the session. Start again to apply it.</p>
    </>}
  </div>;
}
