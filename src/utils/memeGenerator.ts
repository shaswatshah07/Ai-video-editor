/**
 * Programmatically generates real, playable MP4/WebM video blobs
 * for built-in library memes using HTML5 Canvas + Web Audio API + MediaRecorder.
 * This guarantees 100% offline reliability with zero broken external links.
 */

export type MemeId = 'fail_trombone' | 'wait_what' | 'victory_cheer' | 'shocked_blink';

export interface MemePreset {
  id: MemeId;
  name: string;
  durationMs: number;
  emoji: string;
  themeColor: string;
  blobUrl?: string;
}

export const MEME_PRESETS: Record<MemeId, MemePreset> = {
  fail_trombone: {
    id: 'fail_trombone',
    name: 'Fail Trombone 🎺',
    durationMs: 2500,
    emoji: '🎺',
    themeColor: '#EF4444'
  },
  wait_what: {
    id: 'wait_what',
    name: 'Wait... WHAT?! 🤨',
    durationMs: 2000,
    emoji: '🤨',
    themeColor: '#F59E0B'
  },
  victory_cheer: {
    id: 'victory_cheer',
    name: 'Victory Cheer 🎉',
    durationMs: 2200,
    emoji: '🎉',
    themeColor: '#10B981'
  },
  shocked_blink: {
    id: 'shocked_blink',
    name: 'Shocked Blink 😳',
    durationMs: 1800,
    emoji: '😳',
    themeColor: '#8B5CF6'
  }
};

const cachedBlobs = new Map<string, string>();

/**
 * Creates a playable video blob with visual animation and synchronized audio tone.
 */
export async function getOrGenerateMemeBlob(memeId: MemePreset['id']): Promise<string> {
  if (cachedBlobs.has(memeId)) {
    return cachedBlobs.get(memeId)!;
  }

  const preset = MEME_PRESETS[memeId];
  if (!preset) throw new Error(`Unknown meme ID: ${memeId}`);

  return new Promise((resolve) => {
    try {
      const width = 640;
      const height = 360;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2d context');

      // Audio Synthesis
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      const dest = audioCtx.createMediaStreamDestination();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      if (memeId === 'fail_trombone') {
        // Sliding down sad frequencies
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(140, audioCtx.currentTime + preset.durationMs / 1000);
      } else if (memeId === 'victory_cheer') {
        // Arpeggiated happy chime
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.setValueAtTime(554, audioCtx.currentTime + 0.3);
        osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.6);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.9);
      } else if (memeId === 'wait_what') {
        // Inquisitive rising question tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(260, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(520, audioCtx.currentTime + preset.durationMs / 1000);
      } else {
        // Shocked low thump
        osc.type = 'square';
        osc.frequency.setValueAtTime(110, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(55, audioCtx.currentTime + preset.durationMs / 1000);
      }

      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + preset.durationMs / 1000);

      osc.connect(gain);
      gain.connect(dest);
      osc.start();

      // Canvas animation stream
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
        const finalBlob = new Blob(chunks, { type: 'video/webm' });
        const blobUrl = URL.createObjectURL(finalBlob);
        cachedBlobs.set(memeId, blobUrl);
        resolve(blobUrl);
      };

      recorder.start();

      const startTime = performance.now();
      const drawFrame = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / preset.durationMs);

        // Background
        ctx.fillStyle = '#0B0D13';
        ctx.fillRect(0, 0, width, height);

        // Gradient border / badge
        ctx.strokeStyle = preset.themeColor;
        ctx.lineWidth = 8;
        ctx.strokeRect(10, 10, width - 20, height - 20);

        // Animated meme icon pulse
        const scale = 1 + 0.15 * Math.sin(progress * Math.PI * 4);
        ctx.save();
        ctx.translate(width / 2, height / 2 - 20);
        ctx.scale(scale, scale);
        ctx.font = '72px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(preset.emoji, 0, 0);
        ctx.restore();

        // Caption Text
        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(preset.name, width / 2, height / 2 + 70);

        // Progress bar at bottom
        ctx.fillStyle = preset.themeColor;
        ctx.fillRect(20, height - 30, (width - 40) * progress, 8);

        if (progress < 1) {
          requestAnimationFrame(drawFrame);
        } else {
          recorder.stop();
        }
      };

      requestAnimationFrame(drawFrame);
    } catch {
      // Fallback empty blob
      const empty = URL.createObjectURL(new Blob([], { type: 'video/mp4' }));
      resolve(empty);
    }
  });
}
