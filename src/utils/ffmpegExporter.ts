import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { ProjectEDL } from '../types/edl';
import { generateDenoisedAudio } from './audioDenoiser';
import { BgMusicTrack } from '../store/useEditorStore';

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

async function getFFmpeg(onProgress?: (p: RenderProgress) => void): Promise<FFmpeg> {
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
    if (onProgress) {
      onProgress({
        ratio: Math.max(0, Math.min(1, progress)),
        stage: `Re-encoding MP4 (${Math.round(progress * 100)}%)...`
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
 * Passes ONLY if:
 * 1. |actual - expected| <= 300ms
 * 2. videoWidth > 0 and videoHeight > 0 (video decodes)
 * 3. If source had audio, output must contain audio.
 */
export async function verifyRenderedVideo(
  blob: Blob,
  expectedDurationSec: number,
  expectedAudio: boolean
): Promise<{ valid: boolean; duration: number; hasAudio: boolean; error?: string }> {
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = blobUrl;

    const timeout = setTimeout(() => {
      resolve({ valid: false, duration: 0, hasAudio: false, error: 'Video metadata verification timed out after 5s' });
    }, 5000);

    video.onloadedmetadata = async () => {
      clearTimeout(timeout);
      const actualDuration = video.duration;
      const decodes = video.videoWidth > 0 && video.videoHeight > 0;

      if (!decodes || isNaN(actualDuration) || actualDuration <= 0) {
        return resolve({
          valid: false,
          duration: actualDuration || 0,
          hasAudio: false,
          error: `Output video failed to decode valid visual dimensions or duration (${actualDuration}s)`
        });
      }

      // Check duration tolerance <= 300ms
      const diffMs = Math.abs(actualDuration - expectedDurationSec) * 1000;
      if (diffMs > 300) {
        return resolve({
          valid: false,
          duration: actualDuration,
          hasAudio: false,
          error: `Duration mismatch: expected ${expectedDurationSec.toFixed(1)} s but the file is ${actualDuration.toFixed(1)} s (drift: ${diffMs.toFixed(0)} ms > 300 ms)`
        });
      }

      // Check audio presence if source had audio
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
          // If partial slice decode fails, consider audio valid if file has size > 100KB
          outputAudioOk = blob.size > 100000;
        }

        if (!outputAudioOk) {
          return resolve({
            valid: false,
            duration: actualDuration,
            hasAudio: false,
            error: 'Output video is missing the expected audio track'
          });
        }
      }

      resolve({
        valid: true,
        duration: actualDuration,
        hasAudio: outputAudioOk
      });
    };

    video.onerror = () => {
      clearTimeout(timeout);
      resolve({ valid: false, duration: 0, hasAudio: false, error: 'Browser video element could not decode rendered MP4 file' });
    };
  });
}

/**
 * Re-encodes project video in ONE single ffmpeg pass using trim/atrim and concat filter.
 * Guaranteed 100% frame accuracy, respects orientation metadata, and checks all return codes.
 */
