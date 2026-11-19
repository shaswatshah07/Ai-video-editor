import { extract16kHzMonoAudio } from './audioExtractor';
import { parseTranscriptionResult, generateChaptersFromTranscript } from './transcriptParser';
import { TranscriptWord, ChapterMarker, TimelineItem } from '../types/edl';

export type TranscriptionStatus =
  | 'idle'
  | 'extracting_audio'
  | 'downloading_model'
  | 'transcribing'
  | 'done'
  | 'error';

export interface TranscriptionProgressState {
  status: TranscriptionStatus;
  downloadPercent: number;
  currentDownloadFile: string;
  errorMessage: string | null;
}

// In-memory cache keyed by `${videoUrl}_${language}`
const transcriptCache = new Map<string, { words: TranscriptWord[]; chapters: ChapterMarker[] }>();

let workerInstance: Worker | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('../workers/transcriptionWorker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return workerInstance;
}

/**
 * Transcribes audio from a video blob or URL using the Web Worker with Whisper base.
 */
export async function transcribeVideoAudio(
  videoBlobOrUrl: Blob | string,
  language: 'english' | 'hindi' = 'english',
  onProgress?: (state: TranscriptionProgressState) => void
): Promise<{ words: TranscriptWord[]; chapters: ChapterMarker[] }> {
  const cacheKey = typeof videoBlobOrUrl === 'string'
    ? `${videoBlobOrUrl}_${language}`
    : `blob_${videoBlobOrUrl.size}_${language}`;

  if (transcriptCache.has(cacheKey)) {
    const cached = transcriptCache.get(cacheKey)!;
    if (onProgress) {
      onProgress({
        status: 'done',
        downloadPercent: 100,
        currentDownloadFile: '',
        errorMessage: null
      });
    }
    return cached;
  }

  // 1. Extract & resample audio to 16kHz mono Float32Array
  if (onProgress) {
    onProgress({
      status: 'extracting_audio',
      downloadPercent: 0,
      currentDownloadFile: 'Extracting audio track...',
      errorMessage: null
    });
  }

  const audioFloat32 = await extract16kHzMonoAudio(videoBlobOrUrl);

  // 2. Dispatch to dedicated Web Worker
  const worker = getWorker();

  return new Promise((resolve, reject) => {
    let resolved = false;

    const handleWorkerMessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'STATUS') {
        if (msg.status === 'loading_model') {
          if (onProgress) {
            onProgress({
              status: 'downloading_model',
              downloadPercent: 0,
              currentDownloadFile: 'Speech model (about 75 MB, downloads once)...',
              errorMessage: null
            });
          }
        } else if (msg.status === 'transcribing') {
          if (onProgress) {
            onProgress({
              status: 'transcribing',
              downloadPercent: 100,
              currentDownloadFile: 'Transcribing speech...',
              errorMessage: null
            });
          }
        }
      } else if (msg.type === 'DOWNLOAD_PROGRESS') {
        if (onProgress) {
          onProgress({
            status: 'downloading_model',
            downloadPercent: msg.progress ?? 0,
            currentDownloadFile: msg.file || 'weights',
            errorMessage: null
          });
        }
      } else if (msg.type === 'COMPLETE') {
        cleanup();
        try {
          const words = parseTranscriptionResult(msg.result);
          const chapters = generateChaptersFromTranscript(words);

          const resultPayload = { words, chapters };
          transcriptCache.set(cacheKey, resultPayload);

          if (onProgress) {
            onProgress({
              status: 'done',
              downloadPercent: 100,
              currentDownloadFile: '',
              errorMessage: null
            });
          }

          resolved = true;
          resolve(resultPayload);
        } catch (err: any) {
          cleanup();
          resolved = true;
          reject(err);
        }
      } else if (msg.type === 'ERROR') {
        cleanup();
        const errText = msg.error || 'Transcription failed.';
        if (onProgress) {
          onProgress({
            status: 'error',
            downloadPercent: 0,
            currentDownloadFile: '',
            errorMessage: errText
          });
        }
        resolved = true;
        reject(new Error(errText));
      }
    };

    const cleanup = () => {
      worker.removeEventListener('message', handleWorkerMessage);
    };

    worker.addEventListener('message', handleWorkerMessage);

    // Send audio buffer to worker (using transfer to avoid copy overhead)
    try {
      worker.postMessage(
        {
          type: 'TRANSCRIBE',
          audioData: audioFloat32,
          language
        },
        [audioFloat32.buffer]
      );
    } catch {
      // Fallback without transfer if browser buffer transfer fails
      worker.postMessage({
        type: 'TRANSCRIBE',
        audioData: audioFloat32,
        language
      });
    }

    // Safety timeout: 180 seconds
    setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error('Transcription timed out after 3 minutes.'));
      }
    }, 180000);
  });
}

/**
 * PART B: Suggest cutting non-speech stretches that volume detection misses (breathing, looking around).
 * For every ACTIVE source segment shorter than 3 s that has no transcript word whose midpoint falls inside it,
 * mark it SUGGESTED_SILENCE_CUT, labelled 'No speech detected (breath/ambient)'.
 */
export function suggestNonSpeechCuts(
  items: TimelineItem[],
  words: TranscriptWord[]
): { updatedItems: TimelineItem[]; count: number; totalDurationMs: number } {
  if (words.length === 0) {
    return { updatedItems: items, count: 0, totalDurationMs: 0 };
  }

  let count = 0;
  let totalDurationMs = 0;

  const updatedItems = items.map((item) => {
    if (item.status !== 'ACTIVE' || item.kind !== 'SOURCE_CLIP' || item.durationMs >= 3000) {
      return item;
    }

    // Check if any transcript word midpoint falls inside [sourceStartMs, sourceEndMs]
    const hasWord = words.some((w) => {
      const midpoint = (w.sourceStartMs + w.sourceEndMs) / 2;
      return midpoint >= item.sourceStartMs && midpoint <= item.sourceEndMs;
    });

    if (!hasWord) {
      count++;
      totalDurationMs += item.durationMs;
      return {
        ...item,
        status: 'SUGGESTED_SILENCE_CUT' as const,
        title: 'No speech detected (breath/ambient)'
      };
    }

    return item;
  });

  return { updatedItems, count, totalDurationMs };
}
