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
  AlertTriangle,
  Play
} from 'lucide-react';
import { 
  DubbingState, 
  UserSettings, 
  DEFAULT_SETTINGS, 
  SUPPORTED_LANGUAGES, 
  SupportedLanguage,
  AVAILABLE_GEMINI_MODELS
} from '../types';
import { 
  translateTextWithGemini, 
  synthesizeSpeechGeminiAudio, 
  synthesizeSpeechGoogleCloud, 
  playAudioBuffer, 
  transliteratePersianToPhonetic 
} from '../services/google-gemini-live';

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
  const [targetTab, setTargetTab] = useState<chrome.tabs.Tab | null>(null);
  const [testingAudio, setTestingAudio] = useState(false);
  const [testAudioStatus, setTestAudioStatus] = useState<string | null>(null);

  const handleTestAudio = async () => {
    if (!settings.googleApiKey || settings.googleApiKey.trim().length === 0) {
      setShowKeyInput(true);
      return;
    }

    setTestingAudio(true);
    setTestAudioStatus('Translating & synthesizing voice...');

    const modelToUse = (settings.geminiModel && !settings.geminiModel.includes('gemini-2.0') && settings.geminiModel !== 'gemini-3.8-flash')
      ? settings.geminiModel
      : 'gemini-flash-lite-latest';

    try {
      const phrase = 'Hello! Transora live dubbing audio is working.';
      const res = await translateTextWithGemini(
        phrase,
        settings.targetLanguage,
        settings.googleApiKey,
        modelToUse
      );

      setTestAudioStatus(res.translatedText);

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      // Tier 1: Gemini Audio
      let played = false;
      try {
        const pcm = await synthesizeSpeechGeminiAudio(
          res.translatedText,
          settings.targetLanguage,
          settings.googleApiKey,
          settings.voiceGender,
          'gemini-3.8-flash-lite-tts'
        );
        await playAudioBuffer(audioCtx, pcm);
        played = true;
      } catch (e) {
        // Tier 2: Cloud TTS
        try {
          const cloudBuf = await synthesizeSpeechGoogleCloud(
            res.translatedText,
            settings.targetLanguage,
            settings.googleApiKey,
            settings.voiceGender,
            settings.voiceSpeed
          );
          await playAudioBuffer(audioCtx, cloudBuf);
          played = true;
        } catch (e2) {}
      }

      // Tier 3: Browser Speech fallback
      if (!played && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        let voices = window.speechSynthesis.getVoices();
        const match = voices.find((v) => v.lang.toLowerCase().startsWith(settings.targetLanguage.toLowerCase()));
        let textToSay = res.translatedText;
        let voiceToUse = match || voices.find((v) => v.default) || voices[0];
        if (!match && settings.targetLanguage === 'fa') {
          textToSay = transliteratePersianToPhonetic(textToSay);
        }
        const u = new SpeechSynthesisUtterance(textToSay);
        if (voiceToUse) {
          u.voice = voiceToUse;
          u.lang = voiceToUse.lang;
        }
        window.speechSynthesis.speak(u);
      }

      setTestAudioStatus('Voice verified successfully!');
      setTimeout(() => setTestAudioStatus(null), 3000);
    } catch (err: any) {
      setTestAudioStatus(`Test error: ${err.message}`);
      setTimeout(() => setTestAudioStatus(null), 4500);
    } finally {
      setTestingAudio(false);
    }
  };

  useEffect(() => {
    // Pre-fetch active video tab immediately on popup mount so click is 100% synchronous
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        setTargetTab(tabs[0]);
      }
    });

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
      return;
    }

    const captureTabAudio = (tab: chrome.tabs.Tab) => {
      if (!tab?.id) return;
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        alert('Cannot dub internal Chrome system pages (chrome://). Please navigate to YouTube, Meet, or any video webpage.');
        return;
      }

      // Call tabCapture.getMediaStreamId synchronously within user gesture
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
        if (streamId) {
          chrome.runtime.sendMessage({
            type: 'START_DUBBING_WITH_STREAM',
            streamId,
            tabId: tab.id,
          });
          return;
        }

        // Secondary attempt with default options
        chrome.tabCapture.getMediaStreamId({}, (fallbackId: string) => {
          if (fallbackId) {
            chrome.runtime.sendMessage({
              type: 'START_DUBBING_WITH_STREAM',
              streamId: fallbackId,
              tabId: tab.id,
            });
            return;
          }

          console.warn('tabCapture notice:', chrome.runtime.lastError?.message);
          chrome.runtime.sendMessage({
            type: 'START_DUBBING',
            tabId: tab.id,
          });
        });
      });
    };

    if (targetTab?.id) {
      captureTabAudio(targetTab);
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const t = tabs[0];
        if (t?.id) {
          setTargetTab(t);
          captureTabAudio(t);
        } else {
          chrome.tabs.query({ active: true }, (all) => {
            if (all[0]?.id) {
              setTargetTab(all[0]);
              captureTabAudio(all[0]);
            }
          });
        }
      });
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

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const model = e.target.value;
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { geminiModel: model },
    });
    setSettings((prev) => ({ ...prev, geminiModel: model }));
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

        {/* Test Voice Diagnostic Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleTestAudio}
            disabled={testingAudio}
            className="w-full py-1.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-cyan-300 font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>{testingAudio ? 'Testing Voice...' : 'Test Dubbed Voice'}</span>
          </button>
          {testAudioStatus && (
            <p className="mt-1.5 text-[11px] text-center text-cyan-200 font-medium bg-black/40 py-1 px-2 rounded-lg border border-cyan-500/20">
              {testAudioStatus}
            </p>
          )}
        </div>
      </div>

      {/* Target Language Selection */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <Globe2 className="w-3.5 h-3.5 text-cyan-400" /> Target Language
          </span>
          <span className="text-[10px] text-cyan-400 font-mono">
            {settings.targetLanguage.toUpperCase()}
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

      {/* AI Model Selection */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> AI Model
          </span>
          <span className="text-[10px] text-cyan-400 font-medium">
            {AVAILABLE_GEMINI_MODELS.find((m) => m.id === settings.geminiModel)?.badge || 'FREE'}
          </span>
        </div>
        <div className="relative">
          <select
            value={settings.geminiModel || 'gemini-flash-lite-latest'}
            onChange={handleModelChange}
            className="w-full appearance-none bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400 cursor-pointer"
          >
            {AVAILABLE_GEMINI_MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                {m.name} ({m.badge})
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

