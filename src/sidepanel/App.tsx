import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Key, 
  Sliders, 
  FileText, 
  Volume2, 
  Globe2, 
  Download, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Power, 
  ExternalLink,
  Video,
  Users2,
  Eye,
  EyeOff
} from 'lucide-react';
import { 
  UserSettings, 
  DEFAULT_SETTINGS, 
  TranscriptItem, 
  DubbingState, 
  SUPPORTED_LANGUAGES, 
  VoiceGender, 
  AppMode 
} from '../types';
import { 
  getStoredSettings, 
  saveStoredSettings, 
  getStoredTranscripts, 
  clearStoredTranscripts, 
  testGoogleApiKey 
} from '../services/storage';

export default function SidePanelApp() {
  const [activeTab, setActiveTab] = useState<'transcripts' | 'audio' | 'api'>('transcripts');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // BYOK State
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Global State
  const [dubbingState, setDubbingState] = useState<DubbingState>({
    status: 'idle',
    audioLevel: 0,
    isDucking: false,
    stats: { latencyMs: 0, sentencesDubbed: 0, bytesProcessed: 0 },
  });

  useEffect(() => {
    // Load initial settings and transcripts
    getStoredSettings().then((s) => {
      setSettings(s);
      setApiKeyInput(s.googleApiKey || '');
    });

    getStoredTranscripts().then((t) => {
      setTranscripts(t);
    });

    // Listen for events
    const listener = (msg: any) => {
      if (msg.type === 'NEW_TRANSCRIPT') {
        setTranscripts((prev) => [msg.item, ...prev]);
      } else if (msg.type === 'STATE_CHANGED') {
        setDubbingState(msg.state);
      } else if (msg.type === 'AUDIO_LEVEL') {
        setDubbingState((prev) => ({
          ...prev,
          audioLevel: msg.level,
          isDucking: msg.isDucking,
        }));
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleUpdateSetting = async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const updated = await saveStoredSettings({ [key]: value });
    setSettings(updated);
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: { [key]: value },
    });
  };

  const handleTestKey = async () => {
    setTestingKey(true);
    setKeyTestResult(null);
    const result = await testGoogleApiKey(apiKeyInput);
    setKeyTestResult(result);
    setTestingKey(false);

    if (result.success) {
      handleUpdateSetting('googleApiKey', apiKeyInput.trim());
    }
  };

  const handleClearTranscripts = async () => {
    await clearStoredTranscripts();
    setTranscripts([]);
  };

  const handleExportSRT = () => {
    if (transcripts.length === 0) return;

    let srtContent = '';
    const sorted = [...transcripts].reverse();

    sorted.forEach((item, index) => {
      const startTime = new Date(item.timestamp).toISOString().substring(11, 23).replace('.', ',');
      const endTime = new Date(item.timestamp + 3000).toISOString().substring(11, 23).replace('.', ',');

      srtContent += `${index + 1}\n`;
      srtContent += `${startTime} --> ${endTime}\n`;
      srtContent += `${item.translatedText}\n`;
      if (settings.bilingualSubtitles) {
        srtContent += `${item.originalText}\n`;
      }
      srtContent += '\n';
    });

    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transora-transcript-${Date.now()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredTranscripts = transcripts.filter(
    (t) =>
      t.translatedText.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.originalText.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isActive = dubbingState.status === 'dubbing' || dubbingState.status === 'listening';

  return (
    <div className="flex flex-col h-full bg-[#080B11] text-slate-100 select-none">
      {/* Top Studio Header */}
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-violet-600 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.5)]">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-wide bg-gradient-to-r from-white via-indigo-100 to-cyan-200 bg-clip-text text-transparent">
                Transora Studio
              </h1>
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-cyan-400 animate-ping' : 'bg-slate-600'}`} />
            </div>
            <p className="text-[11px] text-slate-400">Live Voice Dubbing & Subtitles</p>
          </div>
        </div>

        {/* Quick Power Toggle */}
        <button
          onClick={() => {
            if (isActive) chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
            else chrome.runtime.sendMessage({ type: 'START_DUBBING' });
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-medium text-xs transition-all ${
            isActive
              ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg'
          }`}
        >
          <Power className="w-3.5 h-3.5" />
          <span>{isActive ? 'Stop' : 'Live'}</span>
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center px-4 border-b border-white/10 shrink-0 bg-slate-900/20 text-xs">
        <button
          onClick={() => setActiveTab('transcripts')}
          className={`flex items-center gap-2 px-3.5 py-3 font-medium border-b-2 transition-all ${
            activeTab === 'transcripts'
              ? 'border-indigo-400 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Transcripts</span>
          {transcripts.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-[10px]">
              {transcripts.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('audio')}
          className={`flex items-center gap-2 px-3.5 py-3 font-medium border-b-2 transition-all ${
            activeTab === 'audio'
              ? 'border-indigo-400 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Audio & Voices</span>
        </button>

        <button
          onClick={() => setActiveTab('api')}
          className={`flex items-center gap-2 px-3.5 py-3 font-medium border-b-2 transition-all ${
            activeTab === 'api'
              ? 'border-indigo-400 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Google AI (BYOK)</span>
          {!settings.googleApiKey && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </button>
      </div>

      {/* Tab 1: Live Transcripts */}
      {activeTab === 'transcripts' && (
        <div className="flex-1 flex flex-col p-4 overflow-hidden space-y-3">
          {/* Action bar */}
          <div className="flex items-center justify-between gap-2 shrink-0">
            <input
              type="text"
              placeholder="Search transcript..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-slate-900 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleExportSRT}
                disabled={transcripts.length === 0}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors disabled:opacity-40"
                title="Export as SRT Subtitles"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleClearTranscripts}
                disabled={transcripts.length === 0}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-rose-300 hover:text-rose-200 transition-colors disabled:opacity-40"
                title="Clear Transcripts"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Transcript List */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {filteredTranscripts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <FileText className="w-10 h-10 stroke-1 mb-2 text-slate-600" />
                <p className="text-xs font-medium text-slate-400">No transcripts yet</p>
                <p className="text-[11px] mt-1 max-w-[220px]">
                  Play a video or start a call and spoken dialogue will be transcribed and translated here in real-time.
                </p>
              </div>
            ) : (
              filteredTranscripts.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-2xl bg-slate-900/70 border border-white/5 hover:border-white/10 transition-colors space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-mono text-cyan-400/80">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 uppercase font-medium">
                      {item.targetLang}
                    </span>
                  </div>

                  {/* Translated Text */}
                  <p 
                    dir={item.targetLang === 'fa' || item.targetLang === 'ar' ? 'rtl' : 'ltr'}
                    className="text-sm font-medium text-slate-100 leading-relaxed"
                  >
                    {item.translatedText}
                  </p>

                  {/* Original Text */}
                  <p className="text-xs text-indigo-300/80 font-normal leading-relaxed pt-0.5 border-t border-white/5">
                    {item.originalText}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Audio & Voice Settings */}
      {activeTab === 'audio' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
          {/* Platform Mode */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Optimization Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleUpdateSetting('mode', 'video')}
                className={`flex items-center gap-2 p-3 rounded-2xl border text-left transition-all ${
                  settings.mode === 'video'
                    ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-200'
                    : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                <Video className="w-4 h-4 text-cyan-400 shrink-0" />
                <div>
                  <p className="font-semibold text-xs text-white">Video Player</p>
                  <p className="text-[10px] text-slate-400">YouTube, Twitch, generic HTML5</p>
                </div>
              </button>

              <button
                onClick={() => handleUpdateSetting('mode', 'meeting')}
                className={`flex items-center gap-2 p-3 rounded-2xl border text-left transition-all ${
                  settings.mode === 'meeting'
                    ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-200'
                    : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                <Users2 className="w-4 h-4 text-violet-400 shrink-0" />
                <div>
                  <p className="font-semibold text-xs text-white">Live Call</p>
                  <p className="text-[10px] text-slate-400">Google Meet, Teams, Zoom Web</p>
                </div>
              </button>
            </div>
          </div>

          {/* Audio Ducking */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">Smart Audio Ducking</p>
                <p className="text-[11px] text-slate-400">Fades original video audio when dubbed voice speaks</p>
              </div>
              <span className="text-xs font-bold text-cyan-400">
                {Math.round((1 - settings.duckingLevel) * 100)}% Ducked
              </span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.5"
              step="0.01"
              value={settings.duckingLevel}
              onChange={(e) => handleUpdateSetting('duckingLevel', parseFloat(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Subtle (95% Original)</span>
              <span>Balanced (82%)</span>
              <span>Quiet (50%)</span>
            </div>
          </div>

          {/* Voice Gender & Speed */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-4">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-medium">Neural Voice Persona</label>
              <div className="grid grid-cols-2 gap-2">
                {(['FEMALE', 'MALE'] as VoiceGender[]).map((gender) => (
                  <button
                    key={gender}
                    onClick={() => handleUpdateSetting('voiceGender', gender)}
                    className={`py-2 px-3 rounded-xl border text-center font-medium capitalize transition-all ${
                      settings.voiceGender === gender
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {gender.toLowerCase()} Voice
                  </button>
                ))}
              </div>
            </div>

            {/* Speaking Rate */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium">Speaking Speed</span>
                <span className="text-cyan-400 font-bold">{settings.voiceSpeed}x</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.4"
                step="0.05"
                value={settings.voiceSpeed}
                onChange={(e) => handleUpdateSetting('voiceSpeed', parseFloat(e.target.value))}
                className="w-full accent-indigo-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Subtitles Preferences */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-3">
            <p className="font-semibold text-white">Subtitle Overlay Preferences</p>
            
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-slate-200 font-medium">Show Video Subtitles</p>
                <p className="text-[10px] text-slate-400">Floating captions directly on video player</p>
              </div>
              <input
                type="checkbox"
                checked={settings.subtitlesEnabled}
                onChange={(e) => handleUpdateSetting('subtitlesEnabled', e.target.checked)}
                className="w-4 h-4 accent-cyan-400 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between py-1 border-t border-white/5">
              <div>
                <p className="text-slate-200 font-medium">Dual Bilingual Mode</p>
                <p className="text-[10px] text-slate-400">Display both translated and original dialogue</p>
              </div>
              <input
                type="checkbox"
                checked={settings.bilingualSubtitles}
                onChange={(e) => handleUpdateSetting('bilingualSubtitles', e.target.checked)}
                className="w-4 h-4 accent-indigo-400 cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Google AI (BYOK) */}
      {activeTab === 'api' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          <div className="p-4 rounded-2xl bg-gradient-to-b from-indigo-950/30 to-slate-900 border border-indigo-500/20 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <Key className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Bring Your Own Key (BYOK)</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Your Google API Key stays private and encrypted directly inside your browser's local storage.
                </p>
              </div>
            </div>

            {/* Input field */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-medium text-slate-300">Google Gemini / Cloud API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="AIzaSyD..."
                  className="w-full px-3 py-2 pr-10 bg-slate-950 border border-white/10 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-400 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Test & Save buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleTestKey}
                disabled={testingKey || !apiKeyInput.trim()}
                className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium flex items-center justify-center gap-1.5 transition-all shadow-md"
              >
                {testingKey ? <span className="animate-spin">🌀</span> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>{testingKey ? 'Verifying...' : 'Test & Save Key'}</span>
              </button>
            </div>

            {/* Key test result message */}
            {keyTestResult && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2 ${
                  keyTestResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                {keyTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span className="text-[11px] leading-relaxed">{keyTestResult.message}</span>
              </div>
            )}
          </div>

          {/* Model Selection */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-3">
            <label className="text-slate-300 font-medium">Gemini Translation Model</label>
            <select
              value={settings.geminiModel}
              onChange={(e) => handleUpdateSetting('geminiModel', e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400 cursor-pointer"
            >
              <option value="gemini-1.5-flash">Gemini 1.5 Flash (Ultra Low Latency - Recommended)</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash (Next-Gen Real-Time)</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Context & Cinematic Nuance)</option>
            </select>
          </div>

          {/* Guide Card */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">How to get a Free Google Key?</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[11px]"
              >
                <span>Google AI Studio</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 leading-relaxed">
              <li>Visit <strong className="text-slate-200">Google AI Studio</strong>.</li>
              <li>Sign in with your Google account.</li>
              <li>Click <strong className="text-slate-200">"Create API Key"</strong>.</li>
              <li>Copy and paste the key here. Free tier provides generous daily quotas!</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

