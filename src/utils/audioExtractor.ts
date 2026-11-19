/**
 * Decodes audio from an uploaded video file, blob, or URL,
 * mixes channels to mono, resamples to 16 kHz Float32Array,
 * applies a gentle 80 Hz high-pass filter, and peak-normalizes to -3 dB.
 * Throws a clear message if no audio track exists.
 */

/**
 * 2nd-order Butterworth IIR High-Pass filter at 80 Hz for 16 kHz audio.
 * Attenuates low-frequency mic rumble, wind noise, and hum.
 */
export function apply80HzHighPassFilter(input: Float32Array, sampleRate = 16000): Float32Array {
  const f0 = 80;
  const Q = 0.70710678;
  const omega = (2 * Math.PI * f0) / sampleRate;
  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);
  const alpha = sinOmega / (2 * Q);

  const b0 = (1 + cosOmega) / 2;
  const b1 = -(1 + cosOmega);
  const b2 = (1 + cosOmega) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosOmega;
  const a2 = 1 - alpha;

  const B0 = b0 / a0;
  const B1 = b1 / a0;
  const B2 = b2 / a0;
  const A1 = a1 / a0;
  const A2 = a2 / a0;

  const output = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = B0 * x0 + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}

/**
 * Peak normalizes audio buffer to -3 dB (~0.7079 peak amplitude).
 */
export function peakNormalizeMinus3dB(input: Float32Array): Float32Array {
  let maxPeak = 0;
  for (let i = 0; i < input.length; i++) {
    const abs = Math.abs(input[i]);
    if (abs > maxPeak) maxPeak = abs;
  }
  if (maxPeak > 0) {
    const targetPeak = Math.pow(10, -3 / 20); // ~0.70794578
    const scale = targetPeak / maxPeak;
    for (let i = 0; i < input.length; i++) {
      input[i] *= scale;
    }
  }
  return input;
}

/**
 * Applies gentle 80 Hz high-pass + -3 dB peak normalization to 16 kHz Float32Array.
 */
export function preprocessAudioFloat32(rawFloat32: Float32Array, sampleRate = 16000): Float32Array {
  const filtered = apply80HzHighPassFilter(rawFloat32, sampleRate);
  return peakNormalizeMinus3dB(filtered);
}

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
  const rawMono = renderedBuffer.getChannelData(0);

  // Apply 80 Hz high-pass + -3 dB peak normalization
  return preprocessAudioFloat32(rawMono, targetSampleRate);
}
