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
 * Peak normalizes audio buffer to ~0.9 peak amplitude.
 * Boosts soft phone/WhatsApp recordings so Whisper does not hallucinate on low-volume speech.
 */
export function peakNormalizeTo09(input: Float32Array, targetPeak = 0.9): Float32Array {
  let maxPeak = 0;
  for (let i = 0; i < input.length; i++) {
    const abs = Math.abs(input[i]);
    if (abs > maxPeak) maxPeak = abs;
  }
  if (maxPeak > 0.0001) {
    const scale = targetPeak / maxPeak;
    for (let i = 0; i < input.length; i++) {
      input[i] *= scale;
    }
  }
  return input;
}

/**
 * Applies gentle 80 Hz high-pass + peak amplitude normalization (~0.9) to 16 kHz Float32Array.
 */
export function preprocessAudioFloat32(rawFloat32: Float32Array, sampleRate = 16000): Float32Array {
  const filtered = apply80HzHighPassFilter(rawFloat32, sampleRate);
  return peakNormalizeTo09(filtered, 0.9);
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

/**
 * Dedicated Hinglish audio cleanup pipeline (applied ONLY when mode === 'transcribe_hinglish'):
 * 1. Resample to 16,000 Hz mono Float32Array.
 * 2. Apply a voice bandpass filter (80 Hz high-pass + 7,500 Hz low-pass) via OfflineAudioContext
 *    to remove low AC/fan rumble and high hiss before transcription.
 * 3. Normalize peak amplitude to 0.92.
 * 4. Apply a soft silence gate: for any 20ms frame whose RMS energy is below 0.006 (~ -44 dB),
 *    smoothly attenuate toward 0 so Whisper does not hallucinate random words during background fan noise.
 */
export async function extractHinglish16kHzMonoAudio(
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

  // Voice bandpass filter (80 Hz high-pass + 7,500 Hz low-pass) via OfflineAudioContext
  const highPass = offlineCtx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 80;
  highPass.Q.value = 0.7071;

  const lowPass = offlineCtx.createBiquadFilter();
  lowPass.type = 'lowpass';
  lowPass.frequency.value = 7500;
  lowPass.Q.value = 0.7071;

  bufferSource.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(offlineCtx.destination);
  bufferSource.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const rawMono = renderedBuffer.getChannelData(0);
  const audioData = new Float32Array(rawMono);

  // Peak amplitude normalize to 0.92
  let maxPeak = 0;
  for (let i = 0; i < audioData.length; i++) {
    const abs = Math.abs(audioData[i]);
    if (abs > maxPeak) maxPeak = abs;
  }
  if (maxPeak > 0.0001) {
    const scale = 0.92 / maxPeak;
    for (let i = 0; i < audioData.length; i++) {
      audioData[i] *= scale;
    }
  }

  // Soft silence gate: 20ms frames (320 samples at 16kHz)
  // For any 20ms frame whose RMS energy is below 0.006 (~ -44 dB), smoothly attenuate toward 0
  const frameSize = Math.round(targetSampleRate * 0.02); // 320 samples
  const rmsThreshold = 0.006;
  let currentGain = 1.0;

  for (let frameStart = 0; frameStart < audioData.length; frameStart += frameSize) {
    const frameEnd = Math.min(frameStart + frameSize, audioData.length);
    const nSamples = frameEnd - frameStart;
    let sumSq = 0;
    for (let i = frameStart; i < frameEnd; i++) {
      sumSq += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sumSq / nSamples);
    const targetGain = rms >= rmsThreshold ? 1.0 : Math.pow(rms / rmsThreshold, 2);

    const gainStep = (targetGain - currentGain) / nSamples;
    for (let i = frameStart; i < frameEnd; i++) {
      currentGain += gainStep;
      audioData[i] *= currentGain;
    }
    currentGain = targetGain;
  }

  return audioData;
}
