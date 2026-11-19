/**
 * Decodes audio from an uploaded video file, blob, or URL,
 * mixes channels to mono, and resamples to 16 kHz Float32Array using AudioContext/OfflineAudioContext.
 * Throws a clear message if no audio track exists.
 */
export async function extract16kHzMonoAudio(
  videoBlobOrUrl: Blob | string
): Promise<Float32Array> {
  let blob: Blob;
  if (typeof videoBlobOrUrl === 'string') {
    const resp = await fetch(videoBlobOrUrl);
    blob = await resp.blob();
  } else {
    blob = videoBlobOrUrl;
  }

  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtxClass();

  let decoded: AudioBuffer;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    await audioCtx.close();
    throw new Error('No audio track found in video or audio decoding failed.');
  } finally {
    if (audioCtx.state !== 'closed') {
      await audioCtx.close();
    }
  }

  if (decoded.numberOfChannels === 0 || decoded.length === 0) {
    throw new Error('No audio track found in video.');
  }

  const targetSampleRate = 16000;
  const targetLength = Math.max(1, Math.round(decoded.duration * targetSampleRate));

  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = decoded;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer.getChannelData(0);
}
