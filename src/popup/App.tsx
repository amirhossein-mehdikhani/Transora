import React, { useEffect, useState } from 'react';
import { 
  Sparkles, 
  Power, 
  Globe2, 
  Captions, 
  Volume2, 
  Key, 
  PanelRight, 
  Layers, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';
import { 
  DubbingState, 
  UserSettings, 
  DEFAULT_SETTINGS, 
  SUPPORTED_LANGUAGES, 
  SupportedLanguage,
  AVAILABLE_GEMINI_MODELS
} from '../types';

export default function PopupApp() {
  const [state, setState] = useState<DubbingState>({
    status: 'idle',
    audioLevel: 0,
    isDucking: false,
    stats: { latencyMs: 0, sentencesDubbed: 0, bytesProcessed: 0 },
  });

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [quickKeyInput, setQuickKeyInput] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keySaveSuccess, setKeySaveSuccess] = useState(false);

  useEffect(() => {
    // Initial fetch
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
      if (res?.state) setState(res.state);
      if (res?.settings) {
        setSettings(res.settings);
        setQuickKeyInput(res.settings.googleApiKey || '');
      }
    });

    // Listen for state changes
    const listener = (msg: any) => {
      if (msg.type === 'STATE_CHANGED') {
        setState(msg.state);
      } else if (msg.type === 'AUDIO_LEVEL') {
        setState((prev) => ({
          ...prev,
          audioLevel: msg.level,
          isDucking: msg.isDucking,
        }));
      } else if (msg.type === 'SETTINGS_UPDATED') {
        setSettings(msg.settings);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const isActive = state.status === 'dubbing' || state.status === 'listening';
  const isInitializing = state.status === 'initializing';
  const hasApiKey = Boolean(settings.googleApiKey && settings.googleApiKey.trim().length > 0);

  const toggleDubbing = () => {
    if (!hasApiKey) {
      setShowKeyInput(true);
      return;
    }

    if (isActive) {
      chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
    } else {
      chrome.runtime.sendMessage({ type: 'START_DUBBING' });
    }
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value as SupportedLanguage;
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { targetLanguage: lang },
    });
    setSettings((prev) => ({ ...prev, targetLanguage: lang }));
  };

  const toggleSubtitles = () => {
    const nextVal = !settings.subtitlesEnabled;
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { subtitlesEnabled: nextVal },
    });
    setSettings((prev) => ({ ...prev, subtitlesEnabled: nextVal }));
  };

  const saveApiKey = () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { googleApiKey: quickKeyInput.trim() },
    }, () => {
      setKeySaveSuccess(true);
      setTimeout(() => {
        setKeySaveSuccess(false);
        setShowKeyInput(false);
      }, 1500);
    });
  };

  const openSidePanel = async () => {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab?.id && (chrome as any).sidePanel) {
      (chrome as any).sidePanel.open({ tabId: currentTab.id });
    }
  };

  return (
    <div className="p-4 space-y-4 select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.5)]">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-wide bg-gradient-to-r from-white via-indigo-100 to-cyan-200 bg-clip-text text-transparent">
              Transora
            </h1>
            <p className="text-[10px] text-slate-400 font-medium">Real-Time AI Dubbing</p>
          </div>
        </div>

        <button
          onClick={openSidePanel}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs border border-white/10 transition-colors"
          title="Open Side Panel Dashboard"
        >
          <PanelRight className="w-3.5 h-3.5 text-cyan-400" />
          <span>Dashboard</span>
        </button>
      </div>

      {/* API Key Missing Alert */}
      {!hasApiKey && !showKeyInput && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold">Google API Key Required</p>
              <p className="text-[11px] text-amber-300/80 mt-0.5">Enter your Gemini / Cloud API key to enable live voice dubbing.</p>
            </div>
          </div>
          <button
            onClick={() => setShowKeyInput(true)}
            className="w-full py-1.5 px-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Configure Key (BYOK)</span>
          </button>
        </div>
      )}

      {/* Quick API Key Modal / Drawer */}
      {showKeyInput && (
        <div className="p-3 rounded-xl bg-slate-900 border border-indigo-500/30 space-y-2 shadow-xl">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-400" /> Google API Key (BYOK)
            </span>
            <button
              onClick={() => setShowKeyInput(false)}
              className="text-slate-400 hover:text-white text-[11px]"
            >
              Cancel
            </button>
          </div>
          <input
            type="password"
            value={quickKeyInput}
            onChange={(e) => setQuickKeyInput(e.target.value)}
            placeholder="AIzaSy..."
            className="w-full px-3 py-1.5 bg-black/40 border border-white/15 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-400"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={saveApiKey}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1"
            >
              {keySaveSuccess ? <CheckCircle2 className="w-3 h-3 text-emerald-300" /> : null}
              <span>{keySaveSuccess ? 'Saved!' : 'Save Key'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Activation Card */}
      <div className={`p-4 rounded-2xl border transition-all ${
        isActive 
          ? 'bg-gradient-to-b from-indigo-950/40 to-slate-900/90 border-indigo-500/40 shadow-[0_0_20px_rgba(99,102,241,0.2)]' 
          : 'bg-slate-900/60 border-white/10'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="space-y-0.5">
            <p className="text-[11px] uppercase font-bold tracking-wider text-slate-400">Stream Status</p>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                isActive 
                  ? state.isDucking 
                    ? 'bg-cyan-400 animate-ping' 
                    : 'bg-emerald-400 animate-pulse' 
                  : 'bg-slate-600'
              }`} />
              <span className="text-xs font-semibold text-white">
                {isInitializing ? 'Connecting...' : isActive ? (state.isDucking ? 'Dubbing Speech' : 'Listening Tab') : 'Ready to Stream'}
              </span>
            </div>
          </div>

          {/* Audio Level Meter */}
          <div className="flex items-center gap-1 bg-black/40 px-2 py-1.5 rounded-xl border border-white/5">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <div className="w-12 h-2 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-75"
                style={{ width: `${state.audioLevel}%` }}
              />
            </div>
          </div>
        </div>

        {/* Primary Toggle Button */}
        <button
          onClick={toggleDubbing}
          disabled={isInitializing}
          className={`w-full py-3 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-lg ${
            isActive
              ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30'
              : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:opacity-95 text-white'
          }`}
        >
          <Power className="w-4 h-4" />
          <span>{isInitializing ? 'Initializing...' : isActive ? 'Stop Live Dubbing' : 'Start Live Dubbing'}</span>
        </button>
      </div>

      {/* Target Language Selection & Active Model */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <Globe2 className="w-3.5 h-3.5 text-cyan-400" /> Target Language
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {settings.geminiModel}
          </span>
        </div>
        <div className="relative">
          <select
            value={settings.targetLanguage}
            onChange={handleLanguageChange}
            className="w-full appearance-none bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400 cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
                {lang.flag} {lang.name} ({lang.nativeName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {/* Subtitles Toggle */}
        <button
          onClick={toggleSubtitles}
          className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-colors ${
            settings.subtitlesEnabled
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200'
              : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-white'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Captions className="w-3.5 h-3.5" /> Subtitles
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10">
            {settings.subtitlesEnabled ? 'ON' : 'OFF'}
          </span>
        </button>

        {/* Audio Ducking */}
        <div className="flex items-center justify-between p-2.5 rounded-xl border border-white/10 bg-slate-900/60 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" /> Auto-Duck
          </span>
          <span className="text-[10px] font-bold text-cyan-300">
            {Math.round((1 - settings.duckingLevel) * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

