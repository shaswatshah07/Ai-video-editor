import { TimelineItem } from '../types/edl';
import { NonRealTimeVAD } from '@ricky0123/vad-web';

export type SilenceSensitivity = 'Sensitive' | 'Normal' | 'Strict' | 'Gentle' | 'Tight';

export interface SensitivityConfig {
  name: SilenceSensitivity;
  minSilenceMs: number;
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  postPaddingMs: number;
  prePaddingMs: number;
  // Legacy compatibility fields
  thresholdOffsetDb?: number;
  baseDropDb?: number;
  sensitivityOffsetDb?: number;
}

export const SILENCE_PRESETS: Record<SilenceSensitivity, SensitivityConfig> = {
  Sensitive: {
    name: 'Sensitive',
    minSilenceMs: 500,
    positiveSpeechThreshold: 0.35,
    negativeSpeechThreshold: 0.20,
    postPaddingMs: 150,
    prePaddingMs: 150,
    thresholdOffsetDb: 12,
    baseDropDb: 5.0
  },
  Normal: {
    name: 'Normal',
    minSilenceMs: 700,
    positiveSpeechThreshold: 0.45,
    negativeSpeechThreshold: 0.30,
    postPaddingMs: 150,
    prePaddingMs: 150,
    thresholdOffsetDb: 10,
    baseDropDb: 7.0
  },
  Strict: {
    name: 'Strict',
    minSilenceMs: 1000,
    positiveSpeechThreshold: 0.55,
    negativeSpeechThreshold: 0.40,
    postPaddingMs: 150,
    prePaddingMs: 150,
    thresholdOffsetDb: 8,
    baseDropDb: 9.5
  },
  Tight: {
    name: 'Tight',
    minSilenceMs: 500,
    positiveSpeechThreshold: 0.35,
    negativeSpeechThreshold: 0.20,
    postPaddingMs: 150,
    prePaddingMs: 150,
    thresholdOffsetDb: 12,
    baseDropDb: 5.0
  },
  Gentle: {
    name: 'Gentle',
    minSilenceMs: 1000,
    positiveSpeechThreshold: 0.55,
    negativeSpeechThreshold: 0.40,
    postPaddingMs: 150,
    prePaddingMs: 150,
    thresholdOffsetDb: 8,
    baseDropDb: 9.5
  }
};

export interface DetectedSilence {
  startMs: number;
  endMs: number;
  durationMs: number;
  avgRms: number;
}

export interface SilenceDetectionResult {
  silences: DetectedSilence[];
  noiseFloorDb: number;
  speechLevelDb: number;
  thresholdDb: number;
  rawGapsCount: number;
  mergedRegionsCount: number;
  totalWindows: number;
  sensitivity: SilenceSensitivity;
  isHybrid?: boolean;
  hallucinationsStrippedCount?: number;
  diagnosticMessage?: string;
  warning?: string;
}

export interface SilenceTranscriptWord {
  text?: string;
  word?: string;
  sourceStartMs: number;
  sourceEndMs: number;
}

const HALLUCINATION_PHRASES = [
  'thank you for watching',
  'thanks for watching',
  'thank you',
  'please subscribe',
  'subscribe',
  'subtitles by',
  'amara.org',
  '[music]',
  '(music)',
  '[blank_audio]',
  'blank audio',
  'bye-bye',
  'watching',
  'you'
];

/**
 * Resets any unaccepted SUGGESTED_SILENCE_CUT items back to ACTIVE
 * and coalesces adjacent active clips sharing contiguous boundaries.
 */
export function resetSuggestedSilences(items: TimelineItem[]): TimelineItem[] {
  const restored = items.map(it => {
    if (it.status === 'SUGGESTED_SILENCE_CUT') {
      return {
        ...it,
        status: 'ACTIVE' as const,
        title: 'Video Clip'
      };
    }
    return it;
  });

  const coalesced: TimelineItem[] = [];
  for (const it of restored) {
    if (coalesced.length === 0) {
      coalesced.push({ ...it });
      continue;
    }
    const prev = coalesced[coalesced.length - 1];
    if (
      prev.status === 'ACTIVE' &&
      it.status === 'ACTIVE' &&
      prev.kind === it.kind &&
      prev.blobUrl === it.blobUrl &&
      prev.sourceEndMs === it.sourceStartMs
    ) {
      prev.sourceEndMs = it.sourceEndMs;
      prev.durationMs = prev.sourceEndMs - prev.sourceStartMs;
      prev.projectEndMs = prev.projectStartMs + prev.durationMs;
    } else {
      coalesced.push({ ...it });
    }
  }
  return coalesced;
}

