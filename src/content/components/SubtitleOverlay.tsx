import React, { useEffect, useState } from 'react';
import { SupportedLanguage } from '../../types';

interface SubtitleOverlayProps {
  originalText?: string;
  translatedText?: string;
  targetLang: SupportedLanguage;
  bilingual: boolean;
  visible: boolean;
}

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  originalText,
  translatedText,
  targetLang,
  bilingual,
  visible,
}) => {
  const [show, setShow] = useState(false);
  const isRTL = targetLang === 'fa' || targetLang === 'ar';

  useEffect(() => {
    if (translatedText || originalText) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
      }, 6500); // Fade out after 6.5s of silence
      return () => clearTimeout(timer);
    }
  }, [translatedText, originalText]);

  if (!visible || !show || (!translatedText && !originalText)) {
    return null;
  }

  return (
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[2147483640] max-w-[85vw] md:max-w-3xl pointer-events-none transition-all duration-300">
      <div className="bg-black/75 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-3.5 shadow-2xl flex flex-col items-center gap-1.5 text-center">
        {/* Main Dubbed / Translated Text */}
        {translatedText && (
          <p
            dir={isRTL ? 'rtl' : 'ltr'}
            className="text-lg md:text-xl font-medium tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
          >
            {translatedText}
          </p>
        )}

        {/* Secondary Original Text (Bilingual Option) */}
        {bilingual && originalText && (
          <p className="text-xs md:text-sm text-cyan-300/80 font-normal tracking-normal drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {originalText}
          </p>
        )}
      </div>
    </div>
  );
};

