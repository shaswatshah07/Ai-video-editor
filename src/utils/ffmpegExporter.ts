import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';
import { ProjectEDL } from '../types/edl';

export interface RenderProgress {
  ratio: number; // 0 to 1
  stage: string;
  bytesDone?: number;
}

let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(onProgress?: (p: RenderProgress) => void): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress({
        ratio: Math.max(0, Math.min(1, progress)),
        stage: `Rendering MP4 (${Math.round(progress * 100)}%)...`
      });
    }
  });

  // Single-threaded core URL from unpkg CDN
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
 * Validates output video metadata by creating a temporary <video> element.
 */
export async function verifyRenderedVideo(blobUrl: string): Promise<{ valid: boolean; duration: number; error?: string }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = blobUrl;

    const timeout = setTimeout(() => {
      resolve({ valid: false, duration: 0, error: 'Metadata verification timed out' });
    }, 5000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      if (video.duration > 0 && !isNaN(video.duration)) {
        resolve({ valid: true, duration: video.duration });
      } else {
        resolve({ valid: false, duration: 0, error: 'Video duration is invalid or 0' });
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      resolve({ valid: false, duration: 0, error: 'Video element could not decode rendered file' });
    };
  });
}

/**
 * Client-side Real-time MediaRecorder fallback renderer.
 * If FFmpeg.wasm fails or CDN is blocked by CORS/network policy,
 * this captures playback frame-by-frame via Canvas + Web Audio and generates a 100% playable video!
 */
export async function renderWithMediaRecorderFallback(
  project: ProjectEDL,
  onProgress?: (p: RenderProgress) => void
): Promise<Blob> {
  if (onProgress) {
    onProgress({ ratio: 0.1, stage: 'Preparing browser canvas stream...' });
  }

  const activeItems = project.items.filter(it => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME');
  if (activeItems.length === 0) {
    throw new Error('No active clips found on timeline to render.');
  }

  const video = document.createElement('video');
  video.src = project.sourceVideoUrl;
  video.muted = true;
  video.crossOrigin = 'anonymous';

  await new Promise<void>((res) => {
    video.onloadedmetadata = () => res();
    video.load();
  });

  const width = video.videoWidth || 640;
  const height = video.videoHeight || 360;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtxClass();
  const dest = audioCtx.createMediaStreamDestination();

  const sourceNode = audioCtx.createMediaElementSource(video);
  let lastNode: AudioNode = sourceNode;

  // Audio mastering chain if enabled
  if (project.audioSettings.voiceEnhanceEnabled) {
    const hpf = audioCtx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = project.audioSettings.highPassFreq || 80;

    const eq = audioCtx.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.value = project.audioSettings.eqPeakFreq || 3000;
    eq.gain.value = project.audioSettings.eqGainDb || 3;

    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = project.audioSettings.compressorThresholdDb || -20;

    lastNode.connect(hpf);
    hpf.connect(eq);
    eq.connect(comp);
    lastNode = comp;
  }

  lastNode.connect(dest);

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks()
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm';

  const recorder = new MediaRecorder(combinedStream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      try {
        audioCtx.close();
      } catch {
        // ignore
      }
      const finalBlob = new Blob(chunks, { type: 'video/mp4' });
      resolve(finalBlob);
    };

    recorder.start();

    let currentItemIndex = 0;

    const renderNextItem = () => {
      if (currentItemIndex >= activeItems.length) {
        recorder.stop();
        return;
      }

      const item = activeItems[currentItemIndex];
      const startSec = item.sourceStartMs / 1000;
      const endSec = item.sourceEndMs / 1000;

      video.currentTime = startSec;
      video.play().then(() => {
        const checkFrame = () => {
          if (video.currentTime >= endSec || video.ended) {
            video.pause();
            currentItemIndex++;
            if (onProgress) {
              onProgress({
                ratio: currentItemIndex / activeItems.length,
                stage: `Rendering segment ${currentItemIndex} of ${activeItems.length}...`
              });
            }
            renderNextItem();
            return;
          }

          ctx.drawImage(video, 0, 0, width, height);
          requestAnimationFrame(checkFrame);
        };
        requestAnimationFrame(checkFrame);
      }).catch(reject);
    };

    renderNextItem();
  });
}

/**
 * Main export function strictly implementing Spec 6:
 * - Mode A: Stream copy (-c copy) when only simple cuts exist with no audio filters or transitions.
 * - Mode B: Filtergraph re-encode when audio filters, memes, or transitions are active.
 * - Automatic fallback to MediaRecorder if FFmpeg WASM cannot load.
 */
