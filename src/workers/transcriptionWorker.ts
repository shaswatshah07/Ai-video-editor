import { pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js for browser client-side execution
env.allowLocalModels = false;
env.useBrowserCache = true;

const loadedTranscribers = new Map<string, any>();
let currentDevice: 'webgpu' | 'wasm' = 'wasm';

async function getTranscriber(
  requestedQuality: 'accurate' | 'fast',
  requestedMode: 'translate_en' | 'transcribe_en' | 'transcribe_hinglish'
) {
  // Check WebGPU support
  try {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
      currentDevice = 'webgpu';
    } else {
      currentDevice = 'wasm';
    }
  } catch {
    currentDevice = 'wasm';
  }

  let modelId = 'onnx-community/whisper-small';
  let modelDtype: any = { encoder_model: 'q4', decoder_model_merged: 'q4' };

  if (requestedQuality === 'fast') {
    modelId = 'onnx-community/whisper-base';
    modelDtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
  } else {
    modelId = 'onnx-community/whisper-small';
    modelDtype = { encoder_model: 'q4', decoder_model_merged: 'q4' };
  }

  const pipelineOptions: any = {
    device: currentDevice,
    dtype: modelDtype,
    progress_callback: (p: any) => {
      if (p.status === 'progress') {
        self.postMessage({
          type: 'DOWNLOAD_PROGRESS',
          file: p.file || 'weights',
          progress: typeof p.progress === 'number' ? Math.round(p.progress) : 0,
          loaded: p.loaded,
          total: p.total
        });
      } else if (p.status === 'initiate') {
        self.postMessage({
          type: 'DOWNLOAD_START',
          file: p.file || 'weights'
        });
      } else if (p.status === 'done') {
        self.postMessage({
          type: 'DOWNLOAD_DONE',
          file: p.file || 'weights'
        });
      }
    }
  };

  if (requestedMode === 'transcribe_hinglish') {
    modelId = 'ishaan-g/whisper-hinglish-swift_timestamped';
    const cacheKey = `${modelId}_${currentDevice}`;
    if (loadedTranscribers.has(cacheKey)) {
      return {
        transcriber: loadedTranscribers.get(cacheKey),
        quality: requestedQuality,
        modelId,
        device: currentDevice
      };
    }

    // Try loading with dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' }
    // If fp32 encoder fails to load from Hugging Face, automatically catch and fall back to dtype: 'q8'
    try {
      const transcriber = await pipeline('automatic-speech-recognition', modelId, {
        ...pipelineOptions,
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' }
      });
      loadedTranscribers.set(cacheKey, transcriber);
      return { transcriber, quality: requestedQuality, modelId, device: currentDevice };
    } catch (fp32Err: any) {
      console.warn('Hinglish fp32 encoder load failed; falling back to q8:', fp32Err);
      try {
        const transcriber = await pipeline('automatic-speech-recognition', modelId, {
          ...pipelineOptions,
          dtype: 'q8'
        });
        loadedTranscribers.set(cacheKey, transcriber);
        return { transcriber, quality: requestedQuality, modelId, device: currentDevice };
      } catch (q8Err: any) {
        console.warn('Hinglish q8 load failed; falling back to multilingual whisper-small:', q8Err);
        self.postMessage({
          type: 'FALLBACK_TO_BASE',
          message: 'Whisper Hinglish model unavailable; falling back to multilingual Whisper Small.'
        });
        const fallbackModelId = 'onnx-community/whisper-small';
        const fallbackTranscriber = await pipeline('automatic-speech-recognition', fallbackModelId, {
          ...pipelineOptions,
          dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }
        });
        loadedTranscribers.set(`${fallbackModelId}_${currentDevice}`, fallbackTranscriber);
        return { transcriber: fallbackTranscriber, quality: 'accurate', modelId: fallbackModelId, device: currentDevice };
      }
    }
  }

  const cacheKey = `${modelId}_${currentDevice}`;
  if (loadedTranscribers.has(cacheKey)) {
    return {
      transcriber: loadedTranscribers.get(cacheKey),
      quality: requestedQuality,
      modelId,
      device: currentDevice
    };
  }

  try {
    const transcriber = await pipeline('automatic-speech-recognition', modelId, pipelineOptions);
    loadedTranscribers.set(cacheKey, transcriber);
    return { transcriber, quality: requestedQuality, modelId, device: currentDevice };
  } catch (err: any) {
    if (requestedQuality === 'accurate') {
      console.warn('Whisper Small failed, falling back to Whisper Base:', err);
      self.postMessage({
        type: 'FALLBACK_TO_BASE',
        message: 'Whisper Small could not be loaded; falling back to Whisper Base.'
      });
      const fallbackModelId = 'onnx-community/whisper-base';
      pipelineOptions.dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
      const fallbackTranscriber = await pipeline('automatic-speech-recognition', fallbackModelId, pipelineOptions);
      loadedTranscribers.set(`${fallbackModelId}_${currentDevice}`, fallbackTranscriber);
      return { transcriber: fallbackTranscriber, quality: 'fast', modelId: fallbackModelId, device: currentDevice };
    }
    throw err;
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { type, audioData, quality = 'accurate', mode = 'translate_en' } = event.data;

  if (type === 'TRANSCRIBE') {
    const startTime = Date.now();
    try {
      self.postMessage({ type: 'STATUS', status: 'loading_model' });

      const transcriberInfo = await getTranscriber(quality, mode);
      const { transcriber, quality: usedQuality, modelId, device } = transcriberInfo;

      self.postMessage({ type: 'STATUS', status: 'transcribing' });

      let result: any;

      if (mode === 'transcribe_hinglish') {
        const hinglishParams: any = {
          language: 'en',
          task: 'transcribe',
          chunk_length_s: 20,
          stride_length_s: 4,
          temperature: 0,
          repetition_penalty: 1.08,
          no_repeat_ngram_size: 3,
          return_timestamps: 'word'
        };

        try {
          result = await transcriber(audioData, hinglishParams);
          const hasWordChunks = result && Array.isArray(result.chunks) && result.chunks.length > 0;
          if (!hasWordChunks) {
            console.warn('Word-level timestamps returned empty chunks; re-running with segment timestamps.');
            result = await transcriber(audioData, {
              ...hinglishParams,
              return_timestamps: true
            });
            result.isSegmentLevelFallback = true;
          } else {
            result.isSegmentLevelFallback = false;
          }
        } catch (wordErr: any) {
          console.warn('Word-level timestamps failed; falling back to segment timestamps:', wordErr);
          result = await transcriber(audioData, {
            ...hinglishParams,
            return_timestamps: true
          });
          result.isSegmentLevelFallback = true;
        }
      } else if (mode === 'translate_en') {
        // English translated from Hindi speech
        result = await transcriber(audioData, {
          language: 'hindi',
          task: 'translate',
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: true
        });
        result.isSegmentLevelFallback = true;
      } else {
        // English (as spoken)
        try {
          result = await transcriber(audioData, {
            language: 'english',
            task: 'transcribe',
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: 'word'
          });
          result.isSegmentLevelFallback = false;
        } catch (wordErr: any) {
          console.warn('Word-level timestamps unavailable, falling back to segment timestamps:', wordErr);
          result = await transcriber(audioData, {
            language: 'english',
            task: 'transcribe',
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: true
          });
          result.isSegmentLevelFallback = true;
        }
      }

      const durationMs = Date.now() - startTime;
      const modelName = modelId.includes('hinglish')
        ? 'Whisper Hinglish (swift)'
        : modelId.includes('small')
        ? 'Whisper Small'
        : 'Whisper Base';

      self.postMessage({
        type: 'COMPLETE',
        result,
        modelName,
        modelQuality: usedQuality,
        mode,
        device: device === 'webgpu' ? 'WebGPU' : 'WASM',
        durationMs
      });
    } catch (err: any) {
      console.error('Transcription worker error:', err);
      self.postMessage({
        type: 'ERROR',
        error: err?.message || String(err)
      });
    }
  }
};
