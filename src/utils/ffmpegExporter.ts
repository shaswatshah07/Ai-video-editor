import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { ProjectEDL, TimelineItem } from '../types/edl';
import { BgMusicTrack } from '../store/useEditorStore';
import { isActualMemeClip } from './timelineMath';

export interface RenderProgress {
  ratio: number; // 0 to 1
  stage: string;
}

export interface SegmentInfo {
  index: number;
  startSec: number;
  endSec: number;
  durSec: number;
}

export interface ExportResult {
  blob: Blob;
  blobUrl: string;
  expectedDurationSec: number;
  actualDurationSec: number;
  segments: SegmentInfo[];
  ffmpegArgs: string[];
  exitCode: number;
  fileSizeBytes: number;
  elapsedTimeMs: number;
  hasAudio: boolean;
  warnings: string[];
  voiceEnhanceBaked: boolean;
  noiseRemovalBaked: boolean;
  memesSplicedCount?: number;
  bgMusicBaked?: boolean;
  bgMusicName?: string;
  bgMusicVolume?: number;
}

let ffmpegInstance: FFmpeg | null = null;
const ffmpegLogs: string[] = [];
let activeProgressCallback: ((p: RenderProgress) => void) | null = null;
let lastReportedRatio = 0.30;

async function getFFmpeg(onProgress?: (p: RenderProgress) => void): Promise<FFmpeg> {
  if (onProgress) {
    activeProgressCallback = onProgress;
  }
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  const ffmpeg = new FFmpeg();
  ffmpegLogs.length = 0; // Reset logs

  ffmpeg.on('log', ({ message }) => {
    ffmpegLogs.push(message);
    if (ffmpegLogs.length > 60) ffmpegLogs.shift();
  });

  ffmpeg.on('progress', ({ progress }) => {
    if (activeProgressCallback) {
      const clamped = Math.max(0, Math.min(1, progress));
      // Map 0..1 to 0.30..0.94 monotonically
      const mapped = 0.30 + clamped * 0.64;
      lastReportedRatio = Math.max(lastReportedRatio, mapped);
      activeProgressCallback({
        ratio: lastReportedRatio,
        stage: `Re-encoding MP4 (${Math.round(clamped * 100)}%)...`
      });
    }
  });

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  try {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  } catch (err) {
    throw new Error(`Failed to load FFmpeg.wasm: ${(err as Error).message}`);
  }
}

/**
 * Safely encodes unencoded relative/HTTP URLs without double-encoding %20 or touching blob:/data: URLs.
 */
function toSafeFetchUrl(url: string): string {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  try {
    const decoded = decodeURI(url);
    return decoded === url ? encodeURI(url) : url;
  } catch {
    try {
      return encodeURI(url);
    } catch {
      return url;
    }
  }
}

/**
 * Fetches media bytes cleanly, rejecting HTTP errors or HTML fallback responses.
 */
