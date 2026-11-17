import React, { useState } from 'react';
import { DubbingState, UserSettings, SUPPORTED_LANGUAGES, SupportedLanguage } from '../../types';
import { AudioVisualizer } from './AudioVisualizer';
import { 
  Sparkles, 
  Power, 
  Volume2, 
  Captions, 
  Sliders, 
  ChevronDown, 
  ChevronUp, 
  Globe2,
  EyeOff,
  Headphones
} from 'lucide-react';

interface DynamicIslandHUDProps {
  state: DubbingState;
  settings: UserSettings;
  onToggleDubbing: () => void;
  onLanguageChange: (lang: SupportedLanguage) => void;
  onToggleSubtitles: () => void;
  onOpenSettings: () => void;
  onHide: () => void;
  onTestDubbing?: () => void;
}

export const DynamicIslandHUD: React.FC<DynamicIslandHUDProps> = ({
  state,
  settings,
  onToggleDubbing,
  onLanguageChange,
  onToggleSubtitles,
  onOpenSettings,
  onTestDubbing,
  onHide,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  const isActive = state.status === 'dubbing' || state.status === 'listening';
  const isInitializing = state.status === 'initializing';
  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === settings.targetLanguage) || SUPPORTED_LANGUAGES[0];

  return (
    <div className="fixed top-5 right-5 z-[2147483647] font-sans select-none transora-interactive">
      <div 
        className={`transora-glass rounded-3xl transition-all duration-300 text-white shadow-2xl border ${
          isActive 
            ? 'border-indigo-500/50 shadow-[0_0_25px_rgba(99,102,241,0.25)]' 
            : 'border-white/10'
        } ${isExpanded ? 'w-80 p-4' : 'px-3 py-2 flex items-center gap-3'}`}
      >
        {/* Compact Mode Content */}
        {!isExpanded ? (
          <>
            {/* Logo / Brand Icon */}
            <div 
              className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all ${
                isActive 
                  ? 'bg-gradient-to-tr from-cyan-500 to-indigo-600 shadow-[0_0_12px_rgba(6,182,212,0.6)]' 
                  : 'bg-white/10 hover:bg-white/20'
              }`}
              onClick={() => setIsExpanded(true)}
              title="Expand Transora HUD"
            >
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>

            {/* Audio Wave Visualizer */}
            <AudioVisualizer 
              level={state.audioLevel} 
              isDucking={state.isDucking} 
              active={isActive} 
            />

            {/* Target Language Pill */}
            <div 
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium cursor-pointer hover:bg-white/10 transition-colors"
              onClick={() => setIsExpanded(true)}
            >
              <span>{currentLang.flag}</span>
              <span className="text-[11px] text-slate-200">{currentLang.code.toUpperCase()}</span>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-1.5 pl-1">
              <span 
                className={`w-2 h-2 rounded-full ${
                  isActive 
                    ? state.isDucking 
                      ? 'bg-cyan-400 animate-ping' 
                      : 'bg-emerald-400 animate-pulse' 
                    : 'bg-slate-500'
                }`} 
              />
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300">
                {isInitializing ? 'INIT' : isActive ? (state.isDucking ? 'DUBBING' : 'LIVE') : 'IDLE'}
              </span>
            </div>

            {/* Quick Action Button */}
            <button
              onClick={onToggleDubbing}
              disabled={isInitializing}
              className={`p-1.5 rounded-full transition-all ml-1 ${
                isActive
                  ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md'
              }`}
              title={isActive ? 'Stop Dubbing' : 'Start Live Dubbing'}
            >
              <Power className="w-3.5 h-3.5" />
            </button>

<button type="button" onClick={onHide} title="Hide floating controls; dubbing continues" aria-label="Hide floating controls"
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"><EyeOff className="w-3.5 h-3.5" /></button>
            {/* Expand Arrow */}
            <button
              onClick={() => setIsExpanded(true)}
              className="text-slate-400 hover:text-white p-0.5"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          /* Expanded Mode Content */
          <div className="space-y-3.5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-cyan-400 to-indigo-600 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-semibold text-sm tracking-wide bg-gradient-to-r from-white via-indigo-100 to-cyan-200 bg-clip-text text-transparent">
                  Transora Live
                </span>
              </div>

              <div className="flex items-center gap-1">
<button type="button" onClick={onHide} title="Hide floating controls; dubbing continues" aria-label="Hide floating controls"
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"><EyeOff className="w-3.5 h-3.5" /></button>
                <button
                  onClick={onOpenSettings}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                  title="Open Dashboard & Settings"
                >
                  <Sliders className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Primary Live Toggle Button */}
            <button
              onClick={onToggleDubbing}
              disabled={isInitializing}
              className={`w-full py-2.5 px-4 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all shadow-lg ${
                isActive
                  ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30'
                  : 'bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-semibold'
              }`}
            >
              <Power className="w-4 h-4" />
              <span>
                {isInitializing 
                  ? 'Connecting to Tab Stream...' 
                  : isActive 
                  ? 'Stop Live Dubbing' 
                  : 'Start Live Dubbing'}
              </span>
            </button>

            {/* Missing API Key Warning */}
            {(!settings.googleApiKey || settings.googleApiKey.trim().length === 0) && (
              <div 
                onClick={onOpenSettings}
                className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 text-[11px] cursor-pointer hover:bg-indigo-500/25 transition-colors flex items-center justify-between"
              >
                <span>⚠️ Google API Key required</span>
                <span className="text-[10px] text-cyan-300 font-semibold underline">Open Settings →</span>
              </div>
            )}

            {/* Error or Activation Notice */}
            {state.status === 'error' && state.errorMessage && (
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] leading-snug">
                <p className="font-semibold text-amber-300">Tab Audio Notice:</p>
                <p className="mt-0.5">{state.errorMessage}</p>
                <p className="mt-1 text-[10px] text-amber-400 font-mono">Shortcut: Alt+Shift+D</p>
              </div>
            )}

            {/* Target Language Dropdown */}
            <div className="relative">
              <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Globe2 className="w-3 h-3 text-cyan-400" /> Target Language
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{currentLang.flag}</span>
                  <span className="font-medium text-slate-100">{currentLang.name}</span>
                  <span className="text-slate-400">({currentLang.nativeName})</span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {langDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-slate-900/95 border border-white/10 rounded-xl shadow-2xl p-1 z-50 backdrop-blur-xl">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        onLanguageChange(lang.code);
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                        lang.code === settings.targetLanguage
                          ? 'bg-indigo-600/40 text-cyan-200'
                          : 'hover:bg-white/5 text-slate-200'
                      }`}
                    >
                      <span>{lang.flag}</span>
                      <span className="font-medium">{lang.name}</span>
                      <span className="text-slate-400 ml-auto">{lang.nativeName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Test Voice Button */}
            {onTestDubbing && (
              <button
                type="button"
                onClick={onTestDubbing}
                className="w-full py-1.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-cyan-300 flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                title="Translate & speak a sample sentence aloud to test your audio"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Test Dubbed Voice</span>
              </button>
            )}

            {/* Controls Bar */}
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              {/* Subtitles Toggle */}
              <button
                onClick={onToggleSubtitles}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs border transition-colors ${
                  settings.subtitlesEnabled
                    ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-200'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                <Captions className="w-3.5 h-3.5" />
                <span>Subtitles: {settings.subtitlesEnabled ? 'ON' : 'OFF'}</span>
              </button>

              {/* Ducking Indicator */}
              <div className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-white/5 border border-white/10 text-slate-300">
                <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Duck: {Math.round((1 - settings.duckingLevel) * 100)}%</span>
              </div>
            </div>

            {/* Audio Wave Monitor & Shortcut Hint */}
            <div className="space-y-1.5">
              <div className="bg-black/30 rounded-xl p-2.5 border border-white/5 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5 text-cyan-400" /> Tab Audio Stream
                </span>
                <AudioVisualizer 
                  level={state.audioLevel} 
                  isDucking={state.isDucking} 
                  active={isActive} 
                />
              </div>

              <div className="text-[10px] text-slate-400 flex items-center justify-between px-1">
                <span>Direct Tab Audio Capture:</span>
                <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-cyan-300 font-semibold">Alt + Shift + D</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

