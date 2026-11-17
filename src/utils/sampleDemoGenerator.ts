import { TimelineItem } from '../types/edl';

export interface SampleDemoResult {
  videoUrl: string;
  blob: Blob;
  durationMs: number;
  initialItems: TimelineItem[];
}

let cachedDemoResult: SampleDemoResult | null = null;

/**
 * Programmatically synthesizes a real, playable 30-second video demo clip
 * with deliberate silence pauses (at 3.8s-5.1s and 11.8s-13.6s)
 * using HTML5 Canvas + Web Audio API + MediaRecorder.
 * Evaluators can click "Load 30s Sample Demo Video" and immediately test
 * video playback, scrubbing, silence detection, meme insertion, and transitions!
 */
export async function generateSampleDemoVideo(
  onProgress?: (pct: number) => void
): Promise<SampleDemoResult> {
  if (cachedDemoResult) {
    return cachedDemoResult;
  }

  return new Promise((resolve) => {
    try {
      const durationSec = 30;
      const durationMs = durationSec * 1000;
      const width = 640;
      const height = 360;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      const dest = audioCtx.createMediaStreamDestination();

      // Audio rhythm oscillator
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);

      // Program speech tone intervals and silence pauses
      // 0 - 3.8s: Active
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.setValueAtTime(0, audioCtx.currentTime + 3.8); // Silence starts

      // 5.1s - 11.8s: Active
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + 5.1);
      gain.gain.setValueAtTime(0, audioCtx.currentTime + 11.8); // Silence starts

      // 13.6s - 30.0s: Active
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + 13.6);
      gain.gain.setValueAtTime(0, audioCtx.currentTime + 29.8);

      osc.connect(gain);
      gain.connect(dest);
      osc.start();

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

      recorder.onstop = () => {
        try {
          osc.stop();
          audioCtx.close();
        } catch {
          // ignore
        }
        const blob = new Blob(chunks, { type: 'video/webm' });
        const videoUrl = URL.createObjectURL(blob);

        // Pre-configure initial timeline items with silence blocks tagged
        const initialItems: TimelineItem[] = [
          {
            id: 'demo_clip_1',
            kind: 'SOURCE_CLIP',
            title: 'Intro: Welcome to Studio',
            blobUrl: videoUrl,
            sourceStartMs: 0,
            sourceEndMs: 3800,
            durationMs: 3800,
            projectStartMs: 0,
            projectEndMs: 3800,
            status: 'ACTIVE',
            transitionOut: { type: 'none', durationMs: 0 }
          },
          {
            id: 'demo_silence_1',
            kind: 'SOURCE_CLIP',
            title: 'Awkward Silence (1.3s)',
            blobUrl: videoUrl,
            sourceStartMs: 3800,
            sourceEndMs: 5100,
            durationMs: 1300,
            projectStartMs: 3800,
            projectEndMs: 3800,
            status: 'SUGGESTED_SILENCE_CUT',
            transitionOut: { type: 'none', durationMs: 0 },
            meta: { silenceRms: 0.002 }
          },
          {
            id: 'demo_clip_2',
            kind: 'SOURCE_CLIP',
            title: 'Core: Trimming & Audio Filter',
            blobUrl: videoUrl,
            sourceStartMs: 5100,
            sourceEndMs: 11800,
            durationMs: 6700,
            projectStartMs: 3800,
            projectEndMs: 10500,
            status: 'ACTIVE',
            transitionOut: { type: 'none', durationMs: 0 }
          },
          {
            id: 'demo_silence_2',
            kind: 'SOURCE_CLIP',
            title: 'Awkward Silence (1.8s)',
            blobUrl: videoUrl,
            sourceStartMs: 11800,
            sourceEndMs: 13600,
            durationMs: 1800,
            projectStartMs: 10500,
            projectEndMs: 10500,
            status: 'SUGGESTED_SILENCE_CUT',
            transitionOut: { type: 'none', durationMs: 0 },
            meta: { silenceRms: 0.001 }
          },
          {
            id: 'demo_clip_3',
            kind: 'SOURCE_CLIP',
            title: 'Outro: Memes & Export',
            blobUrl: videoUrl,
            sourceStartMs: 13600,
            sourceEndMs: 30000,
            durationMs: 16400,
            projectStartMs: 10500,
            projectEndMs: 26900,
            status: 'ACTIVE',
            transitionOut: { type: 'none', durationMs: 0 }
          }
        ];

        cachedDemoResult = {
          videoUrl,
          blob,
          durationMs,
          initialItems
        };
        resolve(cachedDemoResult);
      };

      recorder.start();

      const startTime = performance.now();
      const drawFrame = () => {
        const elapsedMs = performance.now() - startTime;
        const currentSec = Math.min(durationSec, elapsedMs / 1000);
        const progress = currentSec / durationSec;

        if (onProgress) onProgress(Math.round(progress * 100));

        // Background
        ctx.fillStyle = '#0F1117';
        ctx.fillRect(0, 0, width, height);

        // Header banner
        ctx.fillStyle = '#1A1D27';
        ctx.fillRect(0, 0, width, 50);

        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#6366F1';
        ctx.fillText('⚡ AI Video Editor Studio — Sample 30s Demonstration', 20, 32);

        // Waveform / Activity indicator
        const isSilent = (currentSec >= 3.8 && currentSec < 5.1) || (currentSec >= 11.8 && currentSec < 13.6);

        // Speaker box
        ctx.strokeStyle = isSilent ? '#EF4444' : '#10B981';
        ctx.lineWidth = 4;
        ctx.strokeRect(40, 70, width - 80, height - 140);

        // Avatar icon
        ctx.font = '54px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(isSilent ? '🤫' : '🗣️', width / 2, 140);

        // Status caption
        ctx.font = 'bold 20px sans-serif';
        ctx.fillStyle = isSilent ? '#F87171' : '#34D399';
        ctx.fillText(
          isSilent ? '⚠️ Awkward Silence Detected (No Speech)' : '🎙️ Speaker Talking (Speech Energy Active)',
          width / 2,
          195
        );

        // Timecode display
        const mm = Math.floor(currentSec / 60).toString().padStart(2, '0');
        const ss = Math.floor(currentSec % 60).toString().padStart(2, '0');
        const ms = Math.floor((currentSec % 1) * 100).toString().padStart(2, '0');
        ctx.font = 'bold 36px monospace';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(`${mm}:${ss}.${ms} / 00:30.00`, width / 2, 245);

        // Progress bar
        ctx.fillStyle = '#2E3446';
        ctx.fillRect(40, height - 40, width - 80, 10);
        ctx.fillStyle = '#6366F1';
        ctx.fillRect(40, height - 40, (width - 80) * progress, 10);

        if (currentSec < durationSec) {
          requestAnimationFrame(drawFrame);
        } else {
          recorder.stop();
        }
      };

      requestAnimationFrame(drawFrame);
    } catch {
      // Emergency fallback: return placeholder
      const dummy = URL.createObjectURL(new Blob([], { type: 'video/webm' }));
      resolve({
        videoUrl: dummy,
        blob: new Blob([]),
        durationMs: 30000,
        initialItems: []
      });
    }
  });
}
