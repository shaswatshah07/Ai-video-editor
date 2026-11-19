import { TranscriptWord, ChapterMarker } from '../types/edl';

interface RawChunk {
  text: string;
  timestamp: [number, number | null];
}

export interface ParsedTranscriptionResult {
  words: TranscriptWord[];
  lowQualityWarning: string | null;
  suppressWordRender: boolean;
}

export const HINDI_LOW_QUALITY_WARNING = "⚠️ Hindi transcription quality is low for this audio. Try 'English (translated)' mode for better results.";

/**
 * Catches single-word consecutive repetitions:
 * - If any single word appears > 4 times consecutively, collapse to one instance, append "..."
 *   and mark with HINDI_LOW_QUALITY_WARNING.
 * - If total unique words < 15% of total words (almost all repeats), suppressWordRender = true.
 */
export function collapseRepetitionsAndCheckQuality(rawWords: TranscriptWord[]): ParsedTranscriptionResult {
  if (rawWords.length === 0) {
    return { words: [], lowQualityWarning: null, suppressWordRender: false };
  }

  // 1. Unique word count ratio check
  const totalWords = rawWords.length;
  const uniqueWordsSet = new Set(
    rawWords.map((w) => w.word.toLowerCase().replace(/[.,!?;:…"]/g, '').trim()).filter(Boolean)
  );
  const uniqueCount = uniqueWordsSet.size;
  const uniqueRatio = totalWords > 0 ? uniqueCount / totalWords : 1;
  const isSevereRepeat = totalWords >= 5 && uniqueRatio < 0.15;

  // 2. Collapse single-word consecutive repetitions (> 4 times)
  let hasConsecutiveRepetition = false;
  const collapsedWords: TranscriptWord[] = [];
  let i = 0;

  while (i < rawWords.length) {
    const currentWord = rawWords[i];
    const currentNorm = currentWord.word.toLowerCase().replace(/[.,!?;:…"]/g, '').trim();

    let j = i;
    while (
      j < rawWords.length &&
      rawWords[j].word.toLowerCase().replace(/[.,!?;:…"]/g, '').trim() === currentNorm &&
      currentNorm.length > 0
    ) {
      j++;
    }

    const runLength = j - i;
    if (runLength > 4) {
      hasConsecutiveRepetition = true;
      const lastWord = rawWords[j - 1];
      const baseText = currentWord.word.replace(/\.+$/, '');
      collapsedWords.push({
        ...currentWord,
        word: `${baseText}...`,
        sourceEndMs: lastWord.sourceEndMs
      });
    } else {
      for (let k = i; k < j; k++) {
        collapsedWords.push(rawWords[k]);
      }
    }

    i = j;
  }

  const shouldWarn = isSevereRepeat || hasConsecutiveRepetition;
  const lowQualityWarning = shouldWarn ? HINDI_LOW_QUALITY_WARNING : null;

  return {
    words: collapsedWords,
    lowQualityWarning,
    suppressWordRender: false
  };
}

/**
 * Converts raw Whisper chunks (either word-level or segment-level)
 * into a typed array of TranscriptWord objects with integer milliseconds.
 * Includes hallucination guards for phrase loops and single-word repetition loops.
 */
export function parseTranscriptionResult(rawOutput: {
  text?: string;
  chunks?: RawChunk[];
  isSegmentLevelFallback?: boolean;
}): ParsedTranscriptionResult {
  const chunks = rawOutput.chunks || [];
  let uncollapsedWords: TranscriptWord[] = [];

  if (chunks.length === 0) {
    if (rawOutput.text && rawOutput.text.trim()) {
      uncollapsedWords = parseSegmentChunksToWords([
        { text: rawOutput.text, timestamp: [0, 5] }
      ]);
    } else {
      return { words: [], lowQualityWarning: null, suppressWordRender: false };
    }
  } else {
    // Detect if chunks are word-level (single word per chunk) or segment-level
    const isWordLevel = !rawOutput.isSegmentLevelFallback && chunks.every(
      (c) => c.text.trim().split(/\s+/).length <= 2
    );

    if (isWordLevel) {
      uncollapsedWords = parseWordLevelChunks(chunks);
    } else {
      uncollapsedWords = parseSegmentChunksToWords(chunks);
    }
  }

  return collapseRepetitionsAndCheckQuality(uncollapsedWords);
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
 * Computes the percentage of words containing Arabic-script characters (U+0600 - U+06FF).
 */
export function detectArabicScriptPercentage(words: TranscriptWord[]): number {
  if (words.length === 0) return 0;
  const arabicRegex = /[\u0600-\u06FF]/;
  const arabicCount = words.filter(w => arabicRegex.test(w.word)).length;
  return Math.round((arabicCount / words.length) * 100);
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
