import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, CheckCircle2, AlertTriangle, AlertCircle, Film, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { exportProjectVideo, verifyRenderedVideo, RenderProgress, ExportResult } from '../utils/ffmpegExporter';

export const Screen3Export: React.FC = () => {
  const { project, setScreen, denoisedAudioBlob } = useEditorStore();

  const [isExporting, setIsExporting] = useState<boolean>(true);
  const [progress, setProgress] = useState<RenderProgress>({ ratio: 0, stage: 'Preparing media files...' });
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [verificationPassed, setVerificationPassed] = useState<boolean>(false);
  const [actualDuration, setActualDuration] = useState<number>(0);
  const [showDetails, setShowDetails] = useState<boolean>(false);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const startExport = async () => {
    if (!project) return;
    setIsExporting(true);
    setRenderError(null);
    setVerificationPassed(false);
    setExportResult(null);

    try {
      const res = await exportProjectVideo(
        project,
        (p) => {
          setProgress(p);
        },
        denoisedAudioBlob
      );

      // Verification Gate (Step 3)
      setProgress({ ratio: 0.95, stage: 'Verifying output duration & stream integrity...' });

      const verification = await verifyRenderedVideo(
        res.blob,
        res.expectedDurationSec,
        res.hasAudio
      );

      if (!verification.valid) {
        setActualDuration(verification.duration);
        setExportResult({ ...res, actualDurationSec: verification.duration });
        setVerificationPassed(false);
        setIsExporting(false);
        setRenderError(
          `Export failed: expected ${res.expectedDurationSec.toFixed(1)} s but the file is ${verification.duration.toFixed(1)} s`
        );
        return;
      }

      setActualDuration(verification.duration);
      setExportResult({ ...res, actualDurationSec: verification.duration });
      setVerificationPassed(true);
      setIsExporting(false);
      setProgress({ ratio: 1, stage: 'Export Complete & Verified!' });
    } catch (err) {
      setRenderError((err as Error).message || 'Failed to re-encode video.');
      setIsExporting(false);
      setVerificationPassed(false);
    }
  };

  useEffect(() => {
    startExport();
    return () => {
      if (exportResult?.blobUrl) {
        URL.revokeObjectURL(exportResult.blobUrl);
      }
    };
  }, []);

  if (!project) return null;

  const handleDownload = () => {
    if (!exportResult?.blobUrl) return;
    const a = document.createElement('a');
    a.href = exportResult.blobUrl;
    a.download = `${project.title}_edited.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const activeClipsCount = project.items.filter(it => it.status === 'ACTIVE' && it.kind === 'SOURCE_CLIP').length;
  const activeMemesCount = project.items.filter(it => (it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME') && it.kind === 'MEME_CLIP').length;
  const cutsCount = project.items.filter(it => it.status === 'DELETED').length;

  return (
    <div className="min-h-screen bg-[#0F1117] text-gray-100 flex flex-col justify-between p-6">
      {/* Top Header */}
      <header className="max-w-4xl mx-auto w-full flex items-center justify-between pb-6 border-b border-gray-800">
        <button
          onClick={() => setScreen('WORKSPACE')}
          className="flex items-center space-x-2 text-xs font-medium text-gray-400 hover:text-white transition-colors bg-gray-850 hover:bg-gray-800 px-3 py-2 rounded-xl border border-gray-750"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Workspace</span>
        </button>

        <div className="flex items-center space-x-2">
          <Film className="w-5 h-5 text-indigo-400" />
          <h1 className="text-base font-bold text-gray-200">Export & Render Studio</h1>
        </div>

        <div className="w-24" />
      </header>

      {/* Main Export Content */}
      <main className="max-w-4xl mx-auto w-full my-6 space-y-6">
        {/* Visible Warnings for Preview-only items (Step 2.d) */}
        {exportResult && exportResult.warnings.length > 0 && (
          <div className="bg-amber-950/40 border border-amber-600/60 rounded-xl p-3 flex items-start space-x-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-amber-300">Notice:</span>
              <p>{exportResult.warnings.join(' ')}</p>
            </div>
          </div>
        )}

        {/* State A: Rendering in Progress */}
        {isExporting ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-indigo-600/20 text-indigo-400 mx-auto flex items-center justify-center animate-spin">
              <RefreshCw className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-white">Re-encoding Video (1-Pass Concat)</h3>
              <p className="text-xs text-gray-400">{progress.stage}</p>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-md mx-auto bg-gray-800 h-2.5 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-full transition-all duration-300"
              />
            </div>

            <p className="text-xs font-mono text-gray-500">
              {Math.round(progress.ratio * 100)}% • 100% in-browser WebAssembly re-encode
            </p>
          </div>
        ) : !verificationPassed || renderError ? (
          /* State B: Verification or Render Failure (Step 3) */
          <div className="bg-red-950/40 border border-red-800/80 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-600/20 text-red-400 mx-auto flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-red-300">Export Verification Failed</h3>
              <p className="text-sm font-semibold text-red-400">{renderError}</p>
              {exportResult && (
                <p className="text-xs text-gray-400 font-mono mt-2">
                  Expected: {exportResult.expectedDurationSec.toFixed(2)}s | Actual: {actualDuration.toFixed(2)}s | Drift: {Math.abs(actualDuration - exportResult.expectedDurationSec).toFixed(3)}s
                </p>
              )}
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={startExport}
                className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-xl text-xs font-medium transition-colors"
              >
                Retry Re-encode
              </button>
              <button
                onClick={() => setScreen('WORKSPACE')}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-xs font-medium transition-colors"
              >
                Back to Workspace
              </button>
            </div>
          </div>
        ) : (
          /* State C: Verification Passed */
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-gray-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Export Complete & Verified!</h3>
                  <p className="text-xs text-gray-400">
                    Duration: {actualDuration.toFixed(2)}s (Expected: {exportResult?.expectedDurationSec.toFixed(2)}s, Drift: {(Math.abs(actualDuration - (exportResult?.expectedDurationSec || 0)) * 1000).toFixed(0)}ms)
                  </p>
                </div>
              </div>

              <button
                onClick={handleDownload}
                className="flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold px-5 py-2.5 rounded-xl text-xs shadow-lg shadow-emerald-900/30 transition-all active:scale-95"
              >
                <Download className="w-4 h-4" />
                <span>Download MP4</span>
              </button>
            </div>

            {/* Video Player */}
            {exportResult?.blobUrl && (
              <div className="aspect-video w-full max-w-2xl mx-auto bg-black rounded-xl overflow-hidden border border-gray-800 shadow-xl">
                <video
                  ref={previewVideoRef}
                  src={exportResult.blobUrl}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            {/* Edit Summary Card */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Cuts Applied</span>
                <p className="text-base font-bold text-indigo-400">{cutsCount} Cuts</p>
              </div>

              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Source Clips</span>
                <p className="text-base font-bold text-emerald-400">{activeClipsCount} Segments</p>
              </div>

              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Memes Spliced</span>
                <p className="text-base font-bold text-purple-400">{exportResult?.memesSplicedCount ?? activeMemesCount} Memes</p>
              </div>

              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Voice Enhance</span>
                <p className={`text-base font-bold ${exportResult?.voiceEnhanceBaked ? 'text-emerald-400' : 'text-gray-500'}`}>
                  {exportResult?.voiceEnhanceBaked ? 'Baked In' : 'Off'}
                </p>
              </div>

              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Noise Removal</span>
                <p className={`text-base font-bold ${exportResult?.noiseRemovalBaked ? 'text-indigo-400' : 'text-gray-500'}`}>
                  {exportResult?.noiseRemovalBaked ? 'Baked In' : 'Off'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Collapsible "Export details" Section */}
        {exportResult && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-4 py-3 bg-gray-850 hover:bg-gray-800 flex items-center justify-between text-xs font-semibold text-gray-200 transition-colors"
            >
              <span>Export Details & Diagnostic Evidence</span>
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDetails && (
              <div className="p-4 space-y-3 text-xs font-mono text-gray-300 border-t border-gray-800">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-gray-500">Exit Code: </span>
                    <span className={exportResult.exitCode === 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      {exportResult.exitCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Elapsed Render Time: </span>
                    <span className="text-gray-200">{(exportResult.elapsedTimeMs / 1000).toFixed(2)}s</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Expected Duration: </span>
                    <span className="text-gray-200">{exportResult.expectedDurationSec.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Actual Duration: </span>
                    <span className="text-gray-200">{actualDuration.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Output Size: </span>
                    <span className="text-gray-200">{(exportResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB ({exportResult.fileSizeBytes} bytes)</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Audio Track: </span>
                    <span className="text-gray-200">{exportResult.hasAudio ? 'Present (AAC 192k)' : 'None'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Speaker Voice Enhance: </span>
                    <span className={exportResult.voiceEnhanceBaked ? 'text-emerald-400 font-bold' : 'text-gray-400'}>
                      {exportResult.voiceEnhanceBaked ? 'Baked into MP4 (90Hz HPF + 280Hz cut + 2.5kHz boost + 6.5kHz treble cut + Compressor + Loudnorm)' : 'Disabled'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Background Noise Removal: </span>
                    <span className={exportResult.noiseRemovalBaked ? 'text-indigo-400 font-bold' : 'text-gray-400'}>
                      {exportResult.noiseRemovalBaked ? 'Baked into MP4 (Adaptive STFT Wiener Spectral Denoiser)' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {/* Segments Table */}
                <div className="pt-2">
                  <span className="text-gray-500 font-bold text-[10px] uppercase">Active Source Segments ({exportResult.segments.length}):</span>
                  <div className="mt-1 bg-gray-950 rounded p-2 border border-gray-800 text-[10px] space-y-1">
                    {exportResult.segments.map((seg) => (
                      <div key={seg.index} className="flex justify-between">
                        <span>Segment #{seg.index}: source [{seg.startSec.toFixed(3)}s → {seg.endSec.toFixed(3)}s]</span>
                        <span className="text-indigo-400">Duration: {seg.durSec.toFixed(3)}s</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* FFmpeg Arguments */}
                <div className="pt-2">
                  <span className="text-gray-500 font-bold text-[10px] uppercase">FFmpeg Execution Arguments:</span>
                  <pre className="mt-1 bg-gray-950 p-2.5 rounded border border-gray-800 text-[10px] whitespace-pre-wrap break-all text-gray-400">
                    ffmpeg {exportResult.ffmpegArgs.join(' ')}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto w-full pt-4 border-t border-gray-900 text-center text-xs text-gray-600 flex items-center justify-between">
        <span>AI Video Editor • Frame-Accurate Re-encode Engine</span>
        <span>Scaler YIIC 9.0 Week 2</span>
      </footer>
    </div>
  );
};