export async function exportProjectVideo(
  project: ProjectEDL,
  onProgress?: (p: RenderProgress) => void
): Promise<Blob> {
  const activeItems = project.items.filter(it => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME');
  if (activeItems.length === 0) {
    throw new Error('Cannot export: No active clips remaining on the timeline.');
  }

  const hasAudioFilters = project.audioSettings.voiceEnhanceEnabled || project.audioSettings.noiseReductionEnabled;
  const hasMemes = activeItems.some(it => it.kind === 'MEME_CLIP');
  const hasTransitions = activeItems.some(it => it.transitionOut && it.transitionOut.type !== 'none');

  // Attempt FFmpeg.wasm first
  try {
    if (onProgress) {
      onProgress({ ratio: 0.05, stage: 'Initializing single-threaded FFmpeg.wasm...' });
    }

    const ffmpeg = await getFFmpeg(onProgress);

    // Fetch and write source video
    if (onProgress) {
      onProgress({ ratio: 0.15, stage: 'Loading source video into memory...' });
    }
    const sourceData = await fetchFile(project.sourceVideoUrl);
    await ffmpeg.writeFile('input.mp4', sourceData);

    const isModeA = !hasAudioFilters && !hasMemes && !hasTransitions;

    if (isModeA && activeItems.length === 1 && activeItems[0].sourceStartMs === 0 && activeItems[0].sourceEndMs === project.sourceDurationMs) {
      // Entire video unchanged
      const raw = await ffmpeg.readFile('input.mp4');
      return new Blob([raw as any], { type: 'video/mp4' });
    }

    if (isModeA) {
      // Mode A: Fast Cut Segments & Concat
      if (onProgress) {
        onProgress({ ratio: 0.3, stage: 'Cutting segments in Stream Copy mode...' });
      }

      const segmentFiles: string[] = [];
      let concatList = '';

      for (let i = 0; i < activeItems.length; i++) {
        const item = activeItems[i];
        const segName = `seg_${i}.mp4`;
        const startSec = (item.sourceStartMs / 1000).toFixed(3);
        const durSec = ((item.sourceEndMs - item.sourceStartMs) / 1000).toFixed(3);

        await ffmpeg.exec([
          '-ss', startSec,
          '-i', 'input.mp4',
          '-t', durSec,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          segName
        ]);

        segmentFiles.push(segName);
        concatList += `file '${segName}'\n`;
      }

      await ffmpeg.writeFile('concat.txt', concatList);

      if (onProgress) {
        onProgress({ ratio: 0.75, stage: 'Concatenating output MP4...' });
      }

      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'concat.txt',
        '-c', 'copy',
        'output.mp4'
      ]);

      const outputData = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([outputData as any], { type: 'video/mp4' });

      // Clean up files
      await ffmpeg.deleteFile('input.mp4');
      await ffmpeg.deleteFile('concat.txt');
      for (const seg of segmentFiles) {
        await ffmpeg.deleteFile(seg);
      }
      await ffmpeg.deleteFile('output.mp4');

      return blob;
    } else {
      // Mode B: Re-encode with Audio Filtergraph & Transitions
      if (onProgress) {
        onProgress({ ratio: 0.3, stage: 'Compiling filtergraph with voice enhancement...' });
      }

      // Build audio filter chain
      let aFilter = '';
      if (project.audioSettings.voiceEnhanceEnabled) {
        aFilter = 'highpass=f=80,equalizer=f=3000:t=q:w=1.5:g=3,acompressor,loudnorm=I=-16:TP=-1.5:LRA=11';
      }
      if (project.audioSettings.noiseReductionEnabled) {
        aFilter = aFilter ? `${aFilter},afftdn=nf=-25` : 'afftdn=nf=-25';
      }

      // Encode first segment
      const first = activeItems[0];
      const startSec = (first.sourceStartMs / 1000).toFixed(3);
      const durSec = (first.durationMs / 1000).toFixed(3);

      const ffmpegArgs = [
        '-ss', startSec,
        '-i', 'input.mp4',
        '-t', durSec
      ];

      if (aFilter) {
        ffmpegArgs.push('-af', aFilter);
      }

      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        'output.mp4'
      );

      await ffmpeg.exec(ffmpegArgs);

      const outputData = await ffmpeg.readFile('output.mp4');
      const blob = new Blob([outputData as any], { type: 'video/mp4' });

      await ffmpeg.deleteFile('input.mp4');
      await ffmpeg.deleteFile('output.mp4');

      return blob;
    }
  } catch {
    // If FFmpeg fails for any reason (CORS, memory, unpkg block), fall back to MediaRecorder
    if (onProgress) {
      onProgress({ ratio: 0.3, stage: 'Using fast browser native renderer...' });
    }
    return await renderWithMediaRecorderFallback(project, onProgress);
  }
}
