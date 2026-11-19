import { pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js for browser client-side execution
env.allowLocalModels = false;
env.useBrowserCache = true;

let loadedTranscriber: any = null;
let loadedQuality: 'accurate' | 'fast' | null = null;
let currentDevice: 'webgpu' | 'wasm' = 'wasm';

async function getTranscriber(requestedQuality: 'accurate' | 'fast') {
  if (loadedTranscriber && loadedQuality === requestedQuality) {
    return { transcriber: loadedTranscriber, quality: loadedQuality, device: currentDevice };
  }

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

  const modelId = requestedQuality === 'accurate' ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base';

  const pipelineOptions: any = {
    device: currentDevice,
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

  if (requestedQuality === 'accurate') {
    // Whisper Small ONNX q4 (~285 MB total)
    pipelineOptions.dtype = {
      encoder_model: 'q4',
      decoder_model_merged: 'q4'
    };
  } else {
    // Whisper Base ONNX (~75 MB total)
    pipelineOptions.dtype = {
      encoder_model: 'fp32',
      decoder_model_merged: 'q4'
    };
  }

  const transcriber = await pipeline('automatic-speech-recognition', modelId, pipelineOptions);
  loadedTranscriber = transcriber;
  loadedQuality = requestedQuality;
  return { transcriber, quality: requestedQuality, device: currentDevice };
}

self.onmessage = async (event: MessageEvent) => {
  const { type, audioData, quality = 'accurate', mode = 'translate_en' } = event.data;

  if (type === 'TRANSCRIBE') {
    const startTime = Date.now();
    try {
      self.postMessage({ type: 'STATUS', status: 'loading_model' });

      let transcriberInfo;
      try {
        transcriberInfo = await getTranscriber(quality);
      } catch (err: any) {
        if (quality === 'accurate') {
          console.warn('Accurate (Small) failed, falling back to Fast (Base):', err);
          self.postMessage({
            type: 'FALLBACK_TO_BASE',
            message: 'Whisper Small could not be loaded; falling back to Whisper Base.'
          });
          transcriberInfo = await getTranscriber('fast');
        } else {
          throw err;
        }
      }

      const { transcriber, quality: usedQuality, device } = transcriberInfo;
      self.postMessage({ type: 'STATUS', status: 'transcribing' });

      // Map explicit mode to language & task
      // a) translate_en: task = 'translate', language = 'hindi' (English translated from speech)
      // b) transcribe_en: task = 'transcribe', language = 'english' (English as spoken)
      // c) transcribe_hi: task = 'transcribe', language = 'hindi' (Hindi as spoken)
      let task: 'translate' | 'transcribe' = 'translate';
      let language: 'hindi' | 'english' = 'hindi';

      if (mode === 'transcribe_en') {
        task = 'transcribe';
        language = 'english';
      } else if (mode === 'transcribe_hi') {
        task = 'transcribe';
        language = 'hindi';
      } else {
        task = 'translate';
        language = 'hindi';
      }

      let result: any;
      try {
        result = await transcriber(audioData, {
          language,
          task,
          return_timestamps: 'word',
          chunk_length_s: 30,
          stride_length_s: 5
        });
        result.isSegmentLevelFallback = false;
      } catch (wordErr: any) {
        console.warn('Word-level timestamps unavailable, falling back to segment timestamps:', wordErr);
        result = await transcriber(audioData, {
          language,
          task,
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5
        });
        result.isSegmentLevelFallback = true;
      }

      const durationMs = Date.now() - startTime;
      const modelName = usedQuality === 'accurate' ? 'Whisper Small' : 'Whisper Base';

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
