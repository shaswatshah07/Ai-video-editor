import { pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js for browser client-side execution
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise: Promise<any> | null = null;
let currentDevice: 'webgpu' | 'wasm' = 'wasm';

async function getTranscriber() {
  if (transcriberPromise) return transcriberPromise;

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

  const modelId = 'onnx-community/whisper-base';

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

  if (currentDevice === 'wasm') {
    pipelineOptions.dtype = {
      encoder_model: 'fp32',
      decoder_model_merged: 'q4'
    };
  }

  transcriberPromise = pipeline('automatic-speech-recognition', modelId, pipelineOptions);
  return transcriberPromise;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, audioData, language } = event.data;

  if (type === 'TRANSCRIBE') {
    try {
      self.postMessage({ type: 'STATUS', status: 'loading_model' });
      const transcriber = await getTranscriber();

      self.postMessage({ type: 'STATUS', status: 'transcribing' });

      let result: any;
      const targetLang = language === 'hindi' ? 'hindi' : 'english';

      try {
        // Attempt word-level timestamps first
        result = await transcriber(audioData, {
          language: targetLang,
          task: 'transcribe',
          return_timestamps: 'word',
          chunk_length_s: 30,
          stride_length_s: 5
        });
        result.isSegmentLevelFallback = false;
      } catch (wordErr: any) {
        // Fall back to segment-level timestamps if model output lacks cross-attentions
        console.warn('Word-level timestamps unavailable, falling back to segment timestamps:', wordErr);
        result = await transcriber(audioData, {
          language: targetLang,
          task: 'transcribe',
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5
        });
        result.isSegmentLevelFallback = true;
      }

      self.postMessage({
        type: 'COMPLETE',
        result,
        language: targetLang,
        device: currentDevice
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
