import { TranscriptWord, ChapterMarker } from '../types/edl';

interface RawChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * Converts raw Whisper chunks (either word-level or segment-level)
 * into a typed array of TranscriptWord objects with integer milliseconds.
 * Includes a hallucination guard to collapse repetitive phrase loops (>= 3 repeats).
 */
export function parseTranscriptionResult(rawOutput: {
  text?: string;
  chunks?: RawChunk[];
  isSegmentLevelFallback?: boolean;
}): TranscriptWord[] {
  const chunks = rawOutput.chunks || [];
  if (chunks.length === 0) {
    if (rawOutput.text && rawOutput.text.trim()) {
      // Fallback single chunk
      return parseSegmentChunksToWords([
        { text: rawOutput.text, timestamp: [0, 5] }
      ]);
    }
    return [];
  }

  // Detect if chunks are word-level (single word per chunk) or segment-level
  const isWordLevel = !rawOutput.isSegmentLevelFallback && chunks.every(
    (c) => c.text.trim().split(/\s+/).length <= 2
  );

  if (isWordLevel) {
    return parseWordLevelChunks(chunks);
  } else {
    return parseSegmentChunksToWords(chunks);
  }
}

/**
 * Hallucination Guard:
 * Whisper sometimes loops on background noise or silence.
 * Collapses phrases or segments that repeat 3 or more times consecutively.
 */
function filterHallucinations(chunks: RawChunk[]): RawChunk[] {
  const filtered: RawChunk[] = [];
  let repeatCount = 0;
  let lastNormText = '';

  for (const ch of chunks) {
    const norm = ch.text.trim().toLowerCase().replace(/[.,!?;:"]/g, '');
    if (norm && norm === lastNormText) {
      repeatCount++;
    } else {
      repeatCount = 1;
      lastNormText = norm;
    }

    if (repeatCount < 3) {
      filtered.push(ch);
    }
  }

  return filtered;
}

function parseWordLevelChunks(rawChunks: RawChunk[]): TranscriptWord[] {
  const chunks = filterHallucinations(rawChunks);
  const words: TranscriptWord[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const text = ch.text.trim();
    if (!text) continue;

    const startSec = ch.timestamp[0];
    let endSec = ch.timestamp[1];

    if (endSec === null || endSec === undefined || endSec <= startSec) {
      const nextChunk = chunks[i + 1];
      if (nextChunk && nextChunk.timestamp[0] > startSec) {
        endSec = nextChunk.timestamp[0];
      } else {
        endSec = startSec + 0.35;
      }
    }

    words.push({
      id: `tw_${i + 1}_${Math.random().toString(36).substring(2, 6)}`,
      word: text,
      sourceStartMs: Math.round(startSec * 1000),
      sourceEndMs: Math.round(endSec * 1000),
      confidence: 0.98,
      approximate: false
    });
  }

  return words;
}

function parseSegmentChunksToWords(rawChunks: RawChunk[]): TranscriptWord[] {
  const chunks = filterHallucinations(rawChunks);
  const words: TranscriptWord[] = [];
  let wordCounter = 1;

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const chunk = chunks[cIdx];
    const text = chunk.text.trim();
    if (!text) continue;

    const rawTokens = text.split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) continue;

    const startSec = chunk.timestamp[0];
    let endSec = chunk.timestamp[1];

    if (endSec === null || endSec === undefined || endSec <= startSec) {
      const nextChunk = chunks[cIdx + 1];
      if (nextChunk && nextChunk.timestamp[0] > startSec) {
        endSec = nextChunk.timestamp[0];
      } else {
        endSec = startSec + Math.max(1.0, rawTokens.length * 0.35);
      }
    }

    const durationSec = Math.max(0.1, endSec - startSec);
    const perWordSec = durationSec / rawTokens.length;

    for (let i = 0; i < rawTokens.length; i++) {
      const wStart = startSec + i * perWordSec;
      const wEnd = startSec + (i + 1) * perWordSec;

      words.push({
        id: `tw_${wordCounter++}_${Math.random().toString(36).substring(2, 6)}`,
        word: rawTokens[i],
        sourceStartMs: Math.round(wStart * 1000),
        sourceEndMs: Math.round(wEnd * 1000),
        confidence: 0.94,
        approximate: true
      });
    }
  }

  return words;
}

/**
 * Builds chapters from the transcript:
 * Starts a new chapter at a pause longer than 2 s between words, or at least every 20 s.
 * Titles each chapter with the first 4-6 words spoken in it.
 */
export function generateChaptersFromTranscript(words: TranscriptWord[]): ChapterMarker[] {
  if (words.length === 0) return [];

  const chapters: ChapterMarker[] = [];
  let curChapterWords: TranscriptWord[] = [];
  let curChapterStartMs = words[0].sourceStartMs;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    curChapterWords.push(w);
    const nextW = words[i + 1];

    const isPause = nextW && (nextW.sourceStartMs - w.sourceEndMs > 2000);
    const isMaxSpan = nextW && (nextW.sourceStartMs - curChapterStartMs >= 20000);
    const isLast = !nextW;

    if (isPause || isMaxSpan || isLast) {
      const titleSnippet = curChapterWords.slice(0, 6).map((x) => x.word).join(' ');
      const title = titleSnippet ? (titleSnippet.charAt(0).toUpperCase() + titleSnippet.slice(1)) : 'Segment';

      chapters.push({
        id: `chap_${chapters.length + 1}_${Date.now()}`,
        title,
        sourceMs: curChapterStartMs,
        isAutoGenerated: true
      });

      if (nextW) {
        curChapterWords = [];
        curChapterStartMs = nextW.sourceStartMs;
      }
    }
  }

  return chapters;
}

/**
 * Downloads transcript as a plain .txt file with timestamps
 */
export function downloadTranscriptAsTxt(words: TranscriptWord[], fileName = 'transcript.txt'): void {
  if (words.length === 0) return;

  const lines = words.map((w) => {
    const startSec = (w.sourceStartMs / 1000).toFixed(2);
    const endSec = (w.sourceEndMs / 1000).toFixed(2);
    return `[${startSec}s - ${endSec}s] ${w.word}`;
  });

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
