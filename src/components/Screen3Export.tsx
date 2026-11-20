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
    <div className="min-h-screen bg-[#0E0E0D] text-[#F4F2EE] flex flex-col justify-between p-6">
      {/* Top Header */}
      <header className="max-w-4xl mx-auto w-full flex items-center justify-between pb-6 border-b border-[#2C2B28]">
        <button
          onClick={() => setScreen('WORKSPACE')}
          className="flex items-center space-x-2 text-xs font-medium text-[#E6E3DC] hover:text-white transition-colors bg-[#23221F] hover:bg-[#2E2C28] px-3 py-2 rounded-lg border border-[#35332F]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Workspace</span>
        </button>

        <div className="flex items-center space-x-2">
          <Film className="w-5 h-5 text-[#E8872A]" />
          <h1 className="text-base font-bold text-[#F4F2EE]">Export & Render Studio</h1>
        </div>

        <div className="w-24" />
      </header>

      {/* Main Export Content */}
      <main className="max-w-4xl mx-auto w-full my-6 space-y-6">
        {/* Visible Warnings for Preview-only items (Step 2.d) */}
        {exportResult && exportResult.warnings.length > 0 && (
          <div className="bg-[#D97706]/15 border border-[#F59E0B]/50 rounded-xl p-3 flex items-start space-x-2.5 text-xs text-[#FCD34D]">
            <AlertTriangle className="w-4 h-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#FCD34D]">Notice:</span>
              <p>{exportResult.warnings.join(' ')}</p>
            </div>
          </div>
        )}

        {/* State A: Rendering in Progress */}
        {isExporting ? (
          <div className="bg-[#161614] border border-[#2C2B28] rounded-2xl p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-[#1F1E1C] border border-[#2C2B28] text-[#E8872A] mx-auto flex items-center justify-center animate-spin">
              <RefreshCw className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[#F4F2EE]">Re-encoding Video (1-Pass Concat)</h3>
              <p className="text-xs text-[#A19E97]">{progress.stage}</p>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-md mx-auto bg-[#1F1E1C] border border-[#2C2B28] h-2.5 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                className="bg-[#E8872A] h-full transition-all duration-300"
              />
            </div>

            <p className="text-xs font-mono tabular-nums text-[#A19E97]">
              {Math.round(progress.ratio * 100)}% • 100% in-browser WebAssembly re-encode
            </p>
          </div>
        ) : !verificationPassed || renderError ? (
          /* State B: Verification or Render Failure (Step 3) */
          <div className="bg-[#DC2626]/12 border border-[#EF4444]/40 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#DC2626]/20 text-[#F87171] mx-auto flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#F87171]">Export Verification Failed</h3>
              <p className="text-sm font-semibold text-[#FCA5A5]">{renderError}</p>
              {exportResult && (
                <p className="text-xs text-[#A19E97] font-mono tabular-nums mt-2">
                  Expected: {exportResult.expectedDurationSec.toFixed(2)}s | Actual: {actualDuration.toFixed(2)}s | Drift: {Math.abs(actualDuration - exportResult.expectedDurationSec).toFixed(3)}s
                </p>
              )}
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={startExport}
                className="px-4 py-2 bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] font-semibold rounded-lg text-xs transition-colors"
              >
                Retry Re-encode
              </button>
              <button
                onClick={() => setScreen('WORKSPACE')}
                className="px-4 py-2 bg-[#23221F] hover:bg-[#2E2C28] border border-[#35332F] text-[#E6E3DC] rounded-lg text-xs font-medium transition-colors"
              >
                Back to Workspace
              </button>
            </div>
          </div>
        ) : (
          /* State C: Verification Passed */
          <div className="bg-[#161614] border border-[#2C2B28] rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-[#2C2B28] pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-[#14B8A6]/20 text-[#5EEAD4] flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#F4F2EE]">Export Complete & Verified!</h3>
                  <p className="text-xs text-[#A19E97] tabular-nums">
                    Duration: {actualDuration.toFixed(2)}s (Expected: {exportResult?.expectedDurationSec.toFixed(2)}s, Drift: {(Math.abs(actualDuration - (exportResult?.expectedDurationSec || 0)) * 1000).toFixed(0)}ms)
                  </p>
                </div>
              </div>

              <button
                onClick={handleDownload}
                className="flex items-center space-x-2 bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] font-semibold px-5 py-2.5 rounded-lg text-xs transition-all active:scale-95 shadow-none"
              >
                <Download className="w-4 h-4" />
                <span>Download MP4</span>
              </button>
            </div>

            {/* Video Player */}
            {exportResult?.blobUrl && (
              <div className="aspect-video w-full max-w-2xl mx-auto bg-black rounded-xl overflow-hidden border border-[#2C2B28]">
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
              <div className="bg-[#1F1E1C] border border-[#2C2B28] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#A19E97] tracking-wider">Cuts Applied</span>
                <p className="text-base font-bold text-[#E8872A] tabular-nums">{cutsCount} Cuts</p>
              </div>

              <div className="bg-[#1F1E1C] border border-[#2C2B28] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#A19E97] tracking-wider">Source Clips</span>
                <p className="text-base font-bold text-[#5EEAD4] tabular-nums">{activeClipsCount} Segments</p>
              </div>

              <div className="bg-[#1F1E1C] border border-[#2C2B28] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#A19E97] tracking-wider">Memes Spliced</span>
                <p className="text-base font-bold text-[#FDA4AF] tabular-nums">{exportResult?.memesSplicedCount ?? activeMemesCount} Memes</p>
              </div>

              <div className="bg-[#1F1E1C] border border-[#2C2B28] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#A19E97] tracking-wider">Voice Enhance</span>
                <p className={`text-base font-bold tabular-nums ${exportResult?.voiceEnhanceBaked ? 'text-[#5EEAD4]' : 'text-[#6E6B64]'}`}>
                  {exportResult?.voiceEnhanceBaked ? 'Baked In' : 'Off'}
                </p>
              </div>

              <div className="bg-[#1F1E1C] border border-[#2C2B28] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#A19E97] tracking-wider">Noise Removal</span>
                <p className={`text-base font-bold tabular-nums ${exportResult?.noiseRemovalBaked ? 'text-[#5EEAD4]' : 'text-[#6E6B64]'}`}>
                  {exportResult?.noiseRemovalBaked ? 'Baked In' : 'Off'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Collapsible "Export details" Section */}
        {exportResult && (
          <div className="bg-[#161614] border border-[#2C2B28] rounded-xl overflow-hidden">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-4 py-3 bg-[#1F1E1C] hover:bg-[#292825] flex items-center justify-between text-xs font-semibold text-[#F4F2EE] transition-colors"
            >
              <span>Export Details & Diagnostic Evidence</span>
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDetails && (
              <div className="p-4 space-y-3 text-xs font-mono tabular-nums text-[#F4F2EE] border-t border-[#2C2B28]">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[#A19E97]">Exit Code: </span>
                    <span className={exportResult.exitCode === 0 ? 'text-[#5EEAD4] font-bold' : 'text-[#F87171] font-bold'}>
                      {exportResult.exitCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#A19E97]">Elapsed Render Time: </span>
                    <span className="text-[#F4F2EE]">{(exportResult.elapsedTimeMs / 1000).toFixed(2)}s</span>
                  </div>
                  <div>
                    <span className="text-[#A19E97]">Expected Duration: </span>
                    <span className="text-[#F4F2EE]">{exportResult.expectedDurationSec.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-[#A19E97]">Actual Duration: </span>
                    <span className="text-[#F4F2EE]">{actualDuration.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-[#A19E97]">Output Size: </span>
                    <span className="text-[#F4F2EE]">{(exportResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB ({exportResult.fileSizeBytes} bytes)</span>
                  </div>
                  <div>
                    <span className="text-[#A19E97]">Audio Track: </span>
                    <span className="text-[#F4F2EE]">{exportResult.hasAudio ? 'Present (AAC 192k)' : 'None'}</span>
                  </div>
                  <div>
                    <span className="text-[#A19E97]">Speaker Voice Enhance: </span>
                    <span className={exportResult.voiceEnhanceBaked ? 'text-[#5EEAD4] font-bold' : 'text-[#6E6B64]'}>
                      {exportResult.voiceEnhanceBaked ? 'Baked into MP4 (90Hz HPF + 280Hz cut + 2.5kHz boost + 6.5kHz treble cut + Compressor + Loudnorm)' : 'Disabled'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#A19E97]">Background Noise Removal: </span>
                    <span className={exportResult.noiseRemovalBaked ? 'text-[#5EEAD4] font-bold' : 'text-[#6E6B64]'}>
                      {exportResult.noiseRemovalBaked ? 'Baked into MP4 (Adaptive STFT Wiener Spectral Denoiser)' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {/* Segments Table */}
                <div className="pt-2">
                  <span className="text-[#A19E97] font-bold text-[10px] uppercase">Active Source Segments ({exportResult.segments.length}):</span>
                  <div className="mt-1 bg-[#0E0E0D] rounded p-2 border border-[#2C2B28] text-[10px] space-y-1">
                    {exportResult.segments.map((seg) => (
                      <div key={seg.index} className="flex justify-between">
                        <span>Segment #{seg.index}: source [{seg.startSec.toFixed(3)}s → {seg.endSec.toFixed(3)}s]</span>
                        <span className="text-[#E8872A]">Duration: {seg.durSec.toFixed(3)}s</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* FFmpeg Arguments */}
                <div className="pt-2">
                  <span className="text-[#A19E97] font-bold text-[10px] uppercase">FFmpeg Execution Arguments:</span>
                  <pre className="mt-1 bg-[#0E0E0D] p-2.5 rounded border border-[#2C2B28] text-[10px] whitespace-pre-wrap break-all text-[#A19E97]">
                    ffmpeg {exportResult.ffmpegArgs.join(' ')}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto w-full pt-4 border-t border-[#2C2B28] text-center text-xs text-[#6E6B64] flex items-center justify-between">
        <span>AI Video Editor • Frame-Accurate Re-encode Engine</span>
        <span>Scaler YIIC 9.0 Week 2</span>
      </footer>
    </div>
  );
};