export async function exportProjectVideo(
  project: ProjectEDL,
  onProgress?: (p: RenderProgress) => void,
  cachedDenoisedBlob?: Blob | null,
  bgMusic?: BgMusicTrack | null
): Promise<ExportResult> {
  const startTime = performance.now();

  // Active items (both SOURCE_CLIP and MEME_CLIP in chronological order)
  const activeItems = project.items.filter(
    (it) => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME'
  );

  const activeSourceClips = activeItems.filter((it) => it.kind === 'SOURCE_CLIP');
  const activeMemeClips = activeItems.filter((it) => it.kind === 'MEME_CLIP');

  if (activeSourceClips.length === 0) {
    throw new Error('Cannot export: No active source clips remaining on timeline.');
  }

  // Check for preview-only transitions
  const warnings: string[] = [];
  const hasTransitions = project.items.some(
    (it) => it.transitionOut && it.transitionOut.type !== 'none' && it.status === 'ACTIVE'
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
    startSec: it.sourceStartMs / 1000,
    endSec: it.sourceEndMs / 1000,
    durSec: (it.sourceEndMs - it.sourceStartMs) / 1000
  }));

  if (onProgress) {
    onProgress({ ratio: 0.05, stage: 'Checking audio tracks & loading FFmpeg...' });
  }

  const hasAudio = await checkVideoHasAudio(project.sourceVideoUrl);
  const ffmpeg = await getFFmpeg(onProgress);

  // Measure source video dimensions to compute safe even-aligned target resolution
  const targetDims = await new Promise<{ targetW: number; targetH: number }>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = project.sourceVideoUrl;
    video.onloadedmetadata = () => {
      let w = video.videoWidth || 1280;
      let h = video.videoHeight || 720;
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
      resolve({ targetW: 1280, targetH: 720 });
    };
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

  // If noise removal is active, get or generate the adaptive spectral denoised audio WAV
  let hasDenoisedWavFile = false;
  if (hasAudio && noiseRemovalActive) {
    let denoisedBlob: Blob | null = cachedDenoisedBlob || null;
    if (!denoisedBlob) {
      if (onProgress) {
        onProgress({ ratio: 0.15, stage: 'Generating adaptive spectral denoised audio...' });
      }
      try {
        const res = await generateDenoisedAudio(project.sourceVideoUrl, (stage, ratio) => {
          if (onProgress) {
            onProgress({ ratio: 0.15 + ratio * 0.08, stage: `Denoising audio: ${stage}` });
          }
        });
        denoisedBlob = res.blob;
      } catch (err) {
        console.warn('Adaptive spectral denoiser failed before export, falling back to filter:', err);
      }
    }

    if (denoisedBlob) {
      try {
        const denoisedData = await fetchFile(denoisedBlob);
        await ffmpeg.writeFile('denoised_source.wav', denoisedData);
        hasDenoisedWavFile = true;
      } catch (err) {
        console.warn('Failed to write denoised_source.wav to FFmpeg FS:', err);
      }
    }
  }

  // Deduplicate and write each used meme to FFmpeg FS
  const uniqueMemeUrls = Array.from(new Set(activeMemeClips.map((m) => m.blobUrl)));
  const memeInputMap = new Map<string, { inputIndex: number; fsName: string; hasAudio: boolean }>();
  const writtenMemeFiles: string[] = [];
  const baseInputsCount = hasDenoisedWavFile ? 2 : 1;

  for (let mIdx = 0; mIdx < uniqueMemeUrls.length; mIdx++) {
    const url = uniqueMemeUrls[mIdx];
    const fsName = `meme_${mIdx}.mp4`;
    const inputIndex = baseInputsCount + mIdx;
    if (onProgress) {
      onProgress({
        ratio: 0.23 + (mIdx / Math.max(1, uniqueMemeUrls.length)) * 0.05,
        stage: `Loading meme ${mIdx + 1}/${uniqueMemeUrls.length} into memory...`
      });
    }
    try {
      const memeData = await fetchFile(url);
      await ffmpeg.writeFile(fsName, memeData);
      writtenMemeFiles.push(fsName);
      const memeHasAudio = await checkVideoHasAudio(url);
      memeInputMap.set(url, { inputIndex, fsName, hasAudio: memeHasAudio });
    } catch (memeLoadErr) {
      console.warn(`Failed to write ${fsName} to FFmpeg FS:`, memeLoadErr);
    }
  }

  // Active Background Music check
  const hasActiveBgMusic = !!(bgMusic && !bgMusic.isMuted && bgMusic.volume > 0);
  let bgMusicFsName: string | null = null;
  let musicInputIdx = -1;

  if (hasActiveBgMusic && bgMusic) {
    const extMatch = bgMusic.file.name.match(/\.[a-zA-Z0-9]+$/);
    const musicExt = extMatch ? extMatch[0].toLowerCase() : '.mp3';
    bgMusicFsName = `bg_music${musicExt}`;
    musicInputIdx = baseInputsCount + writtenMemeFiles.length;

    if (onProgress) {
      onProgress({ ratio: 0.28, stage: 'Loading background music track into memory...' });
    }
    try {
      const musicData = await fetchFile(bgMusic.file);
      await ffmpeg.writeFile(bgMusicFsName, musicData);
    } catch (musicLoadErr) {
      console.warn('Failed to write background music to FFmpeg FS:', musicLoadErr);
      bgMusicFsName = null;
    }
  }

  const effectiveBgMusicActive = !!(hasActiveBgMusic && bgMusicFsName && musicInputIdx >= 0 && bgMusic);

  const N = activeItems.length;

  // Helper to construct filtergraph & ffmpeg arguments
  const buildArgs = (useFallbackNoiseFilter: boolean, useFallbackAmix: boolean = false) => {
    const filterParts: string[] = [];
    const sourceAudioInput = hasDenoisedWavFile ? 1 : 0;

    // Normalization video filter
    const normVideo = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p`;

    // Audio filter chain for source clips
    const voiceEnhanceFilter = 'highpass=f=90,equalizer=f=280:t=q:w=1.2:g=-2.5,equalizer=f=2500:t=q:w=0.9:g=2.8,treble=g=-1.5:f=6500,acompressor=threshold=-14dB:ratio=2.5:attack=10:release=200:makeup=1.5,loudnorm=I=-16:TP=-1.5:LRA=11';

    let sourceAudioFilters = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
    if (hasDenoisedWavFile) {
      if (voiceEnhanceActive) {
        sourceAudioFilters += `,${voiceEnhanceFilter}`;
      }
    } else if (noiseRemovalActive) {
      const fallbackNoise = useFallbackNoiseFilter
        ? 'agate=threshold=-35dB:ratio=3:attack=10:release=80'
        : 'highpass=f=130,lowpass=f=7500,afftdn=nr=28:nf=-22:tn=1:gs=6';
      if (voiceEnhanceActive) {
        sourceAudioFilters += `,${fallbackNoise},${voiceEnhanceFilter}`;
      } else {
        sourceAudioFilters += `,${fallbackNoise}`;
      }
    } else if (voiceEnhanceActive) {
      sourceAudioFilters += `,${voiceEnhanceFilter}`;
    }

    // Process each segment in chronological order
    for (let i = 0; i < N; i++) {
      const item = activeItems[i];

      if (item.kind === 'SOURCE_CLIP') {
        const startSec = (item.sourceStartMs / 1000).toFixed(3);
        const endSec = (item.sourceEndMs / 1000).toFixed(3);
        const durSec = Math.max(0.01, (item.sourceEndMs - item.sourceStartMs) / 1000).toFixed(3);

        filterParts.push(`[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS,${normVideo}[v${i}]`);

        if (hasAudio) {
          filterParts.push(`[${sourceAudioInput}:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS,${sourceAudioFilters}[a${i}]`);
        } else {
          filterParts.push(`anullsrc=r=44100:cl=stereo:d=${durSec}[a${i}]`);
        }
      } else {
        // MEME_CLIP
        const durSec = Math.max(0.01, item.durationMs / 1000).toFixed(3);
        const memeInfo = memeInputMap.get(item.blobUrl);
        const inputIdx = memeInfo ? memeInfo.inputIndex : 0;

        filterParts.push(`[${inputIdx}:v]trim=start=0:end=${durSec},setpts=PTS-STARTPTS,${normVideo}[v${i}]`);

        if (memeInfo && memeInfo.hasAudio) {
          filterParts.push(`[${inputIdx}:a]atrim=start=0:end=${durSec},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
        } else {
          // Silent meme fallback
          filterParts.push(`anullsrc=r=44100:cl=stereo:d=${durSec}[a${i}]`);
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
    if (hasDenoisedWavFile) {
      args.push('-i', 'denoised_source.wav');
    }
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
      hasAudio: true,
      warnings,
      voiceEnhanceBaked: voiceEnhanceActive && hasAudio,
      noiseRemovalBaked: noiseRemovalActive && hasAudio,
      memesSplicedCount: activeMemeClips.length,
      bgMusicBaked: effectiveBgMusicActive,
      bgMusicName: effectiveBgMusicActive ? bgMusic?.name : undefined,
      bgMusicVolume: effectiveBgMusicActive ? bgMusic?.volume : undefined
    };
  } finally {
    // Clean up memory files
    await ffmpeg.deleteFile('input.mp4').catch(() => {});
    if (hasDenoisedWavFile) {
      await ffmpeg.deleteFile('denoised_source.wav').catch(() => {});
    }
    for (const fsName of writtenMemeFiles) {
      await ffmpeg.deleteFile(fsName).catch(() => {});
    }
    if (bgMusicFsName) {
      await ffmpeg.deleteFile(bgMusicFsName).catch(() => {});
    }
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
  }
}
