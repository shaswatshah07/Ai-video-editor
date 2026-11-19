import React, { useState } from 'react';
import { Upload, Sparkles, Wand2, CheckCircle2, ArrowRight, Play, AlertCircle, FileVideo } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { generateSampleDemoVideo } from '../utils/sampleDemoGenerator';
import { detectSilenceInVideo, injectSilenceCutsIntoTimeline } from '../utils/silenceDetector';
import { TimelineItem } from '../types/edl';

export const Screen1Upload: React.FC = () => {
  const { loadProject, setScreen, toggleVoiceEnhance, toggleNoiseReduction, generateTranscript } = useEditorStore();

  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  // Auto Edit Checkboxes (6 options)
  const [autoOptions, setAutoOptions] = useState({
    transcript: true,
    timestamps: true,
    voiceEnhance: true,
    noiseReduction: true,
    detectSilence: true,
    suggestMemes: true
  });

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    setErrorMsg(null);

    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const validateAndSetFile = (file: File) => {
    const validExtensions = ['mp4', 'mov', 'webm'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (!validExtensions.includes(ext)) {
      setErrorMsg('Please upload a valid .mp4, .mov, or .webm video file.');
      return;
    }

    // Guardrail: Max 250 MB
    if (file.size > 250 * 1024 * 1024) {
      setErrorMsg('File size exceeds the 250 MB guardrail limit for browser processing.');
      return;
    }

    setSelectedFile(file);
  };

  const handleLoadSampleDemo = async () => {
    setIsProcessing(true);
    setProcessingStatus('Generating 30s sample talking-head demo with deliberate pauses...');

    try {
      const demo = await generateSampleDemoVideo((pct) => {
        setProcessingStatus(`Synthesizing demo video & speech rhythms (${pct}%)...`);
      });

      setProcessingStatus('Configuring timeline with sample transcript & detected silences...');

      // Load into store (with isDemoSample = true)
      loadProject(
        demo.videoUrl,
        'Scaler_YIIC_30s_Demo.mp4',
        demo.blob.size || 1500000,
        demo.durationMs,
        demo.initialItems,
        true
      );

      // Apply audio enhancements if checked
      if (autoOptions.voiceEnhance) toggleVoiceEnhance(true);
      if (autoOptions.noiseReduction) toggleNoiseReduction(true);

      setTimeout(() => {
        setIsProcessing(false);
        setScreen('WORKSPACE');
      }, 400);
    } catch {
      setErrorMsg('Could not synthesize sample demo. Please select a local video file.');
      setIsProcessing(false);
    }
  };

  const handleStartEditing = async (isAutoMode: boolean) => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setProcessingStatus('Analyzing video container and duration...');

    try {
      const videoUrl = URL.createObjectURL(selectedFile);
      const tempVideo = document.createElement('video');
      tempVideo.src = videoUrl;

      await new Promise<void>((resolve, reject) => {
        tempVideo.onloadedmetadata = () => resolve();
        tempVideo.onerror = () => reject(new Error('Invalid video file'));
      });

      const durationMs = Math.round((tempVideo.duration || 10) * 1000);

      // Guardrail: Max 5 minutes (300,000 ms)
      if (durationMs > 300000) {
        setErrorMsg('Video exceeds the 5-minute guardrail limit for real-time browser processing.');
        setIsProcessing(false);
        return;
      }

      let items: TimelineItem[] = [
        {
          id: 'clip_root_upload',
          kind: 'SOURCE_CLIP',
          title: selectedFile.name,
          blobUrl: videoUrl,
          sourceStartMs: 0,
          sourceEndMs: durationMs,
          durationMs: durationMs,
          projectStartMs: 0,
          projectEndMs: durationMs,
          status: 'ACTIVE',
          transitionOut: { type: 'none', durationMs: 0 }
        }
      ];

      if (isAutoMode) {
        if (autoOptions.detectSilence) {
          setProcessingStatus('Scanning audio RMS energy for awkward pauses (Normal preset)...');
          const { silences } = await detectSilenceInVideo(selectedFile, durationMs, 'Normal');
          items = injectSilenceCutsIntoTimeline(items, silences);
        }

        if (autoOptions.voiceEnhance) toggleVoiceEnhance(true);
        if (autoOptions.noiseReduction) toggleNoiseReduction(true);
      }

      loadProject(
        videoUrl,
        selectedFile.name,
        selectedFile.size,
        durationMs,
        items,
        false
      );

      if (isAutoMode && autoOptions.transcript) {
        generateTranscript('english');
      }

      setIsProcessing(false);
      setScreen('WORKSPACE');
    } catch {
      setErrorMsg('Failed to process video file. Ensure it is a valid H.264 MP4/MOV.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1117] text-gray-100 flex flex-col justify-between p-6">
      {/* Top Navigation Bar */}
      <header className="max-w-6xl mx-auto w-full flex items-center justify-between pb-6 border-b border-gray-800">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-200 to-indigo-300 bg-clip-text text-transparent">
              AI Video Editor Studio
            </h1>
            <p className="text-xs text-gray-400">Strict ₹0 Budget • Browser-First InShot Workflow</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={async () => {
              setIsProcessing(true);
              setProcessingStatus('Loading real 61.7s video asset...');
              try {
                const resp = await fetch('/test_video.mp4');
                const blob = await resp.blob();
                const file = new File([blob], 'WhatsApp_Video_61.7s.mp4', { type: 'video/mp4' });
                setSelectedFile(file);
              } catch {
                setErrorMsg('Could not fetch public/test_video.mp4');
              } finally {
                setIsProcessing(false);
              }
            }}
            disabled={isProcessing}
            className="flex items-center space-x-2 bg-indigo-700 hover:bg-indigo-600 px-3.5 py-2.5 rounded-xl font-medium text-xs text-white shadow-md transition-all active:scale-95 disabled:opacity-50"
            title="Load the real 61.7s vertical WhatsApp test video directly"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Load Real 61.7s Video</span>
          </button>

          <button
            onClick={handleLoadSampleDemo}
            disabled={isProcessing}
            className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-3.5 py-2.5 rounded-xl font-medium text-xs text-white shadow-lg shadow-emerald-900/30 transition-all transform active:scale-95 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Load 30s Demo Video</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto w-full my-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Drag & Drop Dropzone */}
        <div className="lg:col-span-7 space-y-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all ${
              isDragging
                ? 'border-indigo-500 bg-indigo-500/10 scale-[1.01]'
                : selectedFile
                ? 'border-emerald-500/50 bg-emerald-950/10'
                : 'border-gray-700 hover:border-gray-600 bg-gray-900/50'
            }`}
          >
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={handleFileInput}
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={isProcessing}
            />

            <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4 text-indigo-400">
              {selectedFile ? (
                <FileVideo className="w-8 h-8 text-emerald-400" />
              ) : (
                <Upload className="w-8 h-8" />
              )}
            </div>

            {selectedFile ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-emerald-300">{selectedFile.name}</p>
                <p className="text-xs text-gray-400">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready for processing
                </p>
                <span className="inline-block mt-2 text-xs text-indigo-400 underline">
                  Click or drag to change file
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-base font-medium text-gray-200">
                  Drag and drop your video here, or <span className="text-indigo-400 font-semibold underline">browse files</span>
                </p>
                <p className="text-xs text-gray-500">
                  Supports MP4, MOV, and WebM • Max 250 MB • Max 5 minutes
                </p>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="flex items-center space-x-2 p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isProcessing && (
            <div className="p-4 bg-indigo-950/40 border border-indigo-800/60 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-indigo-200">
                <span className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                  <span>{processingStatus}</span>
                </span>
              </div>
              <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-indigo-500 h-full w-2/3 animate-pulse" />
              </div>
            </div>
          )}

          {/* Quick evaluation notice */}
          <div className="bg-gray-900/60 border border-gray-800 p-4 rounded-xl flex items-start space-x-3 text-xs text-gray-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-300">Fast YIIC Evaluator Note:</p>
              <p>
                Don't have a talking-head video handy? Click the green <strong>"Load 30s Sample Demo Video"</strong> button at top right to instantly generate a playable demo with pre-configured pauses and transcripts.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Mode Selection (Auto Edit vs Custom Edit) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card A: Auto Edit Recipes */}
          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <Wand2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Mode A: AI Auto-Edit</h3>
                <p className="text-xs text-gray-400">Select automated enhancements to apply</p>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              {[
                { key: 'transcript', label: 'Generate Word-Level Transcript' },
                { key: 'timestamps', label: 'Create Chapter Timestamps' },
                { key: 'voiceEnhance', label: 'Enhance Voice (+3dB 3kHz EQ & Compressor)' },
                { key: 'noiseReduction', label: 'Low-Cut Filter (80-120Hz AC & Rumble Attenuation)' },
                { key: 'detectSilence', label: 'Detect Awkward Silences (>800ms Pauses)' },
                { key: 'suggestMemes', label: 'Enable Meme Reaction Library' },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center space-x-3 text-xs text-gray-300 cursor-pointer select-none hover:text-white"
                >
                  <input
                    type="checkbox"
                    checked={autoOptions[key as keyof typeof autoOptions]}
                    onChange={(e) =>
                      setAutoOptions({ ...autoOptions, [key]: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-gray-700 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900 bg-gray-800"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <button
              onClick={() => handleStartEditing(true)}
              disabled={!selectedFile || isProcessing}
              className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20"
            >
              <span>Start Auto Edit</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Card B: Custom Edit */}
          <div className="bg-gray-900/40 border border-gray-800/80 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-200">Mode B: Custom Edit</h4>
              <p className="text-xs text-gray-400">Direct workspace access without auto changes</p>
            </div>
            <button
              onClick={() => handleStartEditing(false)}
              disabled={!selectedFile || isProcessing}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium rounded-xl transition-colors disabled:opacity-40"
            >
              Custom Edit
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto w-full pt-4 border-t border-gray-900 text-center text-xs text-gray-600">
        AI Video Editor • 100% Client-Side Processing • Scaler YIIC 9.0 Week 2
      </footer>
    </div>
  );
};
