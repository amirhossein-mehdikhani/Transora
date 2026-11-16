import React, { useEffect, useRef, useState } from 'react';
import type { SupportedLanguage } from '../../types';
interface SubtitleOverlayProps {
  originalText?: string;
  translatedText?: string;
  targetLang: SupportedLanguage;
  bilingual: boolean;
  visible: boolean;
}
export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({ originalText, translatedText, targetLang, bilingual, visible }) => {
  const [text, setText] = useState({ originalText, translatedText });
  const [show, setShow] = useState(false);
  const latest = useRef({ originalText, translatedText });
  const pending = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    latest.current = { originalText, translatedText };
    // Coalesce word fragments without postponing updates indefinitely during continuous speech.
    if (!pending.current) pending.current = setTimeout(() => {
      setText(latest.current);
      pending.current = undefined;
    }, 100);
  }, [originalText, translatedText]);
  useEffect(() => () => clearTimeout(pending.current), []);
  useEffect(() => {
    if (!text.translatedText && !text.originalText) { setShow(false); return; }
    setShow(true);
    const timer = setTimeout(() => setShow(false), 5000);
    return () => clearTimeout(timer);
  }, [text]);
  if (!visible || (!text.translatedText && !text.originalText)) return null;
  return <div role="region" aria-label="Live translated subtitles"
    className={`fixed bottom-14 left-1/2 -translate-x-1/2 z-[2147483640] w-[min(85vw,52rem)] pointer-events-none transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}>
    <div className="bg-black/80 backdrop-blur-md border border-white/10 rounded-xl px-5 py-3 shadow-xl text-center space-y-1">
      {text.translatedText && <p dir={targetLang === 'fa' || targetLang === 'ar' ? 'rtl' : 'ltr'}
        className="text-lg md:text-xl leading-relaxed font-medium text-white line-clamp-2 min-h-[1.75rem]">{text.translatedText}</p>}
      {bilingual && text.originalText && <p dir="auto" className="text-xs md:text-sm leading-relaxed text-cyan-200/80 line-clamp-1">{text.originalText}</p>}
    </div>
  </div>;
};
