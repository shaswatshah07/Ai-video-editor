export type ThumbnailMap = Record<number, string>;

export interface ThumbnailProgress {
  current: number;
  total: number;
  done: boolean;
}

/**
 * Generates video thumbnails (1 per 0.5s or 1.0s of source, up to 300 total)
 * using a dedicated hidden, muted <video> element.
 * Sequentially seeks, waits for 'seeked', and draws to a 96px-height canvas
 * at the video's native aspect ratio with 0.85 JPEG quality.
 * Yields to main thread so the UI never stutters.
 */
export async function generateSourceThumbnails(
  videoBlobOrUrl: Blob | string,
  sourceDurationMs: number,
  onProgress?: (current: number, total: number) => void
): Promise<ThumbnailMap> {
  const thumbnails: ThumbnailMap = {};
  const durationSec = Math.max(1, sourceDurationMs / 1000);
  
  // Step 0.5s if total frames <= 300, else 1.0s (capped at 300)
  const stepSec = (durationSec / 300) > 0.5 ? 1.0 : 0.5;
  const totalThumbnails = Math.min(300, Math.floor(durationSec / stepSec));

  const videoUrl = typeof videoBlobOrUrl === 'string'
    ? videoBlobOrUrl
    : URL.createObjectURL(videoBlobOrUrl);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = videoUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 5000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load video metadata for thumbnail generation'));
      };
    });

    const aspect = (video.videoWidth && video.videoHeight)
      ? (video.videoWidth / video.videoHeight)
      : (9 / 16);
    const canvasHeight = 96;
    const canvasWidth = Math.max(30, Math.min(240, Math.round(canvasHeight * aspect)));

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('Canvas 2D context not available for thumbnails');
      return thumbnails;
    }

    for (let i = 0; i < totalThumbnails; i++) {
      const timeSec = i * stepSec;
      const targetTime = Math.min(timeSec + 0.05, Math.max(0, (video.duration || durationSec) - 0.05));

      await new Promise<void>((res) => {
        let settled = false;
        const onSeeked = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener('seeked', onSeeked);
          res();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = targetTime;

        // Fallback safety timeout if seeked does not fire
        setTimeout(() => {
          if (!settled) {
            settled = true;
            video.removeEventListener('seeked', onSeeked);
            res();
          }
        }, 600);
      });

      try {
        ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const timeMs = Math.round(timeSec * 1000);
        thumbnails[timeMs] = dataUrl;
        thumbnails[Math.floor(timeSec)] = dataUrl;
      } catch (drawErr) {
        console.warn(`Failed to capture frame at ${timeSec}s:`, drawErr);
      }

      if (onProgress) {
        onProgress(i + 1, totalThumbnails);
      }

      // Yield to event loop between frames
      await new Promise((r) => setTimeout(r, 0));
    }

    return thumbnails;
  } catch (err) {
    console.warn('Thumbnail generation encountered an error:', err);
    return thumbnails;
  }
}