/**
 * Fallback baseline silence detector from commit 5bb22f8.
 * Analyzes RMS energy in 50ms windows, computes adaptive threshold,
 * applies merge rules, and enforces safety rule: never remove audio where level > threshold + 3dB for >60ms.
 */
export async function detectSilencesLegacy(
  videoFileOrBlob: Blob | File | string,
  sourceDurationMs: number,
  sensitivity: SilenceSensitivity = 'Normal'
): Promise<SilenceDetectionResult> {
  const normalizedSensitivity: SilenceSensitivity =
    sensitivity === 'Tight' ? 'Sensitive' : sensitivity === 'Gentle' ? 'Strict' : sensitivity;
  const config = SILENCE_PRESETS[normalizedSensitivity] || SILENCE_PRESETS.Normal;

  try {
    let blob: Blob;
    if (typeof videoFileOrBlob === 'string') {
      const resp = await fetch(videoFileOrBlob);
      blob = await resp.blob();
    } else {
      blob = videoFileOrBlob;
    }

    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtxClass();

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch {
      await audioCtx.close();
      const sim = generateSimulatedSilences(sourceDurationMs);
      return {
        silences: sim,
        noiseFloorDb: -50,
        speechLevelDb: -20,
        thresholdDb: -40,
        rawGapsCount: sim.length,
        mergedRegionsCount: sim.length,
        totalWindows: Math.floor(sourceDurationMs / 50),
        sensitivity: normalizedSensitivity
      };
    }

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const windowSamples = Math.floor(sampleRate * 0.05); // 50ms window
    const totalWindows = Math.floor(channelData.length / windowSamples);

    if (totalWindows === 0) {
      await audioCtx.close();
      return {
        silences: [],
        noiseFloorDb: -60,
        speechLevelDb: -20,
        thresholdDb: -50,
        rawGapsCount: 0,
        mergedRegionsCount: 0,
        totalWindows: 0,
        sensitivity: normalizedSensitivity
      };
    }

    const windowDbs: number[] = new Array(totalWindows);
    for (let w = 0; w < totalWindows; w++) {
      let sumSq = 0;
      const start = w * windowSamples;
      for (let i = 0; i < windowSamples; i++) {
        const s = channelData[start + i];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / windowSamples);
      windowDbs[w] = rms > 1e-5 ? 20 * Math.log10(rms) : -100;
    }

    await audioCtx.close();

    const sortedDbs = [...windowDbs].sort((a, b) => a - b);
    const p10Index = Math.floor(sortedDbs.length * 0.10);
    const noiseFloorDb = sortedDbs[p10Index] ?? -60;
    const thresholdDb = noiseFloorDb + (config.thresholdOffsetDb ?? 10);
    const protectedDb = thresholdDb + 3;

    const rawGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    let inSilence = false;
    let silenceStartWindow = 0;

    for (let w = 0; w < totalWindows; w++) {
      if (windowDbs[w] < thresholdDb) {
        if (!inSilence) {
          inSilence = true;
          silenceStartWindow = w;
        }
      } else {
        if (inSilence) {
          inSilence = false;
          const sMs = Math.round(silenceStartWindow * 50);
          const eMs = Math.round(w * 50);
          if (eMs - sMs >= config.minSilenceMs) {
            rawGaps.push({ startMs: sMs, endMs: eMs, durationMs: eMs - sMs });
          }
        }
      }
    }

    if (inSilence) {
      const sMs = Math.round(silenceStartWindow * 50);
      const eMs = Math.round(totalWindows * 50);
      if (eMs - sMs >= config.minSilenceMs) {
        rawGaps.push({ startMs: sMs, endMs: eMs, durationMs: eMs - sMs });
      }
    }

    const rawGapsCount = rawGaps.length;

    // Merge Rule A: Merge any two gaps separated by active stretch < 400ms (unless protected speech)
    const mergedGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    for (const gap of rawGaps) {
      if (mergedGaps.length === 0) {
        mergedGaps.push({ ...gap });
        continue;
      }
      const last = mergedGaps[mergedGaps.length - 1];
      const activeStretch = gap.startMs - last.endMs;

      // Check protected speech
      const startW = Math.max(0, Math.floor(last.endMs / 50));
      const endW = Math.min(totalWindows, Math.ceil(gap.startMs / 50));
      let consecutive = 0;
      let isProtected = false;
      for (let w = startW; w < endW; w++) {
        if (windowDbs[w] >= protectedDb) {
          consecutive++;
          if (consecutive >= 2) { isProtected = true; break; }
        } else {
          consecutive = 0;
        }
      }

      if (activeStretch < 400 && !isProtected) {
        last.endMs = gap.endMs;
        last.durationMs = last.endMs - last.startMs;
      } else {
        mergedGaps.push({ ...gap });
      }
    }

    // Safety padding
    const paddedGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    for (const g of mergedGaps) {
      const pStart = Math.min(g.endMs, g.startMs + config.postPaddingMs);
      const pEnd = Math.max(pStart, g.endMs - config.prePaddingMs);
      const dur = pEnd - pStart;
      if (dur >= 200) {
        paddedGaps.push({ startMs: pStart, endMs: pEnd, durationMs: dur });
      }
    }

    // Merge Rule B: Drop active stretch < 300ms
    const finalGaps: DetectedSilence[] = [];
    for (let i = 0; i < paddedGaps.length; i++) {
      if (finalGaps.length === 0) {
        finalGaps.push({
          startMs: paddedGaps[i].startMs,
          endMs: paddedGaps[i].endMs,
          durationMs: paddedGaps[i].durationMs,
          avgRms: Math.pow(10, thresholdDb / 20)
        });
        continue;
      }

      const prev = finalGaps[finalGaps.length - 1];
      const curr = paddedGaps[i];
      const activeStretch = curr.startMs - prev.endMs;

      if (activeStretch < 300) {
        prev.endMs = curr.endMs;
        prev.durationMs = prev.endMs - prev.startMs;
      } else {
        finalGaps.push({
          startMs: curr.startMs,
          endMs: curr.endMs,
          durationMs: curr.durationMs,
          avgRms: Math.pow(10, thresholdDb / 20)
        });
      }
    }

    const totalSec = (finalGaps.reduce((a, b) => a + b.durationMs, 0) / 1000).toFixed(1);
    const legacyMsg = `Legacy detector: ${rawGapsCount} raw gaps, ${finalGaps.length} pauses (${totalSec} s)`;

    return {
      silences: finalGaps,
      noiseFloorDb,
      speechLevelDb: noiseFloorDb + 20,
      thresholdDb,
      rawGapsCount,
      mergedRegionsCount: finalGaps.length,
      totalWindows,
      sensitivity: normalizedSensitivity,
      diagnosticMessage: legacyMsg
    };
  } catch (err) {
    console.warn('[SilenceDetector] Legacy detector failed, using simulated fallback:', err);
    const sim = generateSimulatedSilences(sourceDurationMs);
    return {
      silences: sim,
      noiseFloorDb: -50,
      speechLevelDb: -20,
      thresholdDb: -40,
      rawGapsCount: sim.length,
      mergedRegionsCount: sim.length,
      totalWindows: Math.floor(sourceDurationMs / 50),
      sensitivity: normalizedSensitivity,
      warning: 'Audio analysis error; loaded fallback simulated pauses.'
    };
  }
}

