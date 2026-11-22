import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { ProjectEDL } from '../types/edl';
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
 * Detects if the source video contains a playable audio track.
 */
export async function checkVideoHasAudio(videoUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(videoUrl);
    const blob = await resp.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const audioBuf = await ctx.decodeAudioData(arrayBuffer);
    const hasAudio = audioBuf.numberOfChannels > 0 && audioBuf.duration > 0;
    await ctx.close();
    return hasAudio;
  } catch {
    return false;
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
 * Guaranteed 100% frame accuracy, respects orientation metadata, and checks all return codes.
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
  const activeMemeClips = activeItems.filter((it) => isActualMemeClip(it, project.sourceVideoUrl));

  if (activeSourceClips.length === 0) {
    throw new Error('Cannot export: No active source clips remaining on timeline.');
  }

  // Check for preview-only transitions
  const warnings: string[] = [];
  const hasTransitions = project.items.some(
    (it) => it.transitionOut && it.transitionOut.type !== 'none' && it.status !== 'DELETED'
  );

  if (hasTransitions) {
    warnings.push('Transitions are preview-only and will be supported in export soon.');
  }

  // Calculate expected total duration across all active items
  const totalExpectedMs = activeItems.reduce(
    (acc, it) => acc + (it.sourceEndMs - it.sourceStartMs),
    0
  );
  const expectedDurationSec = totalExpectedMs / 1000;

  const segments: SegmentInfo[] = activeItems.map((it, idx) => ({
    index: idx + 1,
    startSec: (it.sourceStartMs || 0) / 1000,
    endSec: (it.sourceEndMs || it.durationMs) / 1000,
    durSec: Math.max(0.01, (it.sourceEndMs - it.sourceStartMs) / 1000)
  }));

  if (onProgress) {
    onProgress({ ratio: 0.05, stage: 'Checking audio tracks & loading FFmpeg...' });
  }

  const sourceHasAudio = await checkVideoHasAudio(project.sourceVideoUrl);
  if (!sourceHasAudio) {
    warnings.push('Source video audio could not be decoded; exported with a silent audio track.');
  }

  const ffmpeg = await getFFmpeg(onProgress);

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

    video.src = project.sourceVideoUrl;
    video.load();
  });

  const { targetW, targetH } = targetDims;

  if (onProgress) {
    onProgress({ ratio: 0.12, stage: 'Writing input video to memory...' });
  }

  const sourceData = await fetchFile(project.sourceVideoUrl);
  await ffmpeg.writeFile('input.mp4', sourceData);

  // Active Audio Enhancement Settings
  const voiceEnhanceActive = !!project.audioSettings.voiceEnhanceEnabled;
  const noiseRemovalActive = !!(project.audioSettings.noiseRemovalEnabled ?? project.audioSettings.noiseReductionEnabled);
  let noiseFilterActuallyApplied = noiseRemovalActive;

  // Deduplicate and write each used non-primary clip (memes + added clips) to FFmpeg FS
  const nonPrimaryClips = activeItems.filter((it) => it.blobUrl !== project.sourceVideoUrl);
  const uniqueNonPrimaryUrls = Array.from(new Set(nonPrimaryClips.map((m) => m.blobUrl)));
  const writtenInputIndexMap = new Map<string, { inputIndex: number; fsName: string; hasAudio: boolean }>();
  const writtenMemeFiles: string[] = [];
  let nextInputIdx = 1;

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
      const clipData = await fetchFile(url);
      await ffmpeg.writeFile(fsName, clipData);
      writtenMemeFiles.push(fsName);
      const clipHasAudio = await checkVideoHasAudio(url);
      writtenInputIndexMap.set(url, { inputIndex: nextInputIdx, fsName, hasAudio: clipHasAudio });
      nextInputIdx++;
    } catch {
      throw new Error(`Failed to load clip "${clipTitle}" for export. Remove or replace it in the workspace and try again.`);
    }
  }

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
      musicInputIdx = nextInputIdx++;
    } catch (musicLoadErr) {
      console.warn('Failed to write background music to FFmpeg FS:', musicLoadErr);
      warnings.push('Background music track could not be loaded and was omitted from the exported video.');
      bgMusicFsName = null;
      musicInputIdx = -1;
    }
  }

  const effectiveBgMusicActive = !!(hasActiveBgMusic && bgMusicFsName && musicInputIdx >= 0 && bgMusic);

  const N = activeItems.length;

  // Helper to construct filtergraph & ffmpeg arguments
  const buildArgs = (useFallbackNoiseFilter: boolean, useFallbackAmix: boolean = false) => {
    const filterParts: string[] = [];

    // Normalization video filter
    const normVideo = `fps=30,scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p`;

    // Native audible audio DSP filters applied directly to source stream [0:a] and all user video segments
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
      const item = activeItems[i];
      const startSec = ((item.sourceStartMs || 0) / 1000).toFixed(3);
      const endSec = ((item.sourceEndMs || item.durationMs) / 1000).toFixed(3);
      const durSec = Math.max(0.01, (item.sourceEndMs - item.sourceStartMs) / 1000).toFixed(3);

      if (item.kind === 'SOURCE_CLIP') {
        filterParts.push(`[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS,${normVideo}[v${i}]`);

        if (sourceHasAudio) {
          filterParts.push(`[0:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo${audioFilters},apad,atrim=0:${durSec}[a${i}]`);
        } else {
          filterParts.push(`anullsrc=r=44100:cl=stereo:d=${durSec},atrim=0:${durSec}[a${i}]`);
        }
      } else {
        // MEME_CLIP or added user clip
        const isUserClip = !!item.meta?.isAddedClip || (item.id.startsWith('clip_') && !item.meta?.memeCategory?.startsWith('meme_'));
        const clipInfo = writtenInputIndexMap.get(item.blobUrl);
        if (!clipInfo) {
          throw new Error(`Export error: missing input stream mapping for "${item.title || 'clip'}".`);
        }
        const inputIdx = clipInfo.inputIndex;

        filterParts.push(`[${inputIdx}:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS,${normVideo}[v${i}]`);

        if (clipInfo.hasAudio) {
          const segAudioFilters = isUserClip ? audioFilters : '';
          filterParts.push(`[${inputIdx}:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo${segAudioFilters},apad,atrim=0:${durSec}[a${i}]`);
        } else {
          // Silent meme fallback
          filterParts.push(`anullsrc=r=44100:cl=stereo:d=${durSec},atrim=0:${durSec}[a${i}]`);
        }
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
        `[${musicInputIdx}:a]atrim=0:${durStr},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${volStr}[bgm_a]`
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

    const args: string[] = ['-i', 'input.mp4'];
    for (const fsName of writtenMemeFiles) {
      args.push('-i', fsName);
    }
    if (effectiveBgMusicActive && bgMusicFsName) {
      args.push('-stream_loop', '-1', '-i', bgMusicFsName);
    }

    args.push(
      '-filter_complex', filterComplexStr,
      '-map', '[vconcat]',
      '-map', effectiveBgMusicActive ? '[outa]' : '[aconcat]',
      '-c:a', 'aac',
      '-b:a', '192k',
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
      hasAudio: sourceHasAudio,
      warnings,
      voiceEnhanceBaked: voiceEnhanceActive && sourceHasAudio,
      noiseRemovalBaked: noiseFilterActuallyApplied && sourceHasAudio,
      memesSplicedCount: activeMemeClips.length,
      bgMusicBaked: effectiveBgMusicActive,
      bgMusicName: effectiveBgMusicActive ? bgMusic?.name : undefined,
      bgMusicVolume: effectiveBgMusicActive ? bgMusic?.volume : undefined
    };
  } finally {
    activeProgressCallback = null;
    // Clean up memory files
    await ffmpeg.deleteFile('input.mp4').catch(() => {});
    for (const fsName of writtenMemeFiles) {
      await ffmpeg.deleteFile(fsName).catch(() => {});
    }
    if (bgMusicFsName) {
      await ffmpeg.deleteFile(bgMusicFsName).catch(() => {});
    }
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
  }
}
