import { TimelineItem } from '../types/edl';
import { generateDenoisedAudio } from './audioDenoiser';

export type SilenceSensitivity = 'Gentle' | 'Normal' | 'Tight';

export interface SensitivityConfig {
  name: SilenceSensitivity;
  minSilenceMs: number;
  sensitivityOffsetDb: number;
  thresholdOffsetDb?: number; // backwards compatibility
  postPaddingMs: number; // after-speech padding (starts silence + postPaddingMs)
  prePaddingMs: number;  // before-speech padding (ends silence - prePaddingMs)
}

export const SILENCE_PRESETS: Record<SilenceSensitivity, SensitivityConfig> = {
  Gentle: {
    name: 'Gentle',
    minSilenceMs: 700,
    sensitivityOffsetDb: -2.5,
    thresholdOffsetDb: -2.5,
    postPaddingMs: 200,
    prePaddingMs: 160
  },
  Normal: {
    name: 'Normal',
    minSilenceMs: 500,
    sensitivityOffsetDb: 0.0,
    thresholdOffsetDb: 0.0,
    postPaddingMs: 180,
    prePaddingMs: 150
  },
  Tight: {
    name: 'Tight',
    minSilenceMs: 350,
    sensitivityOffsetDb: 2.0,
    thresholdOffsetDb: 2.0,
    postPaddingMs: 150,
    prePaddingMs: 120
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
  diagnosticMessage?: string;
  warning?: string;
}

/**
 * Decodes audio from an uploaded video file, blob URL, or pre-denoised audio blob.
 * Pre-filters through a 300 Hz HPF + 3400 Hz LPF speech band via OfflineAudioContext.
 * Measures RMS in 50ms windows with 25ms hop (50% overlap).
 * Calculates adaptive bimodal valley threshold (speechLevel - 7 vs noiseFloor + valleyOffset).
 * Uses 100ms speech hangover hysteresis, safe gap merging (<150ms and below speechLevel - 3dB),
 * and +180ms/-150ms padding with sanity guardrails.
 */
export async function detectSilenceInVideo(
  videoFileOrBlob: Blob | File | string,
  sourceDurationMs: number,
  sensitivity: SilenceSensitivity = 'Normal',
  denoisedBlob?: Blob | null,
  onDenoisedGenerated?: (blob: Blob, url: string) => void
): Promise<SilenceDetectionResult> {
  const config = SILENCE_PRESETS[sensitivity] || SILENCE_PRESETS.Normal;

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
        sensitivity,
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

    // FIX 1: Run speech bandpass filter (300 Hz HPF + 3400 Hz LPF) via OfflineAudioContext
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

    // FIX 2: Frame analysis with 50ms window, 25ms hop (50% overlap)
    const windowSamples = Math.floor(sampleRate * 0.05); // 50ms
    const hopSamples = Math.floor(sampleRate * 0.025);   // 25ms
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
        sensitivity
      };
    }

    const frameDbs = new Float32Array(totalFrames);
    for (let f = 0; f < totalFrames; f++) {
      const start = f * hopSamples;
      let sumSq = 0;
      for (let i = 0; i < windowSamples; i++) {
        const s = speechBandSamples[start + i];
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / windowSamples);
      frameDbs[f] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    }

    // Percentiles: 10th percentile for noise floor, 80th percentile for speech level
    const sortedDbs = Array.from(frameDbs).sort((a, b) => a - b);
    const p10Index = Math.floor(sortedDbs.length * 0.10);
    const p80Index = Math.floor(sortedDbs.length * 0.80);

    const noiseFloorDb = sortedDbs[p10Index] ?? -60;
    const speechLevelDb = sortedDbs[p80Index] ?? -20;
    const dynamicRangeDb = speechLevelDb - noiseFloorDb;

    // Guardrail: if dynamicRangeDb < 4 dB, return 0 silences
    if (dynamicRangeDb < 4) {
      return {
        silences: [],
        noiseFloorDb,
        speechLevelDb,
        thresholdDb: speechLevelDb - 5,
        rawGapsCount: 0,
        mergedRegionsCount: 0,
        totalWindows: totalFrames,
        sensitivity,
        diagnosticMessage: `Uniform audio detected (dynamic range ${dynamicRangeDb.toFixed(1)} dB < 4 dB). No silences cut to protect audio.`,
        warning: `Audio levels are uniform (noise floor ${noiseFloorDb.toFixed(1)} dB, speech level ${speechLevelDb.toFixed(1)} dB). Pauses cannot be reliably separated without risking speech clipping.`
      };
    }

    // Bimodal valley threshold:
    const valleyOffset = Math.min(8, dynamicRangeDb * 0.32);
    const baseThresholdDb = Math.min(speechLevelDb - 7, noiseFloorDb + valleyOffset);
    const sensitivityOffset = config.sensitivityOffsetDb ?? (
      sensitivity === 'Tight' ? 2.0 : sensitivity === 'Gentle' ? -2.5 : 0.0
    );
    // Hard safety cap: threshold can NEVER be closer than 5 dB to the 80th percentile speech level
    const thresholdDb = Math.min(speechLevelDb - 5, baseThresholdDb + sensitivityOffset);

    // FIX 3.1: Speech Hangover (Hysteresis) - require 100ms consecutive sub-threshold frames
    const hopMs = 25;
    const hangoverFrames = Math.max(1, Math.round(100 / hopMs)); // 4 frames = 100ms
    const rawGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    let inSilence = false;
    let silenceStartFrame = 0;
    let consecutiveQuiet = 0;

    for (let f = 0; f < totalFrames; f++) {
      const isQuiet = frameDbs[f] < thresholdDb;
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

    const rawGapsCount = rawGaps.length;

    // FIX 3.2: Safe Gap Merging (DO NOT swallow short words)
    // Only merge two silence gaps if sound between them < 150ms AND peak dB < speechLevelDb - 3
    const mergedGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    for (const gap of rawGaps) {
      if (mergedGaps.length === 0) {
        mergedGaps.push({ ...gap });
        continue;
      }

      const last = mergedGaps[mergedGaps.length - 1];
      const soundBetweenMs = gap.startMs - last.endMs;

      const startFrame = Math.max(0, Math.floor(last.endMs / hopMs));
      const endFrame = Math.min(totalFrames, Math.ceil(gap.startMs / hopMs));
      let peakDbBetween = -120;
      for (let f = startFrame; f < endFrame; f++) {
        if (frameDbs[f] > peakDbBetween) {
          peakDbBetween = frameDbs[f];
        }
      }

      const canMerge = soundBetweenMs < 150 && peakDbBetween < (speechLevelDb - 3);

      if (canMerge) {
        last.endMs = gap.endMs;
        last.durationMs = last.endMs - last.startMs;
      } else {
        mergedGaps.push({ ...gap });
      }
    }

    // FIX 3.3: Padding & Minimum Duration (+180ms start, -150ms end)
    const finalSilences: DetectedSilence[] = [];
    for (const g of mergedGaps) {
      const pStart = g.startMs + config.postPaddingMs;
      const pEnd = g.endMs - config.prePaddingMs;
      const pDur = pEnd - pStart;

      if (pDur >= config.minSilenceMs) {
        const fStart = Math.max(0, Math.floor(pStart / hopMs));
        const fEnd = Math.min(totalFrames, Math.ceil(pEnd / hopMs));
        let sumRms = 0;
        let count = 0;
        for (let f = fStart; f < fEnd; f++) {
          sumRms += Math.pow(10, frameDbs[f] / 20);
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

    // FIX 3.4: Sanity Guardrail: total detected silences > 75% of duration while speechLevel > -35 dB
    const totalSilenceMs = finalSilences.reduce((acc, s) => acc + s.durationMs, 0);
    if (speechLevelDb > -35 && totalSilenceMs > sourceDurationMs * 0.75) {
      return {
        silences: [],
        noiseFloorDb,
        speechLevelDb,
        thresholdDb,
        rawGapsCount,
        mergedRegionsCount: 0,
        totalWindows: totalFrames,
        sensitivity,
        warning: "Silence detection rejected: too much active audio would be removed. Try 'Gentle' sensitivity.",
        diagnosticMessage: `False positive rejected: ${(totalSilenceMs / 1000).toFixed(1)}s (${((totalSilenceMs / sourceDurationMs) * 100).toFixed(0)}%) flagged as silence with speech level at ${speechLevelDb.toFixed(1)} dB.`
      };
    }

    return {
      silences: finalSilences,
      noiseFloorDb,
      speechLevelDb,
      thresholdDb,
      rawGapsCount,
      mergedRegionsCount: finalSilences.length,
      totalWindows: totalFrames,
      sensitivity,
      diagnosticMessage: `Detected ${finalSilences.length} pauses (${(totalSilenceMs / 1000).toFixed(1)}s total). Speech: ${speechLevelDb.toFixed(1)} dB, Noise: ${noiseFloorDb.toFixed(1)} dB, Threshold: ${thresholdDb.toFixed(1)} dB.`
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
      sensitivity,
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
 * Each amber block is labelled with its exact length in ms.
 */
export function injectSilenceCutsIntoTimeline(
  baseItems: TimelineItem[],
  silences: DetectedSilence[]
): TimelineItem[] {
  if (silences.length === 0) return baseItems;

  let currentItems = [...baseItems];

  for (const silence of silences) {
    const updated: TimelineItem[] = [];

    for (const item of currentItems) {
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

    currentItems = updated;
  }

  return currentItems;
}
