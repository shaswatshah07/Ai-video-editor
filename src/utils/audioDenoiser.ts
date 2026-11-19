/**
 * Adaptive STFT Wiener Spectral Denoiser
 * Pure TypeScript, runs entirely in the browser, zero paid APIs.
 * Decodes video audio → pre-filters → STFT → noise profile → Wiener gain → IFFT → WAV Blob.
 */

// ─── Radix-2 FFT (Cooley–Tukey) ──────────────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const a = i + j;
        const b = a + halfLen;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Conjugate
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  // Conjugate & scale
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

// ─── Hann Window ──────────────────────────────────────────────────────────────

function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

// ─── WAV Encoder ──────────────────────────────────────────────────────────────

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);       // subchunk1 size
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// ─── Main Denoiser ────────────────────────────────────────────────────────────

export async function generateDenoisedAudio(
  videoUrl: string,
  onProgress?: (stage: string, ratio: number) => void
): Promise<{ blob: Blob; url: string }> {
  // 1. Fetch and decode audio
  onProgress?.('Decoding audio...', 0.05);
  const resp = await fetch(videoUrl);
  const arrayBuffer = await resp.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  const sampleRate = decoded.sampleRate;

  // Mix to mono
  let mono: Float32Array;
  if (decoded.numberOfChannels === 1) {
    mono = decoded.getChannelData(0).slice();
  } else {
    const ch0 = decoded.getChannelData(0);
    const ch1 = decoded.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
  }
  await ctx.close();

  // 2. Pre-filter: 130Hz HPF + 7500Hz LPF via OfflineAudioContext
  onProgress?.('Pre-filtering...', 0.1);
  const offCtx = new OfflineAudioContext(1, mono.length, sampleRate);
  const srcBuf = offCtx.createBuffer(1, mono.length, sampleRate);
  srcBuf.getChannelData(0).set(mono);
  const src = offCtx.createBufferSource();
  src.buffer = srcBuf;

  const hpf = offCtx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 130;
  hpf.Q.value = 0.7071;

  const lpf = offCtx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 7500;
  lpf.Q.value = 0.7071;

  src.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(offCtx.destination);
  src.start(0);

  const filtered = await offCtx.startRendering();
  const samples = filtered.getChannelData(0);

  // 3. STFT parameters
  const fftSize = 2048;
  const hopSize = 512; // 75% overlap
  const hann = hannWindow(fftSize);
  const halfBins = fftSize / 2 + 1;

  // Count frames
  const totalFrames = Math.max(0, Math.floor((samples.length - fftSize) / hopSize) + 1);
  if (totalFrames < 2) {
    // Audio too short for spectral processing; return as-is
    const wavBlob = encodeWav(new Float32Array(samples), sampleRate);
    return { blob: wavBlob, url: URL.createObjectURL(wavBlob) };
  }

  onProgress?.('Computing STFT & noise profile...', 0.2);

  // 4. Compute frame energies for noise profiling
  const frameEnergies: number[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const start = f * hopSize;
    let energy = 0;
    for (let i = 0; i < fftSize && start + i < samples.length; i++) {
      const v = samples[start + i] * hann[i];
      energy += v * v;
    }
    frameEnergies.push(energy);
  }

  // Sort indices by energy to find quietest 12% (noise frames)
  const sortedIndices = frameEnergies.map((_, i) => i)
    .sort((a, b) => frameEnergies[a] - frameEnergies[b]);
  const noiseFrameCount = Math.max(15, Math.floor(totalFrames * 0.12));

  // 5. Average noise power spectrum from quietest frames
  const noisePower = new Float64Array(halfBins);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let nf = 0; nf < noiseFrameCount; nf++) {
    const frameIdx = sortedIndices[nf];
    const start = frameIdx * hopSize;
    re.fill(0); im.fill(0);
    for (let i = 0; i < fftSize && start + i < samples.length; i++) {
      re[i] = samples[start + i] * hann[i];
    }
    fft(re, im);
    for (let k = 0; k < halfBins; k++) {
      noisePower[k] += (re[k] * re[k] + im[k] * im[k]) / noiseFrameCount;
    }
  }

  // 6. Apply Wiener filter frame-by-frame with spectral subtraction
  onProgress?.('Applying Wiener spectral denoiser...', 0.35);

  const output = new Float64Array(samples.length);
  const windowSum = new Float64Array(samples.length);
  const alpha = 2.6;
  const beta = 0.04;

  // Previous gain for temporal smoothing
  let prevGain = new Float64Array(halfBins);
  prevGain.fill(1.0);

  for (let f = 0; f < totalFrames; f++) {
    if (f % 50 === 0) {
      onProgress?.(`Denoising frame ${f}/${totalFrames}...`, 0.35 + 0.5 * (f / totalFrames));
    }

    const start = f * hopSize;
    re.fill(0); im.fill(0);
    for (let i = 0; i < fftSize && start + i < samples.length; i++) {
      re[i] = samples[start + i] * hann[i];
    }
    fft(re, im);

    // Compute Wiener gain per bin
    const gain = new Float64Array(halfBins);
    for (let k = 0; k < halfBins; k++) {
      const signalPower = re[k] * re[k] + im[k] * im[k];
      const noisePow = noisePower[k] * alpha;
      let g = Math.max(beta, (signalPower - noisePow) / Math.max(signalPower, 1e-30));

      // 3-bin spatial smoothing
      if (k > 0 && k < halfBins - 1) {
        const sp1 = re[k - 1] * re[k - 1] + im[k - 1] * im[k - 1];
        const sp2 = re[k + 1] * re[k + 1] + im[k + 1] * im[k + 1];
        const g1 = Math.max(beta, (sp1 - noisePower[k - 1] * alpha) / Math.max(sp1, 1e-30));
        const g2 = Math.max(beta, (sp2 - noisePower[k + 1] * alpha) / Math.max(sp2, 1e-30));
        g = 0.5 * g + 0.25 * g1 + 0.25 * g2;
      }

      // Temporal smoothing
      g = 0.55 * prevGain[k] + 0.45 * g;
      gain[k] = g;
    }
    prevGain = gain;

    // Apply gain to spectrum
    for (let k = 0; k < halfBins; k++) {
      re[k] *= gain[k];
      im[k] *= gain[k];
    }
    // Mirror for negative frequencies
    for (let k = halfBins; k < fftSize; k++) {
      const mirrorK = fftSize - k;
      re[k] *= gain[mirrorK];
      im[k] *= gain[mirrorK];
    }

    // IFFT
    ifft(re, im);

    // Overlap-add
    for (let i = 0; i < fftSize && start + i < output.length; i++) {
      output[start + i] += re[i] * hann[i];
      windowSum[start + i] += hann[i] * hann[i];
    }
  }

  // Normalize by window sum
  onProgress?.('Normalizing output...', 0.88);
  for (let i = 0; i < output.length; i++) {
    if (windowSum[i] > 1e-8) {
      output[i] /= windowSum[i];
    }
  }

  // Final normalization to [-0.96, 0.96]
  let maxAbs = 0;
  for (let i = 0; i < output.length; i++) {
    const a = Math.abs(output[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 0 ? 0.96 / maxAbs : 1;
  const finalSamples = new Float32Array(output.length);
  for (let i = 0; i < output.length; i++) {
    finalSamples[i] = output[i] * scale;
  }

  onProgress?.('Encoding WAV...', 0.95);
  const wavBlob = encodeWav(finalSamples, sampleRate);
  const url = URL.createObjectURL(wavBlob);

  onProgress?.('Done', 1.0);
  return { blob: wavBlob, url };
}
