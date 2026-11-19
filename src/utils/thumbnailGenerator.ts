export type ThumbnailMap = Record<number, string>;

export interface ThumbnailProgress {
  current: number;
  total: number;
  done: boolean;
}

/**
 * Generates video thumbnails (1 per source second, up to 300 total)
 * using a dedicated hidden, muted <video> element.
 * Sequentially seeks, waits for 'seeked', and draws to a small 64px-height canvas.
 * Yields to main thread so the UI never stutters.
 */
export async function generateSourceThumbnails(
  videoBlobOrUrl: Blob | string,
  sourceDurationMs: number,
  onProgress?: (current: number, total: number) => void
): Promise<ThumbnailMap> {
  const thumbnails: ThumbnailMap = {};
  const durationSec = Math.max(1, Math.floor(sourceDurationMs / 1000));
  const totalThumbnails = Math.min(300, durationSec);

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
    const canvasHeight = 64;
    const canvasWidth = Math.max(20, Math.min(120, Math.round(canvasHeight * aspect)));

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('Canvas 2D context not available for thumbnails');
      return thumbnails;
    }

    for (let sec = 0; sec < totalThumbnails; sec++) {
      const targetTime = Math.min(sec + 0.1, Math.max(0, (video.duration || durationSec) - 0.05));

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
        thumbnails[sec] = canvas.toDataURL('image/jpeg', 0.6);
      } catch (drawErr) {
        console.warn(`Failed to capture frame at ${sec}s:`, drawErr);
      }

      if (onProgress) {
        onProgress(sec + 1, totalThumbnails);
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
