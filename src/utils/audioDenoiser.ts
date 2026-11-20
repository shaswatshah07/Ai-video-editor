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
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
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

  // 2. Pre-filter: 110Hz HPF + 8000Hz LPF via OfflineAudioContext
  onProgress?.('Pre-filtering...', 0.1);
  const offCtx = new OfflineAudioContext(1, mono.length, sampleRate);
  const srcBuf = offCtx.createBuffer(1, mono.length, sampleRate);
  srcBuf.getChannelData(0).set(mono);
  const src = offCtx.createBufferSource();
  src.buffer = srcBuf;

  const hpf = offCtx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 110;
  hpf.Q.value = 0.7071;

  const lpf = offCtx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 8000;
  lpf.Q.value = 0.7071;

  src.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(offCtx.destination);
  src.start(0);

  const filtered = await offCtx.startRendering();
  const samples = filtered.getChannelData(0);

  // 3. STFT parameters: 1024 window (~21-23ms), 75% overlap (cuts time-domain smearing in half)
  const fftSize = 1024;
  const hopSize = 256; // 75% overlap
  const hann = hannWindow(fftSize);
  const halfBins = fftSize / 2 + 1; // 513
  const half = fftSize / 2;         // 512

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

  // Sort indices by energy to find quietest 15% (noise frames, minimum 12 frames)
  const sortedIndices = frameEnergies.map((_, i) => i)
    .sort((a, b) => frameEnergies[a] - frameEnergies[b]);
  const noiseFrameCount = Math.max(12, Math.floor(totalFrames * 0.15));

  // 5. Average noise power spectrum from quietest frames (noisePSD)
  const noisePSD = new Float64Array(halfBins);
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
      noisePSD[k] += (re[k] * re[k] + im[k] * im[k]) / noiseFrameCount;
    }
  }

  // 6. Decision-Directed Wiener Filter (alpha = 0.88 to avoid 200ms reverb tails)
  onProgress?.('Applying Decision-Directed Wiener denoiser...', 0.35);

  const output = new Float64Array(samples.length);
  const windowSum = new Float64Array(samples.length);
  const prevPriorSNR = new Float64Array(halfBins);
  const rawGain = new Float64Array(halfBins);
  const smoothGain = new Float64Array(halfBins);
  const alpha = 0.88;
  let isFirstFrame = true;

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

    // Compute Decision-Directed Wiener gain per bin
    for (let k = 0; k < halfBins; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const gamma = power / Math.max(noisePSD[k], 1e-10);

      if (isFirstFrame) {
        prevPriorSNR[k] = Math.max(gamma - 1, 0);
      }

      // a priori SNR using Decision-Directed smoothing (alpha = 0.88)
      const xi = alpha * prevPriorSNR[k] + (1 - alpha) * Math.max(gamma - 1, 0);

      // Frequency-aware floor & speech boost bias
      const freq = (k * sampleRate) / fftSize;
      let gain: number;

      if (freq >= 250 && freq <= 4500) {
        // Core speech band: 0.16 minimum floor and gentle bias so voice remains warm and natural
        const biasedXi = xi * 1.25;
        gain = Math.max(0.16, biasedXi / (1 + biasedXi));
      } else {
        // Below 250Hz / above 4500Hz: floor at 0.10
        gain = Math.max(0.10, xi / (1 + xi));
      }

      rawGain[k] = gain;
      prevPriorSNR[k] = Math.max(0, gain * gain * gamma);
    }
    isFirstFrame = false;

    // Gentle 5-bin frequency smoothing [0.1, 0.2, 0.4, 0.2, 0.1] to prevent sharp metallic notches
    for (let k = 0; k < halfBins; k++) {
      const g0 = rawGain[Math.max(0, k - 2)];
      const g1 = rawGain[Math.max(0, k - 1)];
      const g2 = rawGain[k];
      const g3 = rawGain[Math.min(halfBins - 1, k + 1)];
      const g4 = rawGain[Math.min(halfBins - 1, k + 2)];
      smoothGain[k] = 0.1 * g0 + 0.2 * g1 + 0.4 * g2 + 0.2 * g3 + 0.1 * g4;
    }

    // Strict Hermitian Mirror Symmetry (eliminates time-reversed ghost echoes)
    re[0] *= smoothGain[0];
    im[0] = 0;
    re[half] *= smoothGain[half];
    im[half] = 0;

    for (let k = 1; k < half; k++) {
      const g = smoothGain[k];
      const mirrorK = fftSize - k;
      re[k] *= g;
      im[k] *= g;
      re[mirrorK] *= g;
      im[mirrorK] *= g;
    }

    // IFFT
    ifft(re, im);

    // Synthesis windowing & Overlap-add
    for (let i = 0; i < fftSize && start + i < output.length; i++) {
      output[start + i] += re[i] * hann[i];
      windowSum[start + i] += hann[i] * hann[i];
    }
  }

  // Exact COLA Normalization
  onProgress?.('Normalizing output...', 0.88);
  for (let i = 0; i < output.length; i++) {
    output[i] /= Math.max(windowSum[i], 1e-6);
  }

  // Active-Speech RMS Loudness Restoration (Conservative, does not amplify room reflections)
  onProgress?.('Restoring active-speech loudness...', 0.92);
  const frameLen = hopSize;
  const numRmsFrames = Math.floor(output.length / frameLen);
  const origRmsArr = new Float64Array(numRmsFrames);
  const denRmsArr = new Float64Array(numRmsFrames);

  for (let f = 0; f < numRmsFrames; f++) {
    const start = f * frameLen;
    let sumOrig = 0;
    let sumDen = 0;
    for (let i = 0; i < frameLen; i++) {
      const o = samples[start + i];
      const d = output[start + i];
      sumOrig += o * o;
      sumDen += d * d;
    }
    origRmsArr[f] = Math.sqrt(sumOrig / frameLen);
    denRmsArr[f] = Math.sqrt(sumDen / frameLen);
  }

  const sortedOrigRms = Array.from(origRmsArr).sort((a, b) => b - a);
  const sortedDenRms = Array.from(denRmsArr).sort((a, b) => b - a);
  const topSpeechCount = Math.max(1, Math.floor(numRmsFrames * 0.30));

  let sumTopOrig = 0;
  let sumTopDen = 0;
  for (let i = 0; i < topSpeechCount; i++) {
    sumTopOrig += sortedOrigRms[i];
    sumTopDen += sortedDenRms[i];
  }
  const origSpeechRMS = sumTopOrig / topSpeechCount;
  const denoisedSpeechRMS = sumTopDen / topSpeechCount;

  // Capped makeup gain (max 1.6) so room reverberation is never boosted
  const makeupGain = Math.min(1.6, origSpeechRMS / Math.max(denoisedSpeechRMS, 1e-6));

  // Transparent soft clipping only above 0.92
  const finalSamples = new Float32Array(output.length);
  for (let i = 0; i < output.length; i++) {
    let s = output[i] * makeupGain;
    const abs = Math.abs(s);
    if (abs > 0.92) {
      s = Math.sign(s) * (0.92 + 0.07 * Math.tanh((abs - 0.92) / 0.07));
    }
    finalSamples[i] = Math.max(-0.99, Math.min(0.99, s));
  }

  onProgress?.('Encoding WAV...', 0.95);
  const wavBlob = encodeWav(finalSamples, sampleRate);
  const url = URL.createObjectURL(wavBlob);

  onProgress?.('Done', 1.0);
  return { blob: wavBlob, url };
}
