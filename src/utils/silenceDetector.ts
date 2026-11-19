import { TimelineItem } from '../types/edl';
import { generateDenoisedAudio } from './audioDenoiser';

export type SilenceSensitivity = 'Sensitive' | 'Normal' | 'Strict' | 'Gentle' | 'Tight';

export interface SensitivityConfig {
  name: SilenceSensitivity;
  minSilenceMs: number;
  baseDropDb: number;
  sensitivityOffsetDb?: number;
  thresholdOffsetDb?: number; // backwards compatibility
  postPaddingMs: number; // after-speech padding (starts silence + postPaddingMs)
  prePaddingMs: number;  // before-speech padding (ends silence - prePaddingMs)
}

export const SILENCE_PRESETS: Record<SilenceSensitivity, SensitivityConfig> = {
  Sensitive: {
    name: 'Sensitive',
    minSilenceMs: 350,
    baseDropDb: 5.0,
    sensitivityOffsetDb: 2.0,
    thresholdOffsetDb: 2.0,
    postPaddingMs: 120,
    prePaddingMs: 100
  },
  Normal: {
    name: 'Normal',
    minSilenceMs: 500,
    baseDropDb: 7.0,
    sensitivityOffsetDb: 0.0,
    thresholdOffsetDb: 0.0,
    postPaddingMs: 120,
    prePaddingMs: 100
  },
  Strict: {
    name: 'Strict',
    minSilenceMs: 900,
    baseDropDb: 9.5,
    sensitivityOffsetDb: -2.5,
    thresholdOffsetDb: -2.5,
    postPaddingMs: 120,
    prePaddingMs: 100
  },
  // Backwards-compatibility aliases:
  Tight: {
    name: 'Tight',
    minSilenceMs: 350,
    baseDropDb: 5.0,
    sensitivityOffsetDb: 2.0,
    thresholdOffsetDb: 2.0,
    postPaddingMs: 120,
    prePaddingMs: 100
  },
  Gentle: {
    name: 'Gentle',
    minSilenceMs: 900,
    baseDropDb: 9.5,
    sensitivityOffsetDb: -2.5,
    thresholdOffsetDb: -2.5,
    postPaddingMs: 120,
    prePaddingMs: 100
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
  'bye-bye'
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
 * Decodes audio from an uploaded video file, blob URL, or pre-denoised audio blob.
 * When transcriptWords has >= 3 words, runs the 5-stage Hybrid Transcript + Audio Algorithm:
 *  1. Compute speech-band audio envelope (40ms window, 20ms hop, 5-frame median filter)
 *  2. Measure true speech loudness directly from verified words (median 50th percentile)
 *  3. Filter out Whisper hallucinations using audio confirmation
 *  4. Collect candidate pause windows (inter-word gaps + stretched words > 900ms)
 *  5. Audio-snapped verification, micro-spike bridging, and safe padding (+120ms / -100ms)
 *
 * If no transcript exists yet (< 3 words), falls back to speech-band audio-only detection
 * with a clear hint to generate a transcript first.
 */
export async function detectSilenceInVideo(
  videoFileOrBlob: Blob | File | string,
  sourceDurationMs: number,
  sensitivity: SilenceSensitivity = 'Normal',
  denoisedBlob?: Blob | null,
  onDenoisedGenerated?: (blob: Blob, url: string) => void,
  transcriptWords?: SilenceTranscriptWord[]
): Promise<SilenceDetectionResult> {
  const normalizedSensitivity: SilenceSensitivity =
    sensitivity === 'Tight' ? 'Sensitive' : sensitivity === 'Gentle' ? 'Strict' : sensitivity;
  const config = SILENCE_PRESETS[normalizedSensitivity] || SILENCE_PRESETS.Normal;

  try {
    let audioBlobToAnalyze: Blob;

    if (denoisedBlob) {
      audioBlobToAnalyze = denoisedBlob;
    } else {
      try {
        let sourceUrl: string;
        let shouldRevoke = false;
        if (typeof videoFileOrBlob === 'string') {
          sourceUrl = videoFileOrBlob;
        } else {
          sourceUrl = URL.createObjectURL(videoFileOrBlob);
          shouldRevoke = true;
        }
        const denoiseResult = await generateDenoisedAudio(sourceUrl);
        if (shouldRevoke) URL.revokeObjectURL(sourceUrl);
        audioBlobToAnalyze = denoiseResult.blob;
        onDenoisedGenerated?.(denoiseResult.blob, denoiseResult.url);
      } catch (denoiseErr) {
        console.warn('[SilenceDetector] Denoiser unavailable/failed, analyzing original audio:', denoiseErr);
        if (typeof videoFileOrBlob === 'string') {
          const resp = await fetch(videoFileOrBlob);
          audioBlobToAnalyze = await resp.blob();
        } else {
          audioBlobToAnalyze = videoFileOrBlob;
        }
      }
    }

    const arrayBuffer = await audioBlobToAnalyze.arrayBuffer();
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
        sensitivity: normalizedSensitivity,
        warning: 'Audio decode failed, loaded fallback simulated pauses.'
      };
    }
    await audioCtx.close();

    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;

    // Mix to mono Float32Array
    const monoSamples = new Float32Array(length);
    if (audioBuffer.numberOfChannels === 1) {
      monoSamples.set(audioBuffer.getChannelData(0));
    } else {
      const ch0 = audioBuffer.getChannelData(0);
      const ch1 = audioBuffer.getChannelData(1);
      for (let i = 0; i < length; i++) {
        monoSamples[i] = 0.5 * (ch0[i] + ch1[i]);
      }
    }

    // ── STAGE 1: Speech-band audio envelope (300 Hz HPF + 3400 Hz LPF, 40ms window, 20ms hop) ──
    let speechBandSamples: Float32Array;
    try {
      const offCtx = new OfflineAudioContext(1, length, sampleRate);
      const srcBuf = offCtx.createBuffer(1, length, sampleRate);
      srcBuf.getChannelData(0).set(monoSamples);
      const srcNode = offCtx.createBufferSource();
      srcNode.buffer = srcBuf;

      const hpf = offCtx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 300;
      hpf.Q.value = 0.7071;

      const lpf = offCtx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 3400;
      lpf.Q.value = 0.7071;

      srcNode.connect(hpf);
      hpf.connect(lpf);
      lpf.connect(offCtx.destination);
      srcNode.start(0);

      const filtered = await offCtx.startRendering();
      speechBandSamples = filtered.getChannelData(0);
    } catch (e) {
      console.warn('[SilenceDetector] Speech-band filtering failed, using raw mono:', e);
      speechBandSamples = monoSamples;
    }

    const windowSamples = Math.floor(sampleRate * 0.04); // 40ms window
    const hopSamples = Math.floor(sampleRate * 0.02);    // 20ms hop
    const totalFrames = Math.max(0, Math.floor((speechBandSamples.length - windowSamples) / hopSamples) + 1);

    if (totalFrames === 0) {
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

    // Raw frame dB clamped at -65 dB floor
    const rawFrameDbs = new Float32Array(totalFrames);
    for (let f = 0; f < totalFrames; f++) {
      const start = f * hopSamples;
      let sumSq = 0;
      for (let i = 0; i < windowSamples; i++) {
        const s = speechBandSamples[start + i];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / windowSamples);
      const db = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
      rawFrameDbs[f] = Math.max(-65, db);
    }

    // 5-frame median filter
    const smoothedDb = new Float32Array(totalFrames);
    for (let f = 0; f < totalFrames; f++) {
      const vals: number[] = [];
      for (let d = -2; d <= 2; d++) {
        const idx = Math.max(0, Math.min(totalFrames - 1, f + d));
        vals.push(rawFrameDbs[idx]);
      }
      vals.sort((a, b) => a - b);
      smoothedDb[f] = vals[2];
    }

    // ── CHECK FOR HYBRID MODE (Transcript with >= 3 words) ──
    const hasTranscript = Boolean(transcriptWords && transcriptWords.length >= 3);

    if (hasTranscript && transcriptWords) {
      // ═════════════════════════════════════════════════════════════════════
      // HYBRID TRANSCRIPT + AUDIO MODE
      // ═════════════════════════════════════════════════════════════════════

      // ── STAGE 2: Measure True Speech Loudness Directly From Verified Words ──
      const isCandidateHallucination = new Array(transcriptWords.length).fill(false);
      const candidatePhrases: { startIdx: number; endIdx: number; phrase: string; startMs: number; endMs: number }[] = [];

      for (let i = 0; i < transcriptWords.length; i++) {
        for (let len = 5; len >= 1; len--) {
          if (i + len > transcriptWords.length) continue;
          const slice = transcriptWords.slice(i, i + len);
          const joined = slice.map(w => (w.text || w.word || '').trim().toLowerCase()).join(' ');
          const clean = joined.replace(/[.,\/#!$%\^&\*;:{}=\-_`~?]/g, ' ').replace(/\s+/g, ' ').trim();

          const matched = HALLUCINATION_PHRASES.some(p => {
            const pClean = p.replace(/[.,\/#!$%\^&\*;:{}=\-_`~?]/g, ' ').replace(/\s+/g, ' ').trim();
            return joined === p || joined.includes(p) || clean === pClean || clean.includes(pClean);
          });

          if (matched) {
            for (let k = i; k < i + len; k++) {
              isCandidateHallucination[k] = true;
            }
            candidatePhrases.push({
              startIdx: i,
              endIdx: i + len - 1,
              phrase: joined,
              startMs: slice[0].sourceStartMs,
              endMs: slice[slice.length - 1].sourceEndMs
            });
            i += len - 1;
            break;
          }
        }
      }

      // Collect all audio frames falling inside non-hallucination transcript words
      const spokenFrames: number[] = [];
      for (let i = 0; i < transcriptWords.length; i++) {
        if (isCandidateHallucination[i]) continue;
        const w = transcriptWords[i];
        const fStart = Math.max(0, Math.floor(w.sourceStartMs / 20));
        const fEnd = Math.min(totalFrames - 1, Math.floor(w.sourceEndMs / 20));
        for (let f = fStart; f <= fEnd; f++) {
          spokenFrames.push(smoothedDb[f]);
        }
      }

      let trueSpeechDb: number;
      if (spokenFrames.length > 0) {
        spokenFrames.sort((a, b) => a - b);
        trueSpeechDb = spokenFrames[Math.floor(spokenFrames.length * 0.50)];
      } else {
        const allSorted = Array.from(smoothedDb).sort((a, b) => a - b);
        trueSpeechDb = allSorted[Math.floor(allSorted.length * 0.70)] ?? -20;
      }

      // Noise floor as 5th percentile of full track
      const allSorted = Array.from(smoothedDb).sort((a, b) => a - b);
      const noiseFloorDb = allSorted[Math.floor(allSorted.length * 0.05)] ?? -60;

      // ── STAGE 3: Filter Out Whisper Hallucinations Using Audio Confirmation ──
      const confirmedHallucinationIndices = new Set<number>();
      let hallucinationsStrippedCount = 0;

      for (const cp of candidatePhrases) {
        const fStart = Math.max(0, Math.floor(cp.startMs / 20));
        const fEnd = Math.min(totalFrames - 1, Math.floor(cp.endMs / 20));
        const phraseDbs: number[] = [];
        for (let f = fStart; f <= fEnd; f++) {
          phraseDbs.push(smoothedDb[f]);
        }
        phraseDbs.sort((a, b) => a - b);
        const phraseMedianDb = phraseDbs.length > 0
          ? phraseDbs[Math.floor(phraseDbs.length * 0.50)]
          : noiseFloorDb;

        // If phrase median is >= 4dB quieter than trueSpeechDb OR within 4dB of noiseFloorDb
        if (phraseMedianDb <= (trueSpeechDb - 4) || phraseMedianDb <= (noiseFloorDb + 4)) {
          hallucinationsStrippedCount++;
          for (let k = cp.startIdx; k <= cp.endIdx; k++) {
            confirmedHallucinationIndices.add(k);
          }
        }
      }

      // Exclude confirmed hallucinations from verified speech words
      const verifiedWords: SilenceTranscriptWord[] = [];
      for (let i = 0; i < transcriptWords.length; i++) {
        if (!confirmedHallucinationIndices.has(i)) {
          verifiedWords.push(transcriptWords[i]);
        }
      }
      verifiedWords.sort((a, b) => a.sourceStartMs - b.sourceStartMs);

      // ── STAGE 4: Collect Candidate Pause Windows ──
      interface CandidateGap {
        startMs: number;
        endMs: number;
      }
      const candidateGaps: CandidateGap[] = [];

      if (verifiedWords.length === 0) {
        candidateGaps.push({ startMs: 0, endMs: sourceDurationMs });
      } else {
        // Leading gap
        if (verifiedWords[0].sourceStartMs > 0) {
          candidateGaps.push({ startMs: 0, endMs: verifiedWords[0].sourceStartMs });
        }
        // Inter-word gaps
        for (let i = 0; i < verifiedWords.length - 1; i++) {
          const curr = verifiedWords[i];
          const next = verifiedWords[i + 1];
          if (next.sourceStartMs > curr.sourceEndMs) {
            candidateGaps.push({ startMs: curr.sourceEndMs, endMs: next.sourceStartMs });
          }
        }
        // Trailing gap
        const last = verifiedWords[verifiedWords.length - 1];
        if (sourceDurationMs > last.sourceEndMs) {
          candidateGaps.push({ startMs: last.sourceEndMs, endMs: sourceDurationMs });
        }
        // Stretched-word check (>900ms)
        for (const w of verifiedWords) {
          const dur = w.sourceEndMs - w.sourceStartMs;
          if (dur > 900) {
            candidateGaps.push({ startMs: w.sourceStartMs + 250, endMs: w.sourceEndMs });
          }
        }
      }

      // ── STAGE 5: Audio-Snapped Verification & Safe Padding ──
      const baseDrop = config.baseDropDb;
      let thresholdDb = Math.max(noiseFloorDb + 2.5, trueSpeechDb - baseDrop);
      if (thresholdDb > trueSpeechDb - 3.5) {
        thresholdDb = trueSpeechDb - 3.5;
      }

      const detectedRawIntervals: { startMs: number; endMs: number }[] = [];

      for (const gap of candidateGaps) {
        // Expand audio search window by ±250 ms at gap edges
        const searchStartMs = Math.max(0, gap.startMs - 250);
        const searchEndMs = Math.min(sourceDurationMs, gap.endMs + 250);

        const fStart = Math.max(0, Math.floor(searchStartMs / 20));
        const fEnd = Math.min(totalFrames - 1, Math.ceil(searchEndMs / 20));

        // Find contiguous runs where smoothedDb < thresholdDb
        const quietRuns: { startF: number; endF: number }[] = [];
        let inQuiet = false;
        let runStart = 0;

        for (let f = fStart; f <= fEnd; f++) {
          if (smoothedDb[f] < thresholdDb) {
            if (!inQuiet) {
              inQuiet = true;
              runStart = f;
            }
          } else {
            if (inQuiet) {
              quietRuns.push({ startF: runStart, endF: f - 1 });
              inQuiet = false;
            }
          }
        }
        if (inQuiet) {
          quietRuns.push({ startF: runStart, endF: fEnd });
        }

        // Bridge micro-spikes < 160 ms only if their peak stays below trueSpeechDb - 4
        const bridgedRuns: { startF: number; endF: number }[] = [];
        for (const run of quietRuns) {
          if (bridgedRuns.length === 0) {
            bridgedRuns.push({ ...run });
            continue;
          }
          const last = bridgedRuns[bridgedRuns.length - 1];
          const spikeFrames = run.startF - (last.endF + 1);
          const spikeMs = spikeFrames * 20;

          let peakSpikeDb = -100;
          for (let f = last.endF + 1; f < run.startF; f++) {
            if (smoothedDb[f] > peakSpikeDb) peakSpikeDb = smoothedDb[f];
          }

          if (spikeMs < 160 && peakSpikeDb < (trueSpeechDb - 4)) {
            last.endF = run.endF;
          } else {
            bridgedRuns.push({ ...run });
          }
        }

        // Apply speech-safe padding (+120 ms to start, -100 ms to end)
        for (const run of bridgedRuns) {
          const qStartMs = run.startF * 20;
          const qEndMs = (run.endF + 1) * 20;

          const pStart = qStartMs + 120;
          const pEnd = qEndMs - 100;
          const pDur = pEnd - pStart;

          if (pDur >= config.minSilenceMs) {
            detectedRawIntervals.push({ startMs: pStart, endMs: pEnd });
          }
        }
      }

      // Merge overlapping intervals
      detectedRawIntervals.sort((a, b) => a.startMs - b.startMs);
      const mergedSilences: DetectedSilence[] = [];

      for (const run of detectedRawIntervals) {
        if (mergedSilences.length === 0) {
          mergedSilences.push({
            startMs: run.startMs,
            endMs: run.endMs,
            durationMs: run.endMs - run.startMs,
            avgRms: 0
          });
          continue;
        }
        const last = mergedSilences[mergedSilences.length - 1];
        if (run.startMs <= last.endMs) {
          last.endMs = Math.max(last.endMs, run.endMs);
          last.durationMs = last.endMs - last.startMs;
        } else {
          mergedSilences.push({
            startMs: run.startMs,
            endMs: run.endMs,
            durationMs: run.endMs - run.startMs,
            avgRms: 0
          });
        }
      }

      // Compute average RMS for each final silence
      for (const s of mergedSilences) {
        const fStart = Math.max(0, Math.floor(s.startMs / 20));
        const fEnd = Math.min(totalFrames - 1, Math.ceil(s.endMs / 20));
        let sumRms = 0;
        let count = 0;
        for (let f = fStart; f <= fEnd; f++) {
          sumRms += Math.pow(10, smoothedDb[f] / 20);
          count++;
        }
        s.avgRms = count > 0 ? sumRms / count : Math.pow(10, thresholdDb / 20);
      }

      const totalSilenceSec = (mergedSilences.reduce((acc, s) => acc + s.durationMs, 0) / 1000).toFixed(1);
      const diagnosticMessage = `Hybrid Pause Detection (${normalizedSensitivity}): True Speech ${trueSpeechDb.toFixed(1)} dB | Floor ${noiseFloorDb.toFixed(1)} dB | Threshold ${thresholdDb.toFixed(1)} dB | Hallucinations stripped: ${hallucinationsStrippedCount} | Found ${mergedSilences.length} pause(s) (${totalSilenceSec} s)`;

      return {
        silences: mergedSilences,
        noiseFloorDb,
        speechLevelDb: trueSpeechDb,
        thresholdDb,
        rawGapsCount: detectedRawIntervals.length,
        mergedRegionsCount: mergedSilences.length,
        totalWindows: totalFrames,
        sensitivity: normalizedSensitivity,
        isHybrid: true,
        hallucinationsStrippedCount,
        diagnosticMessage
      };
    }

    // ═════════════════════════════════════════════════════════════════════
    // AUDIO-ONLY FALLBACK MODE (when no transcript has been generated)
    // ═════════════════════════════════════════════════════════════════════
    const sortedAll = Array.from(smoothedDb).sort((a, b) => a - b);
    const p10Index = Math.floor(sortedAll.length * 0.10);
    const p80Index = Math.floor(sortedAll.length * 0.80);

    const noiseFloorDb = sortedAll[p10Index] ?? -60;
    const speechLevelDb = sortedAll[p80Index] ?? -20;
    const dynamicRangeDb = speechLevelDb - noiseFloorDb;

    const valleyOffset = Math.min(8, dynamicRangeDb * 0.32);
    const baseThresholdDb = Math.min(speechLevelDb - 7, noiseFloorDb + valleyOffset);
    const sensitivityOffset = config.sensitivityOffsetDb ?? 0.0;
    const thresholdDb = Math.min(speechLevelDb - 5, baseThresholdDb + sensitivityOffset);

    // Audio-only hysteresis scan
    const hopMs = 20;
    const hangoverFrames = Math.max(1, Math.round(100 / hopMs)); // 100ms / 20ms = 5 frames
    const rawGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    let inSilence = false;
    let silenceStartFrame = 0;
    let consecutiveQuiet = 0;

    for (let f = 0; f < totalFrames; f++) {
      const isQuiet = smoothedDb[f] < thresholdDb;
      if (isQuiet) {
        consecutiveQuiet++;
        if (!inSilence && consecutiveQuiet >= hangoverFrames) {
          inSilence = true;
          silenceStartFrame = f - consecutiveQuiet + 1;
        }
      } else {
        if (inSilence) {
          const sMs = Math.round(silenceStartFrame * hopMs);
          const eMs = Math.round(f * hopMs);
          if (eMs - sMs >= config.minSilenceMs) {
            rawGaps.push({ startMs: sMs, endMs: eMs, durationMs: eMs - sMs });
          }
          inSilence = false;
        }
        consecutiveQuiet = 0;
      }
    }

    if (inSilence) {
      const sMs = Math.round(silenceStartFrame * hopMs);
      const eMs = Math.round(totalFrames * hopMs);
      if (eMs - sMs >= config.minSilenceMs) {
        rawGaps.push({ startMs: sMs, endMs: eMs, durationMs: eMs - sMs });
      }
    }

    // Safe gap merging (< 150ms and peak < speechLevel - 3)
    const mergedGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    for (const gap of rawGaps) {
      if (mergedGaps.length === 0) {
        mergedGaps.push({ ...gap });
        continue;
      }
      const last = mergedGaps[mergedGaps.length - 1];
      const soundBetweenMs = gap.startMs - last.endMs;

      const startFrame = Math.max(0, Math.floor(last.endMs / hopMs));
      const endFrame = Math.min(totalFrames - 1, Math.ceil(gap.startMs / hopMs));
      let peakDbBetween = -120;
      for (let f = startFrame; f <= endFrame; f++) {
        if (smoothedDb[f] > peakDbBetween) {
          peakDbBetween = smoothedDb[f];
        }
      }

      if (soundBetweenMs < 150 && peakDbBetween < (speechLevelDb - 3)) {
        last.endMs = gap.endMs;
        last.durationMs = last.endMs - last.startMs;
      } else {
        mergedGaps.push({ ...gap });
      }
    }

    // Apply safe padding (+120ms / -100ms)
    const finalSilences: DetectedSilence[] = [];
    for (const g of mergedGaps) {
      const pStart = g.startMs + config.postPaddingMs;
      const pEnd = g.endMs - config.prePaddingMs;
      const pDur = pEnd - pStart;

      if (pDur >= config.minSilenceMs) {
        const fStart = Math.max(0, Math.floor(pStart / hopMs));
        const fEnd = Math.min(totalFrames - 1, Math.ceil(pEnd / hopMs));
        let sumRms = 0;
        let count = 0;
        for (let f = fStart; f <= fEnd; f++) {
          sumRms += Math.pow(10, smoothedDb[f] / 20);
          count++;
        }
        const avgRms = count > 0 ? sumRms / count : Math.pow(10, thresholdDb / 20);

        finalSilences.push({
          startMs: pStart,
          endMs: pEnd,
          durationMs: pDur,
          avgRms
        });
      }
    }

    const totalSilenceSec = (finalSilences.reduce((acc, s) => acc + s.durationMs, 0) / 1000).toFixed(1);
    const hint = 'Audio-only mode used (tip: click Generate Transcript first for higher accuracy with fan/background noise).';
    const diagnosticMessage = `${hint} Found ${finalSilences.length} pause(s) (${totalSilenceSec} s | speech ${speechLevelDb.toFixed(1)} dB | floor ${noiseFloorDb.toFixed(1)} dB | threshold ${thresholdDb.toFixed(1)} dB)`;

    return {
      silences: finalSilences,
      noiseFloorDb,
      speechLevelDb,
      thresholdDb,
      rawGapsCount: rawGaps.length,
      mergedRegionsCount: finalSilences.length,
      totalWindows: totalFrames,
      sensitivity: normalizedSensitivity,
      isHybrid: false,
      diagnosticMessage,
      warning: finalSilences.length === 0 ? hint : undefined
    };
  } catch (err) {
    console.warn('[SilenceDetector] Audio processing failed, fallback to simulated silences:', err);
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
