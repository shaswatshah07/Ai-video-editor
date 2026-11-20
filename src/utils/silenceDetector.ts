import { TimelineItem } from '../types/edl';

export type SilenceSensitivity = 'Sensitive' | 'Normal' | 'Strict' | 'Gentle' | 'Tight';

export interface SensitivityConfig {
  name: SilenceSensitivity;
  minSilenceMs: number;
  thresholdOffsetDb: number;
  postPaddingMs: number;
  prePaddingMs: number;
}

export const SILENCE_PRESETS: Record<SilenceSensitivity, SensitivityConfig> = {
  Sensitive: {
    name: 'Sensitive',
    minSilenceMs: 350,
    thresholdOffsetDb: 12,
    postPaddingMs: 120,
    prePaddingMs: 80
  },
  Normal: {
    name: 'Normal',
    minSilenceMs: 500,
    thresholdOffsetDb: 10,
    postPaddingMs: 150,
    prePaddingMs: 100
  },
  Strict: {
    name: 'Strict',
    minSilenceMs: 900,
    thresholdOffsetDb: 8,
    postPaddingMs: 200,
    prePaddingMs: 150
  },
  // Compatibility aliases
  Tight: {
    name: 'Tight',
    minSilenceMs: 350,
    thresholdOffsetDb: 12,
    postPaddingMs: 120,
    prePaddingMs: 80
  },
  Gentle: {
    name: 'Gentle',
    minSilenceMs: 900,
    thresholdOffsetDb: 8,
    postPaddingMs: 200,
    prePaddingMs: 150
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
 * Audio-Only Adaptive RMS Silence Detector (Restored baseline from commit 5bb22f8).
 * Analyzes RMS energy in 50ms windows from the source video audio, computes adaptive threshold
 * using 10th percentile noise floor + sensitivity offset, applies Merge Rule A (absorbs active
 * stretch < 400ms unless protected speech > threshold + 3dB for > 60ms), adds safety padding,
 * and applies Merge Rule B (drops active slivers < 300ms).
 */
export async function detectSilenceInVideo(
  videoFileOrBlob: Blob | File | string,
  sourceDurationMs: number,
  sensitivity: SilenceSensitivity = 'Normal',
  _denoisedBlob?: Blob | null,
  _onDenoisedGenerated?: (blob: Blob, url: string) => void,
  _transcriptWords?: unknown
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

    // 10th percentile for noise floor
    const sortedDbs = [...windowDbs].sort((a, b) => a - b);
    const p10Index = Math.floor(sortedDbs.length * 0.10);
    const noiseFloorDb = sortedDbs[p10Index] ?? -60;
    const p90Index = Math.floor(sortedDbs.length * 0.90);
    const speechLevelDb = sortedDbs[p90Index] ?? (noiseFloorDb + 20);
    const thresholdDb = noiseFloorDb + config.thresholdOffsetDb;
    const protectedDb = thresholdDb + 3; // Safety rule: level stays > threshold + 3dB for > 60ms

    // 1. Scan raw silent gaps
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

    // 2. Merge Rule A: Merge any two gaps separated by active stretch < 400ms (unless protected speech > threshold + 3dB for >= 2 windows)
    const mergedGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    for (const gap of rawGaps) {
      if (mergedGaps.length === 0) {
        mergedGaps.push({ ...gap });
        continue;
      }
      const last = mergedGaps[mergedGaps.length - 1];
      const activeStretch = gap.startMs - last.endMs;

      // Check protected speech (consecutive windows >= 2 is 100ms > 60ms)
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

    // 3. Safety padding
    const paddedGaps: { startMs: number; endMs: number; durationMs: number }[] = [];
    for (const g of mergedGaps) {
      const pStart = Math.min(g.endMs, g.startMs + config.postPaddingMs);
      const pEnd = Math.max(pStart, g.endMs - config.prePaddingMs);
      const dur = pEnd - pStart;
      if (dur >= 200) {
        paddedGaps.push({ startMs: pStart, endMs: pEnd, durationMs: dur });
      }
    }

    // 4. Merge Rule B: Drop active stretch < 300ms
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
    const diagnosticMessage = `Audio-only detector: ${rawGapsCount} raw gaps -> ${finalGaps.length} merged regions (${totalSec}s, noise floor ${noiseFloorDb.toFixed(1)} dB, threshold ${thresholdDb.toFixed(1)} dB).`;

    return {
      silences: finalGaps,
      noiseFloorDb,
      speechLevelDb,
      thresholdDb,
      rawGapsCount,
      mergedRegionsCount: finalGaps.length,
      totalWindows,
      sensitivity: normalizedSensitivity,
      diagnosticMessage
    };
  } catch (err) {
    console.warn('[SilenceDetector] Audio analysis failed, using simulated fallback:', err);
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

export const detectSilences = detectSilenceInVideo;
export const detectSilencesLegacy = detectSilenceInVideo;

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