/**
 * Neural Speech Silence Detector:
 * Uses Silero VAD (via @ricky0123/vad-web) as the primary neural speech signal.
 * Combined with transcript veto (words can only shrink or cancel a pause, never create one)
 * and final safety gate on original audio.
 * Falls back to detectSilencesLegacy() if neural detector fails to initialize.
 */
export async function detectSilenceInVideo(
  videoFileOrBlob: Blob | File | string,
  sourceDurationMs: number,
  sensitivity: SilenceSensitivity = 'Normal',
  _denoisedBlob?: Blob | null,
  _onDenoisedGenerated?: (blob: Blob, url: string) => void,
  transcriptWords?: SilenceTranscriptWord[]
): Promise<SilenceDetectionResult> {
  const normalizedSensitivity: SilenceSensitivity =
    sensitivity === 'Tight' ? 'Sensitive' : sensitivity === 'Gentle' ? 'Strict' : sensitivity;
  const config = SILENCE_PRESETS[normalizedSensitivity] || SILENCE_PRESETS.Normal;

  try {
    let sourceBlob: Blob;
    if (typeof videoFileOrBlob === 'string') {
      const resp = await fetch(videoFileOrBlob);
      sourceBlob = await resp.blob();
    } else {
      sourceBlob = videoFileOrBlob;
    }

    const arrayBuffer = await sourceBlob.arrayBuffer();
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtxClass();

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch {
      await audioCtx.close();
      return detectSilencesLegacy(videoFileOrBlob, sourceDurationMs, normalizedSensitivity);
    }
    await audioCtx.close();

    // Resample / mix to 16,000 Hz mono Float32Array for Silero VAD
    const targetSampleRate = 16000;
    const targetLength = Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate));
    let samples16k: Float32Array;

    try {
      const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
      const srcNode = offlineCtx.createBufferSource();
      srcNode.buffer = audioBuffer;
      srcNode.connect(offlineCtx.destination);
      srcNode.start(0);
      const rendered = await offlineCtx.startRendering();
      samples16k = rendered.getChannelData(0);
    } catch {
      // Fallback simple mixdown & downsample
      const srcRate = audioBuffer.sampleRate;
      const ratio = targetSampleRate / srcRate;
      samples16k = new Float32Array(targetLength);
      const ch0 = audioBuffer.getChannelData(0);
      const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
      for (let i = 0; i < targetLength; i++) {
        const srcIdx = Math.min(ch0.length - 1, Math.floor(i / ratio));
        samples16k[i] = 0.5 * (ch0[srcIdx] + ch1[srcIdx]);
      }
    }

    const totalDurMs = Math.round((samples16k.length / targetSampleRate) * 1000);

    // STEP 1: Neural Speech Detector (Silero VAD)
    let myvad: NonRealTimeVAD;
    try {
      myvad = await NonRealTimeVAD.new({
        modelURL: '/vad/silero_vad_legacy.onnx',
        ortConfig: (ort: any) => {
          if (ort?.env?.wasm) {
            ort.env.wasm.wasmPaths = '/vad/';
            if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
              ort.env.wasm.numThreads = 1;
            }
          }
        },
        positiveSpeechThreshold: config.positiveSpeechThreshold,
        negativeSpeechThreshold: config.negativeSpeechThreshold,
        minSpeechMs: 80,
        redemptionMs: 300,
        preSpeechPadMs: 100
      });
    } catch (vadInitErr) {
      console.warn('[SilenceDetector] VAD initialization failed, falling back to legacy detector:', vadInitErr);
      return detectSilencesLegacy(videoFileOrBlob, sourceDurationMs, normalizedSensitivity);
    }

    const speechSegments: { startMs: number; endMs: number }[] = [];
    for await (const segment of myvad.run(samples16k, targetSampleRate)) {
      speechSegments.push({
        startMs: Math.round(segment.start),
        endMs: Math.round(segment.end)
      });
    }

    // If VAD produced no segments on a non-trivial file, fall back to legacy detector
    if (speechSegments.length === 0 && totalDurMs > 3000) {
      console.warn('[SilenceDetector] VAD found 0 speech segments, falling back to legacy detector.');
      return detectSilencesLegacy(videoFileOrBlob, sourceDurationMs, normalizedSensitivity);
    }

    // Candidate non-speech regions = intervals strictly BETWEEN speech segments
    const nonSpeechRegions: { startMs: number; endMs: number; dur: number }[] = [];
    for (let i = 0; i < speechSegments.length - 1; i++) {
      const sStart = speechSegments[i].endMs;
      const sEnd = speechSegments[i + 1].startMs;
      if (sEnd > sStart) {
        nonSpeechRegions.push({ startMs: sStart, endMs: sEnd, dur: sEnd - sStart });
      }
    }

    // Compute frame RMS for original audio (40ms window, 20ms hop = 640/320 samples at 16kHz)
    const winSamples = Math.floor(targetSampleRate * 0.04);
    const hopSamples = Math.floor(targetSampleRate * 0.02);
    const hopMs = 20;
    const numFrames = Math.max(0, Math.floor((samples16k.length - winSamples) / hopSamples) + 1);
    const frameDbs = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSamples;
      let sumSq = 0;
      for (let i = 0; i < winSamples; i++) {
        const s = samples16k[start + i];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / winSamples);
      frameDbs[f] = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
    }

    // Measure speech levels across confirmed speech segments
    const speechLevels: number[] = [];
    for (const seg of speechSegments) {
      const fStart = Math.max(0, Math.floor(seg.startMs / hopMs));
      const fEnd = Math.min(frameDbs.length - 1, Math.floor(seg.endMs / hopMs));
      for (let f = fStart; f <= fEnd; f++) {
        speechLevels.push(frameDbs[f]);
      }
    }
    speechLevels.sort((a, b) => a - b);
    const speechLevelDb = speechLevels.length > 0 ? speechLevels[Math.floor(speechLevels.length * 0.75)] : -25;
    const medianSpeechDb = speechLevels.length > 0 ? speechLevels[Math.floor(speechLevels.length * 0.50)] : -25;

    // STEP 2: Combine VAD + Transcript Veto
    const hasTranscript = Boolean(transcriptWords && transcriptWords.length >= 3);
    const effectiveMinLength = hasTranscript
      ? config.minSilenceMs
      : Math.max(1000, config.minSilenceMs);

    let candidates = nonSpeechRegions
      .filter(r => r.dur >= effectiveMinLength)
      .map(r => ({ startMs: r.startMs, endMs: r.endMs }));

    const afterVeto: { startMs: number; endMs: number }[] = [];
    let hallucinationsStrippedCount = 0;

    if (hasTranscript && transcriptWords) {
      const confirmedWords: SilenceTranscriptWord[] = [];
      for (const w of transcriptWords) {
        const text = (w.text || w.word || '').trim().toLowerCase();
        const isHallucination = HALLUCINATION_PHRASES.some(h => text === h || text.includes(h) || h.includes(text));

        const fStart = Math.max(0, Math.floor(w.sourceStartMs / hopMs));
        const fEnd = Math.min(frameDbs.length - 1, Math.floor(w.sourceEndMs / hopMs));
        const wDbs: number[] = [];
        for (let f = fStart; f <= fEnd; f++) wDbs.push(frameDbs[f]);
        wDbs.sort((a, b) => a - b);
        const wordMedianDb = wDbs.length > 0 ? wDbs[Math.floor(wDbs.length * 0.50)] : -99;

        // If >8dB below median speech level or matches known phrase, it's a hallucination
        if (wordMedianDb < (medianSpeechDb - 8) || isHallucination) {
          hallucinationsStrippedCount++;
          continue;
        }
        confirmedWords.push(w);
      }

      // Cut confirmed word intervals [w.start - 150, w.end + 150] OUT of candidates
      for (const cand of candidates) {
        let pieces = [{ startMs: cand.startMs, endMs: cand.endMs }];
        for (const w of confirmedWords) {
          const vStart = Math.max(0, w.sourceStartMs - 150);
          const vEnd = w.sourceEndMs + 150;
          const nextPieces: { startMs: number; endMs: number }[] = [];
          for (const piece of pieces) {
            if (vEnd <= piece.startMs || vStart >= piece.endMs) {
              nextPieces.push(piece);
            } else {
              if (vStart > piece.startMs) nextPieces.push({ startMs: piece.startMs, endMs: vStart });
              if (vEnd < piece.endMs) nextPieces.push({ startMs: vEnd, endMs: piece.endMs });
            }
          }
          pieces = nextPieces;
        }
        for (const p of pieces) {
          if (p.endMs - p.startMs >= effectiveMinLength) {
            afterVeto.push(p);
          }
        }
      }
    } else {
      afterVeto.push(...candidates);
    }

    // Breathing room padding: keep 150ms next to speech, never touch first/last 300ms of video
    const paddedCandidates: { startMs: number; endMs: number }[] = [];
    for (const cand of afterVeto) {
      const pStart = Math.max(300, cand.startMs + 150);
      const pEnd = Math.min(sourceDurationMs - 300, cand.endMs - 150);
      if (pEnd - pStart >= effectiveMinLength) {
        paddedCandidates.push({ startMs: pStart, endMs: pEnd });
      }
    }

    // STEP 3: Final Safety Gate on original audio
    // Drop or split if louder than (speech level - 6 dB) anywhere for >120ms
    const safetyGated: { startMs: number; endMs: number }[] = [];
    const maxLoudFrames = Math.round(120 / hopMs); // 6 frames = 120ms

    for (const cand of paddedCandidates) {
      const fStart = Math.max(0, Math.floor(cand.startMs / hopMs));
      const fEnd = Math.min(frameDbs.length - 1, Math.floor(cand.endMs / hopMs));

      // Compute pause median dB
      const pDbs: number[] = [];
      for (let f = fStart; f <= fEnd; f++) pDbs.push(frameDbs[f]);
      pDbs.sort((a, b) => a - b);
      const pauseMedianDb = pDbs.length > 0 ? pDbs[Math.floor(pDbs.length * 0.50)] : -60;
      const loudThresholdDb = Math.max(speechLevelDb - 6, pauseMedianDb + 3.0);

      let curQuietStart = cand.startMs;
      let consecutiveLoud = 0;
      let loudStartF = 0;

      for (let f = fStart; f <= fEnd; f++) {
        if (frameDbs[f] > loudThresholdDb) {
          if (consecutiveLoud === 0) loudStartF = f;
          consecutiveLoud++;
          if (consecutiveLoud > maxLoudFrames) {
            const quietEnd = Math.round(loudStartF * hopMs);
            if (quietEnd - curQuietStart >= effectiveMinLength) {
              safetyGated.push({ startMs: curQuietStart, endMs: quietEnd });
            }
            curQuietStart = Math.round((f + 1) * hopMs);
            consecutiveLoud = 0;
          }
        } else {
          consecutiveLoud = 0;
        }
      }
      if (cand.endMs - curQuietStart >= effectiveMinLength) {
        safetyGated.push({ startMs: curQuietStart, endMs: cand.endMs });
      }
    }

    // Merge pauses separated by <250ms and drop active slivers <300ms
    safetyGated.sort((a, b) => a.startMs - b.startMs);
    const merged: { startMs: number; endMs: number }[] = [];
    for (const p of safetyGated) {
      if (merged.length === 0) { merged.push({ ...p }); continue; }
      const last = merged[merged.length - 1];
      if (p.startMs - last.endMs < 250) last.endMs = Math.max(last.endMs, p.endMs);
      else merged.push({ ...p });
    }

    const finalIntervals: { startMs: number; endMs: number }[] = [];
    for (let i = 0; i < merged.length; i++) {
      if (finalIntervals.length === 0) { finalIntervals.push({ ...merged[i] }); continue; }
      const prev = finalIntervals[finalIntervals.length - 1];
      const curr = merged[i];
      if (curr.startMs - prev.endMs < 300) prev.endMs = curr.endMs;
      else finalIntervals.push({ ...curr });
    }

    const finalSilences: DetectedSilence[] = finalIntervals.map(p => ({
      startMs: p.startMs,
      endMs: p.endMs,
      durationMs: p.endMs - p.startMs,
      avgRms: Math.pow(10, (medianSpeechDb - 15) / 20)
    }));

    const totalSec = (finalSilences.reduce((a, b) => a + b.durationMs, 0) / 1000).toFixed(1);
    const logLine = `VAD speech segments: ${speechSegments.length} | non-speech regions: ${nonSpeechRegions.length} | after transcript veto: ${afterVeto.length} | after safety gate: ${finalSilences.length} pauses, total ${totalSec} s`;
    console.log(`[SilenceDetector] ${logLine}`);

    return {
      silences: finalSilences,
      noiseFloorDb: Math.round(medianSpeechDb - 20),
      speechLevelDb: Math.round(speechLevelDb),
      thresholdDb: Math.round(speechLevelDb - 6),
      rawGapsCount: nonSpeechRegions.length,
      mergedRegionsCount: finalSilences.length,
      totalWindows: numFrames,
      sensitivity: normalizedSensitivity,
      isHybrid: hasTranscript,
      hallucinationsStrippedCount,
      diagnosticMessage: logLine
    };
  } catch (err) {
    console.warn('[SilenceDetector] VAD pipeline threw an exception, falling back to legacy detector:', err);
    return detectSilencesLegacy(videoFileOrBlob, sourceDurationMs, normalizedSensitivity);
  }
}