async function fetchValidMediaBytes(url: string, label: string): Promise<Uint8Array> {
  const safeUrl = toSafeFetchUrl(url);
  if (safeUrl.startsWith('blob:') || safeUrl.startsWith('data:')) {
    const bytes = await fetchFile(safeUrl);
    if (!bytes || bytes.byteLength < 64) {
      throw new Error(`Loaded empty media bytes for "${label}".`);
    }
    return bytes;
  }

  const resp = await fetch(safeUrl);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} while loading "${label}".`);
  }
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(`Received HTML instead of media for "${label}".`);
  }
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength < 64) {
    throw new Error(`Media file "${label}" is empty or corrupted.`);
  }
  return bytes;
}

/**
 * Detects if the source video contains a playable audio track via Web Audio API.
 */
export async function checkVideoHasAudio(videoUrl: string): Promise<boolean> {
  let ctx: AudioContext | null = null;
  try {
    const safeUrl = toSafeFetchUrl(videoUrl);
    const resp = await fetch(safeUrl);
    if (!resp.ok) return false;
    const blob = await resp.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AudioCtx();
    const decodePromise = ctx.decodeAudioData(arrayBuffer);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('decodeAudioData timed out')), 5000)
    );
    const audioBuf = await Promise.race([decodePromise, timeoutPromise]);
    return audioBuf.numberOfChannels > 0 && audioBuf.duration > 0;
  } catch {
    return false;
  } finally {
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }
}

interface FFmpegStreamInfo {
  hasVideo: boolean;
  hasAudio: boolean;
  videoDurationSec: number | null;
  audioDurationSec: number | null;
  formatDurationSec: number | null;
  probeSucceeded: boolean;
}

/**
 * Probes an already-written file inside FFmpeg's virtual FS to determine exact
 * video/audio stream presence and playable durations without relying on Web Audio.
 */
async function probeMediaInFFmpeg(ffmpeg: FFmpeg, fsName: string): Promise<FFmpegStreamInfo> {
  const probeJsonPath = `_probe_${fsName.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`;
  const savedProgressCb = activeProgressCallback;
  activeProgressCallback = null;

  try {
    try {
      const code = await ffmpeg.ffprobe([
        '-v', 'error',
        '-show_entries', 'stream=codec_type,duration:format=duration',
        '-of', 'json',
        fsName,
        '-o', probeJsonPath
      ]);
      if (code === 0) {
        const raw = await ffmpeg.readFile(probeJsonPath);
        const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        const parsed = JSON.parse(text) as {
          streams?: Array<{ codec_type?: string; duration?: string | number }>;
          format?: { duration?: string | number };
        };
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        let hasVideo = false;
        let hasAudio = false;
        let videoDurationSec: number | null = null;
        let audioDurationSec: number | null = null;

        for (const s of streams) {
          const durVal = s.duration != null ? Number(s.duration) : NaN;
          const finiteDur = Number.isFinite(durVal) && durVal > 0 ? durVal : null;
          if (s.codec_type === 'video') {
            hasVideo = true;
            if (finiteDur !== null) {
              videoDurationSec = videoDurationSec === null ? finiteDur : Math.min(videoDurationSec, finiteDur);
            }
          } else if (s.codec_type === 'audio') {
            hasAudio = true;
            if (finiteDur !== null) {
              audioDurationSec = audioDurationSec === null ? finiteDur : Math.min(audioDurationSec, finiteDur);
            }
          }
        }

        const fmtDurVal = parsed.format?.duration != null ? Number(parsed.format.duration) : NaN;
        const formatDurationSec = Number.isFinite(fmtDurVal) && fmtDurVal > 0 ? fmtDurVal : null;

        if (hasVideo || hasAudio) {
          return {
            hasVideo,
            hasAudio,
            videoDurationSec,
            audioDurationSec,
            formatDurationSec,
            probeSucceeded: true
          };
        }
      }
    } catch {
      // Fallback to `ffmpeg -hide_banner -i` log inspection below
    } finally {
      await ffmpeg.deleteFile(probeJsonPath).catch(() => {});
    }

    const probeLogs: string[] = [];
    const onProbeLog = ({ message }: { message: string }) => {
      probeLogs.push(message);
    };
    ffmpeg.on('log', onProbeLog);
    try {
      await ffmpeg.exec(['-hide_banner', '-i', fsName]);
    } catch {
      // Expected exit code 1 because no output target is specified
    } finally {
      ffmpeg.off('log', onProbeLog);
    }

    const joined = probeLogs.join('\n');
    const sawInput = /Input\s+#\d+/i.test(joined);
    const hasVideo = probeLogs.some((line) => /Stream\s+#\d+:\d+.*Video:/i.test(line));
    const hasAudio = probeLogs.some((line) => /Stream\s+#\d+:\d+.*Audio:/i.test(line));
    let formatDurationSec: number | null = null;
    const durMatch = joined.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (durMatch) {
      const parsedDur = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
      if (Number.isFinite(parsedDur) && parsedDur > 0) {
        formatDurationSec = parsedDur;
      }
    }

    return {
      hasVideo,
      hasAudio,
      videoDurationSec: null,
      audioDurationSec: null,
      formatDurationSec,
      probeSucceeded: sawInput && (hasVideo || hasAudio)
    };
  } finally {
    activeProgressCallback = savedProgressCb;
  }
}

/**
 * Validates output video metadata against exact expected duration and decodability.
 */
export async function verifyRenderedVideo(
  blob: Blob,
  expectedDurationSec: number,
  expectedAudio: boolean
): Promise<{ valid: boolean; duration: number; hasAudio: boolean; driftMs: number; error?: string }> {
  if (blob.size <= 10000) {
    return {
      valid: false,
      duration: 0,
      hasAudio: false,
      driftMs: 0,
      error: 'Exported MP4 is empty or corrupted.'
    };
  }

  const tempUrl = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    let isCleanedUp = false;
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(tempUrl);
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({
        valid: false,
        duration: 0,
        hasAudio: false,
        driftMs: 0,
        error: 'Export verification timed out while decoding the output MP4.'
      });
    }, 15000);

    video.onloadedmetadata = async () => {
      const actualDuration = video.duration;
      const decodes = video.videoWidth > 0 && video.videoHeight > 0;

      if (!decodes || !Number.isFinite(actualDuration) || actualDuration <= 0) {
        cleanup();
        return resolve({
          valid: false,
          duration: Number.isFinite(actualDuration) ? actualDuration : 0,
          hasAudio: false,
          driftMs: 0,
          error: 'Exported MP4 has invalid or zero duration.'
        });
      }

      const diffMs = Math.round(Math.abs(actualDuration - expectedDurationSec) * 1000);

      if (expectedDurationSec > 0) {
        const toleranceSec = Math.max(1.0, expectedDurationSec * 0.05);
        if (Math.abs(actualDuration - expectedDurationSec) > toleranceSec) {
          cleanup();
          return resolve({
            valid: false,
            duration: actualDuration,
            hasAudio: false,
            driftMs: diffMs,
            error: `Duration mismatch: expected ${expectedDurationSec.toFixed(2)}s, got ${actualDuration.toFixed(2)}s.`
          });
        }
      }

      let outputAudioOk = true;
      if (expectedAudio) {
        try {
          const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx();
          const sampleBuffer = await blob.slice(0, 1024 * 1024).arrayBuffer();
          const decoded = await ctx.decodeAudioData(sampleBuffer);
          outputAudioOk = decoded.numberOfChannels > 0;
          await ctx.close();
        } catch {
          outputAudioOk = blob.size > 10000;
        }
      }

      cleanup();
      resolve({
        valid: true,
        duration: actualDuration,
        hasAudio: outputAudioOk,
        driftMs: diffMs
      });
    };

    video.onerror = () => {
      cleanup();
      resolve({
        valid: false,
        duration: 0,
        hasAudio: false,
        driftMs: 0,
        error: 'Browser could not decode the exported MP4.'
      });
    };

    video.src = tempUrl;
    video.load();
  });
}

/**
 * Re-encodes project video in ONE single ffmpeg pass using trim/atrim and concat filter.
 * Normalizes input PTS, FPS, pixel format, SAR, and timebase per segment to prevent freeze/silence on meme splices.
 */
export async function exportProjectVideo(
  project: ProjectEDL,
  onProgress?: (p: RenderProgress) => void,
  bgMusic?: BgMusicTrack | null
): Promise<ExportResult> {
  const startTime = performance.now();
  ffmpegLogs.length = 0; // Fresh log buffer for this export run
  activeProgressCallback = onProgress || null;
  lastReportedRatio = 0.30;

  // Active items (both SOURCE_CLIP and MEME_CLIP in chronological order)
  const activeItems = project.items.filter(
    (it) => it.status !== 'DELETED'
  );

  const activeSourceClips = activeItems.filter((it) => it.kind === 'SOURCE_CLIP' || it.meta?.isAddedClip);

  if (activeSourceClips.length === 0) {
    throw new Error('Cannot export: No active source clips remaining on timeline.');
  }

  // Warnings collection
  const warnings: string[] = [];

  if (onProgress) {
    onProgress({ ratio: 0.05, stage: 'Loading FFmpeg & checking media streams...' });
  }

  const ffmpeg = await getFFmpeg(onProgress);
  const safeSourceUrl = toSafeFetchUrl(project.sourceVideoUrl);

  // Measure source video dimensions to compute safe even-aligned target resolution
  const targetDims = await new Promise<{ targetW: number; targetH: number }>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    let isProbeDone = false;

    const cleanupProbe = () => {
      if (isProbeDone) return;
      isProbeDone = true;
      clearTimeout(probeTimeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const probeTimeout = setTimeout(() => {
      console.warn('Source dimension probe timed out after 10s; falling back to 1280x720.');
      cleanupProbe();
      resolve({ targetW: 1280, targetH: 720 });
    }, 10000);

    video.onloadedmetadata = () => {
      let w = video.videoWidth || 1280;
      let h = video.videoHeight || 720;
      cleanupProbe();
      const maxDim = Math.max(w, h);
      if (maxDim > 1280) {
        const scale = 1280 / maxDim;
        w = Math.round((w * scale) / 2) * 2;
        h = Math.round((h * scale) / 2) * 2;
      } else {
        w = Math.round(w / 2) * 2;
        h = Math.round(h / 2) * 2;
      }
      resolve({ targetW: Math.max(2, w), targetH: Math.max(2, h) });
    };

    video.onerror = () => {
      cleanupProbe();
      resolve({ targetW: 1280, targetH: 720 });
    };

    video.src = safeSourceUrl;
    video.load();
  });

  const { targetW, targetH } = targetDims;

  if (onProgress) {
    onProgress({ ratio: 0.12, stage: 'Writing input video to memory...' });
  }

  const sourceData = await fetchValidMediaBytes(project.sourceVideoUrl, project.sourceFileName || 'source video');
  await ffmpeg.writeFile('input.mp4', sourceData);

  const sourceProbe = await probeMediaInFFmpeg(ffmpeg, 'input.mp4');
  const sourceHasAudio = sourceProbe.probeSucceeded
    ? sourceProbe.hasAudio
    : await checkVideoHasAudio(project.sourceVideoUrl);
  if (!sourceHasAudio) {
    warnings.push('Source video audio stream could not be found; exported with a silent audio track.');
  }
  const sourceMaxDurSec =
    sourceProbe.videoDurationSec ??
    sourceProbe.formatDurationSec ??
    (project.sourceDurationMs > 0 ? project.sourceDurationMs / 1000 : null);

  // Active Audio Enhancement Settings
  const voiceEnhanceActive = !!project.audioSettings.voiceEnhanceEnabled;
  const noiseRemovalActive = !!(project.audioSettings.noiseRemovalEnabled ?? project.audioSettings.noiseReductionEnabled);
  let noiseFilterActuallyApplied = noiseRemovalActive;

  // Deduplicate and write each used non-primary clip (memes + added clips) strictly to FFmpeg FS
  const nonPrimaryClips = activeItems.filter((it) => it.blobUrl !== project.sourceVideoUrl);
  const uniqueNonPrimaryUrls = Array.from(new Set(nonPrimaryClips.map((m) => m.blobUrl)));

  interface WrittenClipInput {
    inputIndex: number;
    fsName: string;
    url: string;
    hasAudio: boolean;
    maxDurationSec: number | null;
  }

  const writtenInputFiles: WrittenClipInput[] = [];
  const writtenInputIndexMap = new Map<string, WrittenClipInput>();

  for (let mIdx = 0; mIdx < uniqueNonPrimaryUrls.length; mIdx++) {
    const url = uniqueNonPrimaryUrls[mIdx];
    const fsName = `clip_${mIdx}.mp4`;
    const firstItem = nonPrimaryClips.find((it) => it.blobUrl === url);
    const clipTitle = firstItem?.title || `Clip ${mIdx + 1}`;

    if (onProgress) {
      onProgress({
        ratio: 0.23 + (mIdx / Math.max(1, uniqueNonPrimaryUrls.length)) * 0.05,
        stage: `Loading clip "${clipTitle}" (${mIdx + 1}/${uniqueNonPrimaryUrls.length}) into memory...`
      });
    }

    try {
      const clipData = await fetchValidMediaBytes(url, clipTitle);
      await ffmpeg.writeFile(fsName, clipData);

      const clipProbe = await probeMediaInFFmpeg(ffmpeg, fsName);
      if (clipProbe.probeSucceeded && !clipProbe.hasVideo) {
        await ffmpeg.deleteFile(fsName).catch(() => {});
        warnings.push(`Clip "${clipTitle}" has no readable video stream and was skipped from export.`);
        continue;
      }

      if (!clipProbe.probeSucceeded) {
        await ffmpeg.deleteFile(fsName).catch(() => {});
        warnings.push(`Clip "${clipTitle}" could not be probed by FFmpeg and was skipped from export.`);
        continue;
      }

      const clipHasAudio = clipProbe.hasAudio;
      const maxDurationSec =
        clipProbe.videoDurationSec ??
        clipProbe.formatDurationSec ??
        (firstItem && firstItem.durationMs > 0 ? firstItem.durationMs / 1000 : null);

      const entry: WrittenClipInput = {
        inputIndex: 1 + writtenInputFiles.length,
        fsName,
        url,
        hasAudio: clipHasAudio,
        maxDurationSec
      };
      writtenInputFiles.push(entry);
      writtenInputIndexMap.set(url, entry);
    } catch (err) {
      await ffmpeg.deleteFile(fsName).catch(() => {});
      warnings.push(
        `Clip "${clipTitle}" failed to load (${(err as Error).message || 'fetch error'}) and was omitted from export.`
      );
    }
  }

  // Filter active items strictly to clips with valid loaded input streams (never substitute input 0!)
  const renderItems: TimelineItem[] = activeItems.filter((it) => {
    if (it.blobUrl === project.sourceVideoUrl) return true;
    return writtenInputIndexMap.has(it.blobUrl);
  });

  if (renderItems.length === 0) {
    throw new Error('Cannot export: No playable video clips remained after loading inputs.');
  }

  interface SegmentPlan {
    item: TimelineItem;
    inputIndex: number;
    hasAudio: boolean;
    applyDsp: boolean;
    startSec: number;
    endSec: number;
    segDur: number;
  }

  const segmentPlans: SegmentPlan[] = renderItems.map((item) => {
    const isPrimary = item.blobUrl === project.sourceVideoUrl;
    const clipInfo = isPrimary ? null : writtenInputIndexMap.get(item.blobUrl)!;
    const inputIndex = isPrimary ? 0 : clipInfo!.inputIndex;
    const hasAudio = isPrimary ? sourceHasAudio : clipInfo!.hasAudio;
    const isUserClip =
      !!item.meta?.isAddedClip ||
      (item.id.startsWith('clip_') && !item.meta?.memeCategory?.startsWith('meme_'));
    const applyDsp = isPrimary || isUserClip;
    const maxDurSec = isPrimary ? sourceMaxDurSec : clipInfo!.maxDurationSec;

    const fallbackDurSec =
      Number.isFinite(item.durationMs) && item.durationMs > 0
        ? item.durationMs / 1000
        : (maxDurSec ?? 1.0);

    const rawStartSec = Number.isFinite(item.sourceStartMs) ? Math.max(0, item.sourceStartMs / 1000) : 0;
    const rawEndValid =
      Number.isFinite(item.sourceEndMs) && item.sourceEndMs > (item.sourceStartMs || 0);
    const rawDurSec = Math.max(
      0.05,
      rawEndValid ? (item.sourceEndMs - (item.sourceStartMs || 0)) / 1000 : fallbackDurSec
    );

    let startSec: number;
    let endSec: number;

    if (isPrimary) {
      startSec =
        maxDurSec !== null
          ? Math.min(rawStartSec, Math.max(0, maxDurSec - 0.05))
          : rawStartSec;
      endSec =
        maxDurSec !== null
          ? Math.min(Math.max(startSec + 0.05, startSec + rawDurSec), maxDurSec)
          : Math.max(startSec + 0.05, startSec + rawDurSec);
    } else {
      // MEME_CLIP & USER_CLIP must always use source-relative timestamps (0..clipDur), never project timestamps
      if (maxDurSec !== null && maxDurSec > 0.05) {
        if (rawStartSec >= maxDurSec - 0.05) {
          startSec = 0;
          endSec = Math.max(0.05, Math.min(rawDurSec, maxDurSec));
        } else {
          startSec = rawStartSec;
          endSec = Math.min(startSec + rawDurSec, maxDurSec);
          if (endSec - startSec < 0.05) {
            startSec = Math.max(0, maxDurSec - Math.min(rawDurSec, maxDurSec));
            endSec = maxDurSec;
          }
        }
      } else {
        startSec = rawStartSec;
        endSec = startSec + rawDurSec;
      }
    }

    const segDur = Math.max(0.05, endSec - startSec);
    return {
      item,
      inputIndex,
      hasAudio,
      applyDsp,
      startSec,
      endSec,
      segDur
    };
  });

  const expectedDurationSec = segmentPlans.reduce((acc, p) => acc + p.segDur, 0);
  const segments: SegmentInfo[] = segmentPlans.map((p, idx) => ({
    index: idx + 1,
    startSec: p.startSec,
    endSec: p.endSec,
    durSec: p.segDur
  }));
  const actualSplicedMemesCount = renderItems.filter((it) =>
    isActualMemeClip(it, project.sourceVideoUrl)
  ).length;

  // Active Background Music check
  const hasActiveBgMusic = !!(bgMusic && !bgMusic.isMuted && bgMusic.volume > 0);
  let bgMusicFsName: string | null = null;
  let musicInputIdx = -1;

  if (hasActiveBgMusic && bgMusic) {
    const extMatch = bgMusic.file.name.match(/\.[a-zA-Z0-9]+$/);
    const musicExt = extMatch ? extMatch[0].toLowerCase() : '.mp3';
    const candidateFsName = `bg_music${musicExt}`;

    if (onProgress) {
      onProgress({ ratio: 0.28, stage: 'Loading background music track into memory...' });
    }
    try {
      const musicData = await fetchFile(bgMusic.file);
      await ffmpeg.writeFile(candidateFsName, musicData);
      bgMusicFsName = candidateFsName;
      musicInputIdx = 1 + writtenInputFiles.length;
    } catch (musicLoadErr) {
      console.warn('Failed to write background music to FFmpeg FS:', musicLoadErr);
      warnings.push('Background music track could not be loaded and was omitted from the exported video.');
      bgMusicFsName = null;
      musicInputIdx = -1;
    }
  }

  const effectiveBgMusicActive = !!(hasActiveBgMusic && bgMusicFsName && musicInputIdx >= 0 && bgMusic);
  const N = segmentPlans.length;

  // Helper to construct filtergraph & ffmpeg arguments
  const buildArgs = (useFallbackNoiseFilter: boolean, useFallbackAmix: boolean = false) => {
    const filterParts: string[] = [];

    // Uniform scale + letterbox/pillarbox pad + SAR=1 + yuv420p normalization
    const scaleAndPad = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p`;

    // Native audible audio DSP filters applied to primary source and added user clips
    let audioFilters = '';
    if (noiseRemovalActive) {
      audioFilters += useFallbackNoiseFilter
        ? ',highpass=f=180,highpass=f=180,lowpass=f=6200,agate=threshold=0.035:ratio=5:attack=15:release=180:range=0.05'
        : ',highpass=f=180,highpass=f=180,lowpass=f=6200,afftdn=nr=40:nf=-25:tn=1,agate=threshold=0.035:ratio=5:attack=15:release=180:range=0.05';
    }
    if (voiceEnhanceActive) {
      const hp = noiseRemovalActive ? '' : ',highpass=f=85';
      audioFilters += `${hp},equalizer=f=260:t=q:w=1.2:g=-3.5,equalizer=f=2800:t=q:w=1.0:g=4.5,acompressor=threshold=-16dB:ratio=3:attack=10:release=100:makeup=3.5,alimiter=limit=0.95`;
    }

    // Process each segment in chronological order
    for (let i = 0; i < N; i++) {
      const plan = segmentPlans[i];
      const sStr = plan.startSec.toFixed(3);
      const eStr = plan.endSec.toFixed(3);
      const durStr = plan.segDur.toFixed(3);

      // Dip-to-black Fade: clamped safely so d <= segDur / 2 and st >= 0
      const hasFadeOut =
        i < N - 1 &&
        Boolean(renderItems[i].transitionOut && renderItems[i].transitionOut.type && renderItems[i].transitionOut.type !== 'none');
      const hasFadeIn =
        i > 0 &&
        Boolean(renderItems[i - 1].transitionOut && renderItems[i - 1].transitionOut.type && renderItems[i - 1].transitionOut.type !== 'none');

      const fadeInDur = hasFadeIn ? Math.min(0.3, plan.segDur / 2) : 0;
      const fadeOutDur = hasFadeOut ? Math.min(0.3, plan.segDur / 2) : 0;

      let segFadeFilters = '';
      if (Number.isFinite(fadeInDur) && fadeInDur > 0.02) {
        segFadeFilters += `,fade=t=in:st=0:d=${fadeInDur.toFixed(3)}`;
      }
      if (Number.isFinite(fadeOutDur) && fadeOutDur > 0.02) {
        const fadeOutStart = Math.max(0, plan.segDur - fadeOutDur);
        if (Number.isFinite(fadeOutStart) && fadeOutStart >= 0) {
          segFadeFilters += `,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)}`;
        }
      }

      // Normalize input PTS BEFORE trim, reset PTS AFTER trim, unify fps=30, scale/pad, fade, and settb=AVTB
      filterParts.push(
        `[${plan.inputIndex}:v]setpts=PTS-STARTPTS,trim=start=${sStr}:end=${eStr},setpts=PTS-STARTPTS,fps=30,${scaleAndPad}${segFadeFilters},settb=AVTB[v${i}]`
      );

      if (plan.hasAudio) {
        const segAudioFilters = plan.applyDsp ? audioFilters : '';
        filterParts.push(
          `[${plan.inputIndex}:a]asetpts=PTS-STARTPTS,atrim=start=${sStr}:end=${eStr},asetpts=PTS-STARTPTS,aresample=44100:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${durStr},atrim=0:${durStr},asetpts=PTS-STARTPTS${segAudioFilters}[a${i}]`
        );
      } else {
        // Silent fallback used ONLY when FFmpeg probe genuinely confirmed zero audio streams
        filterParts.push(`anullsrc=r=44100:cl=stereo:d=${durStr},atrim=0:${durStr},asetpts=PTS-STARTPTS[a${i}]`);
      }
    }

    let concatInputs = '';
    for (let i = 0; i < N; i++) {
      concatInputs += `[v${i}][a${i}]`;
    }

    if (effectiveBgMusicActive) {
      filterParts.push(`${concatInputs}concat=n=${N}:v=1:a=1[vconcat][main_a]`);

      const durStr = expectedDurationSec.toFixed(3);
      const volStr = bgMusic!.volume.toFixed(3);

      // Loop and trim background music to match exact video duration
      filterParts.push(
        `[${musicInputIdx}:a]asetpts=PTS-STARTPTS,atrim=0:${durStr},asetpts=PTS-STARTPTS,aresample=44100:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${volStr}[bgm_a]`
      );

      // Mix dialogue/meme audio with background music
      const amixFilter = useFallbackAmix
        ? `amix=inputs=2:duration=first:dropout_transition=0,volume=1.8`
        : `amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95`;

      filterParts.push(`[main_a][bgm_a]${amixFilter}[outa]`);
    } else {
      filterParts.push(`${concatInputs}concat=n=${N}:v=1:a=1[vconcat][aconcat]`);
    }

    const filterComplexStr = filterParts.join(';');

    // Strictly build -i flags in exact index order (0 = input.mp4, 1..K = writtenInputFiles, K+1 = bgMusic)
    const args: string[] = ['-i', 'input.mp4'];
    for (const wf of writtenInputFiles) {
      args.push('-i', wf.fsName);
    }
    if (effectiveBgMusicActive && bgMusicFsName) {
      args.push('-stream_loop', '-1', '-i', bgMusicFsName);
    }

    args.push(
      '-filter_complex', filterComplexStr,
      '-map', '[vconcat]',
      '-map', effectiveBgMusicActive ? '[outa]' : '[aconcat]',
      '-r', '30',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-t', expectedDurationSec.toFixed(3),
      'output.mp4'
    );

    return args;
  };

  try {
    ffmpegLogs.length = 0; // Reset log buffer right before encode pass
    let ffmpegArgs = buildArgs(false, false);

    if (onProgress) {
      onProgress({ ratio: 0.30, stage: 'Executing 1-pass filtergraph re-encode...' });
    }

    let exitCode = await ffmpeg.exec(ffmpegArgs);

    // Safety Guard: if FFmpeg fails, check for afftdn or amix issues and retry
    if (exitCode !== 0) {
      const logs = ffmpegLogs.join('\n').toLowerCase();
      let retryNeeded = false;
      let useFallbackNoise = false;
      let useFallbackAmix = false;

      if (noiseRemovalActive && (logs.includes('afftdn') || logs.includes('filter') || logs.includes('error'))) {
        retryNeeded = true;
        useFallbackNoise = true;
        noiseFilterActuallyApplied = false;
        warnings.push('Advanced noise filter was bypassed during export fallback; basic audio pass was used instead.');
      }
      if (effectiveBgMusicActive && (logs.includes('amix') || logs.includes('normalize') || logs.includes('alimiter'))) {
        retryNeeded = true;
        useFallbackAmix = true;
      }

      if (retryNeeded) {
        console.warn('FFmpeg filtergraph failed, retrying with fallback audio filter settings...');
        if (onProgress) {
          onProgress({ ratio: 0.30, stage: 'Retrying with fallback audio filter settings...' });
        }
        ffmpegArgs = buildArgs(useFallbackNoise, useFallbackAmix);
        exitCode = await ffmpeg.exec(ffmpegArgs);
      }
    }

    if (exitCode !== 0) {
      const last20 = ffmpegLogs.slice(-20).join('\n');
      throw new Error(`FFmpeg re-encode failed with exit code ${exitCode}:\n${last20}`);
    }

    const outputData = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([outputData as unknown as BlobPart], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    const elapsedTimeMs = Math.round(performance.now() - startTime);
    const anySegmentHasAudio = sourceHasAudio || segmentPlans.some((p) => p.hasAudio);

    return {
      blob,
      blobUrl,
      expectedDurationSec,
      actualDurationSec: 0, // will be populated after verification
      segments,
      ffmpegArgs,
      exitCode,
      fileSizeBytes: blob.size,
      elapsedTimeMs,
      hasAudio: anySegmentHasAudio,
      warnings,
      voiceEnhanceBaked: voiceEnhanceActive && anySegmentHasAudio,
      noiseRemovalBaked: noiseFilterActuallyApplied && anySegmentHasAudio,
      memesSplicedCount: actualSplicedMemesCount,
      bgMusicBaked: effectiveBgMusicActive,
      bgMusicName: effectiveBgMusicActive ? bgMusic?.name : undefined,
      bgMusicVolume: effectiveBgMusicActive ? bgMusic?.volume : undefined
    };
  } finally {
    activeProgressCallback = null;
    // Clean up memory files
    await ffmpeg.deleteFile('input.mp4').catch(() => {});
    for (const wf of writtenInputFiles) {
      await ffmpeg.deleteFile(wf.fsName).catch(() => {});
    }
    if (bgMusicFsName) {
      await ffmpeg.deleteFile(bgMusicFsName).catch(() => {});
    }
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
  }
}
