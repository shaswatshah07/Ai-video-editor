import React, { useState } from 'react';
import { Upload, Wand2, ArrowRight, AlertCircle, FileVideo } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { TimelineItem } from '../types/edl';

export const Screen1Upload: React.FC = () => {
  const { loadProject, setScreen, toggleVoiceEnhance, toggleNoiseReduction, generateTranscript } = useEditorStore();

  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  // Auto Edit Checkboxes (4 options)
  const [autoOptions, setAutoOptions] = useState({
    transcript: true,
    timestamps: true,
    voiceEnhance: true,
    noiseReduction: true
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

      const items: TimelineItem[] = [
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

      loadProject(
        videoUrl,
        selectedFile.name,
        selectedFile.size,
        durationMs,
        items,
        false
      );

      if (isAutoMode) {
        if (autoOptions.voiceEnhance) toggleVoiceEnhance(true);
        if (autoOptions.noiseReduction) toggleNoiseReduction(true);
      }

      if (isAutoMode && autoOptions.transcript) {
        generateTranscript('accurate', 'translate_en');
      }

      setIsProcessing(false);
      setScreen('WORKSPACE');
    } catch {
      setErrorMsg('Failed to process video file. Ensure it is a valid H.264 MP4/MOV.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0E0E0D] text-[#F4F2EE] flex flex-col px-6 overflow-y-auto">
      {/* Top Reserved Open Hero Space */}
      <section
        id="hero-space"
        className="w-full max-w-6xl mx-auto min-h-[280px] md:min-h-[340px] flex flex-col items-center justify-center pt-12 pb-8"
      />

      {/* Main Content Area: Upload & Mode Selection */}
      <main className="max-w-6xl mx-auto w-full pb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Drag & Drop Dropzone */}
        <div className="lg:col-span-7 space-y-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all ${
              isDragging
                ? 'border-[#E8872A] bg-[#E8872A]/10 scale-[1.01]'
                : selectedFile
                ? 'border-[#2DD4BF]/50 bg-[#14B8A6]/10'
                : 'border-[#2C2B28] hover:border-[#45423C] bg-[#161614]'
            }`}
          >
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={handleFileInput}
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={isProcessing}
            />

            <div className="w-16 h-16 rounded-2xl bg-[#1F1E1C] border border-[#2C2B28] flex items-center justify-center mb-4">
              {selectedFile ? (
                <FileVideo className="w-8 h-8 text-[#5EEAD4]" />
              ) : (
                <Upload className="w-8 h-8 text-[#A19E97]" />
              )}
            </div>

            {selectedFile ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#5EEAD4]">{selectedFile.name}</p>
                <p className="text-xs text-[#A19E97] tabular-nums">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready for processing
                </p>
                <span className="inline-block mt-2 text-xs text-[#E8872A] hover:underline cursor-pointer">
                  Click or drag to change file
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-base font-medium text-[#F4F2EE]">
                  Drag and drop your video here, or <span className="text-[#E8872A] font-semibold underline">browse files</span>
                </p>
                <p className="text-xs text-[#6E6B64]">
                  Supports MP4, MOV, and WebM • Max 250 MB • Max 5 minutes
                </p>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="flex items-center space-x-2 p-3 bg-[#DC2626]/12 border border-[#EF4444]/40 rounded-xl text-[#F87171] text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isProcessing && (
            <div className="p-4 bg-[#1F1E1C] border border-[#2C2B28] rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-[#F4F2EE]">
                <span className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-[#E8872A] animate-ping" />
                  <span>{processingStatus}</span>
                </span>
              </div>
              <div className="w-full bg-[#161614] h-1.5 rounded-full overflow-hidden">
                <div className="bg-[#E8872A] h-full w-2/3 animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Mode Selection (Auto Edit vs Custom Edit) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card A: Auto Edit Recipes */}
          <div className="bg-[#161614] border border-[#2C2B28] rounded-2xl p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-[#1F1E1C] border border-[#2C2B28] text-[#E8872A] flex items-center justify-center">
                <Wand2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#F4F2EE]">Mode A: AI Auto-Edit</h3>
                <p className="text-xs text-[#A19E97]">Select automated enhancements to apply</p>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              {[
                { key: 'transcript', label: 'Generate Word-Level Transcript' },
                { key: 'timestamps', label: 'Create Chapter Timestamps' },
                { key: 'voiceEnhance', label: 'Enhance speaker audio' },
                { key: 'noiseReduction', label: 'Remove background noise' }
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center space-x-3 text-xs text-[#A19E97] cursor-pointer select-none hover:text-[#F4F2EE] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={autoOptions[key as keyof typeof autoOptions]}
                    onChange={(e) =>
                      setAutoOptions({ ...autoOptions, [key]: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-[#2C2B28] text-[#E8872A] focus:ring-[#E8872A]/40 bg-[#1F1E1C]"
                  />
                  <span className="flex items-center space-x-2">
                    <span>{label}</span>
                  </span>
                </label>
              ))}
            </div>

            <button
              onClick={() => handleStartEditing(true)}
              disabled={!selectedFile || isProcessing}
              className="w-full flex items-center justify-center space-x-2 bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] font-semibold py-2.5 px-4 rounded-lg text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-none active:scale-[0.99]"
            >
              <span>Start Auto Edit</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Card B: Custom Edit */}
          <div className="bg-[#161614] border border-[#2C2B28] rounded-2xl p-5 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-[#F4F2EE]">Mode B: Custom Edit</h4>
              <p className="text-xs text-[#A19E97]">Direct workspace access without auto changes</p>
            </div>
            <button
              onClick={() => handleStartEditing(false)}
              disabled={!selectedFile || isProcessing}
              className="px-4 py-2 bg-[#23221F] hover:bg-[#2E2C28] border border-[#35332F] text-[#E6E3DC] text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
            >
              Custom Edit
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto w-full pt-4 pb-6 border-t border-[#2C2B28] text-center text-xs text-[#6E6B64] mt-auto">
        AI Video Editor • 100% Client-Side Processing • Scaler YIIC 9.0 Week 2
      </footer>
    </div>
  );
};
