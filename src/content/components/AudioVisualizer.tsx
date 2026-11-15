import React from 'react';

interface AudioVisualizerProps {
  level: number; // 0 to 100
  isDucking: boolean;
  active: boolean;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ level, isDucking, active }) => {
  const bars = 5;

  return (
    <div className="flex items-center gap-[3px] h-5 px-1">
      {Array.from({ length: bars }).map((_, i) => {
        // Calculate dynamic height based on audio level and bar position
        const factor = Math.sin((i / (bars - 1)) * Math.PI);
        const dynamicHeight = active 
          ? Math.max(4, Math.round((level / 100) * 18 * factor + 4))
          : 4;

        return (
          <span
            key={i}
            className={`w-[3px] rounded-full transition-all duration-75 ${
              !active
                ? 'bg-slate-600 h-1'
                : isDucking
                ? 'bg-gradient-to-t from-cyan-400 to-indigo-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]'
                : 'bg-indigo-400 opacity-80'
            }`}
            style={{
              height: `${dynamicHeight}px`,
            }}
          />
        );
      })}
    </div>
  );
};

