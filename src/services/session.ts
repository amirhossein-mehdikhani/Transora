import type { DubbingState, TranscriptItem } from '../types';

export const idleState = (): DubbingState => ({
  status: 'idle', audioLevel: 0, isDucking: false,
  stats: { latencyMs: 0, sentencesDubbed: 0, bytesProcessed: 0 },
});

export function chunkDuration(settings: { mode: string; audioBufferSizeMs: number }): number {
  const duration = Number.isFinite(settings.audioBufferSizeMs) ? settings.audioBufferSizeMs : 2500;
  return Math.max(1000, Math.min(settings.mode === 'meeting' ? 1500 : 8000, duration));
}

function srtTime(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')},${String(value % 1000).padStart(3, '0')}`;
}

export function exportSrt(items: TranscriptItem[], bilingual: boolean): string {
  // Historical entries have wall-clock times only and cannot be aligned reliably.
  return items.filter(item => Number.isFinite(item.startMs) && Number.isFinite(item.endMs))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item, index) => `${index + 1}\n${srtTime(item.startMs!)} --> ${srtTime(Math.max(item.startMs! + 1, item.endMs!))}\n${item.translatedText || item.originalText}${bilingual && item.kind !== 'transcription' ? `\n${item.originalText}` : ''}\n`)
    .join('\n');
}

// Keep streaming captions readable without truncating persisted transcripts or audio.
export function captionWindow(text: string, maxChars = 180): string {
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars);
  const boundary = tail.indexOf(' ');
  return '…' + (boundary >= 0 ? tail.slice(boundary + 1) : tail);
}