/**
 * Fallback for synthetic demo video clips
 */
export function generateSimulatedSilences(totalDurationMs: number): DetectedSilence[] {
  if (totalDurationMs < 10000) return [];

  const silences: DetectedSilence[] = [];
  if (totalDurationMs >= 6000) {
    silences.push({
      startMs: 3800,
      endMs: 5100,
      durationMs: 1300,
      avgRms: 0.004
    });
  }
  if (totalDurationMs >= 16000) {
    silences.push({
      startMs: 11800,
      endMs: 13600,
      durationMs: 1800,
      avgRms: 0.003
    });
  }
  return silences;
}

/**
 * Splits existing timeline items into active speech segments and SUGGESTED_SILENCE_CUT items.
 * First resets any prior unaccepted SUGGESTED_SILENCE_CUT items to ACTIVE and coalesces them.
 * Each amber block is labelled with its exact length in ms.
 */
export function injectSilenceCutsIntoTimeline(
  baseItems: TimelineItem[],
  silences: DetectedSilence[]
): TimelineItem[] {
  // Re-run safety: Clear any previous unaccepted 'SUGGESTED_SILENCE_CUT' blocks back to 'ACTIVE'
  const currentItems = resetSuggestedSilences(baseItems);
  if (silences.length === 0) return currentItems;

  let activeItems = [...currentItems];

  for (const silence of silences) {
    const updated: TimelineItem[] = [];

    for (const item of activeItems) {
      if (item.status !== 'ACTIVE') {
        updated.push(item);
        continue;
      }

      if (silence.endMs <= item.sourceStartMs || silence.startMs >= item.sourceEndMs) {
        updated.push(item);
        continue;
      }

      const sStart = Math.max(item.sourceStartMs, silence.startMs);
      const sEnd = Math.min(item.sourceEndMs, silence.endMs);
      const gapDurMs = sEnd - sStart;

      // Left kept part
      if (sStart > item.sourceStartMs) {
        updated.push({
          ...item,
          id: `${item.id}_pre_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          sourceEndMs: sStart,
          durationMs: sStart - item.sourceStartMs,
          status: 'ACTIVE'
        });
      }

      // Middle silence suggestion item labelled with length in ms
      updated.push({
        ...item,
        id: `silence_${sStart}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: `Awkward Pause (${gapDurMs}ms)`,
        sourceStartMs: sStart,
        sourceEndMs: sEnd,
        durationMs: gapDurMs,
        status: 'SUGGESTED_SILENCE_CUT',
        meta: { silenceRms: silence.avgRms }
      });

      // Right kept part
      if (sEnd < item.sourceEndMs) {
        updated.push({
          ...item,
          id: `${item.id}_post_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          sourceStartMs: sEnd,
          durationMs: item.sourceEndMs - sEnd,
          status: 'ACTIVE'
        });
      }
    }

    activeItems = updated;
  }

  return activeItems;
}
