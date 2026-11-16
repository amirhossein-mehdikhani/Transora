import { LIVE_MODELS, type UserSettings } from '../types';
interface Props { settings: UserSettings; onChange: (patch: Partial<UserSettings>) => void; }
export function LiveControls({ settings, onChange }: Props) {
  const selected = LIVE_MODELS.find(model => model.id === settings.liveModel);
  return <div className="rounded-xl border border-white/10 p-3 space-y-2 text-xs">
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
      <p className="text-cyan-200">{selected?.description || 'Custom Live API model. Your project must have access.'}</p>
      <p className="text-slate-400">“Unlimited” in one quota column does not remove token, session or billing limits. Check your Google project.</p>
      <p className="text-slate-400">Changing Live model, language, voice or speed stops the session. Start again to apply it.</p>
    </>}
  </div>;
}
