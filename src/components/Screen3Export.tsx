import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, CheckCircle2, AlertTriangle, AlertCircle, Film, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { exportProjectVideo, verifyRenderedVideo, RenderProgress, ExportResult } from '../utils/ffmpegExporter';
import { isActualMemeClip } from '../utils/timelineMath';

export const Screen3Export: React.FC = () => {
  const { project, setScreen, bgMusic } = useEditorStore();

  const [isExporting, setIsExporting] = useState<boolean>(true);
  const [progress, setProgress] = useState<RenderProgress>({ ratio: 0, stage: 'Preparing media files...' });
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [verificationPassed, setVerificationPassed] = useState<boolean>(false);
  const [actualDuration, setActualDuration] = useState<number>(0);
  const [showDetails, setShowDetails] = useState<boolean>(false);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const runIdRef = useRef<number>(0);

  const startExport = async () => {
    if (!project) return;
    const currentRunId = ++runIdRef.current;
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }

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
        bgMusic
      );

      // Verification Gate (Step 3)
      setProgress({ ratio: 0.95, stage: 'Verifying output duration & stream integrity...' });

      const verification = await verifyRenderedVideo(
        res.blob,
        res.expectedDurationSec,
        res.hasAudio
      );

      if (!isMountedRef.current || currentRunId !== runIdRef.current) {
        URL.revokeObjectURL(res.blobUrl);
        return;
      }

      setActualDuration(verification.duration);
      setExportResult({ ...res, actualDurationSec: verification.duration });

      if (res.exitCode === 0 && res.fileSizeBytes > 10000 && verification.valid) {
        activeBlobUrlRef.current = res.blobUrl;
        setVerificationPassed(true);
        setIsExporting(false);
        setProgress({ ratio: 1, stage: 'Export Complete & Verified!' });
      } else {
        URL.revokeObjectURL(res.blobUrl);
        setVerificationPassed(false);
        setIsExporting(false);
        setRenderError(verification.error || 'Output MP4 failed integrity verification.');
      }
    } catch (err) {
      if (!isMountedRef.current || currentRunId !== runIdRef.current) return;
      setRenderError((err as Error).message || 'Failed to re-encode video.');
      setIsExporting(false);
      setVerificationPassed(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    startExport();
    return () => {
      isMountedRef.current = false;
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
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

  const activeClipsCount = project.items.filter(
    (it) => it.status !== 'DELETED' && (it.kind === 'SOURCE_CLIP' || it.meta?.isAddedClip)
  ).length;
  const actualMemesCount = project.items.filter(
    (it) => isActualMemeClip(it, project.sourceVideoUrl)
  ).length;
  const cutsCount = project.items.filter((it) => it.status === 'DELETED' && it.kind === 'SOURCE_CLIP').length;

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-[#181715] flex flex-col justify-between p-4 sm:p-6">
      {/* Top Header */}
      <header className="max-w-4xl mx-auto w-full flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-[#E5E2DC]">
        <button
          onClick={() => setScreen('WORKSPACE')}
          className="flex items-center space-x-2 text-xs font-medium text-[#181715] hover:text-[#000000] transition-colors bg-white hover:bg-[#F0EEE9] px-3 py-2 rounded-lg border border-[#E5E2DC] shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Workspace</span>
        </button>

        <div className="flex items-center space-x-2">
          <Film className="w-5 h-5 text-[#D96B27]" />
          <h1 className="text-base font-bold text-[#181715]">Export & Render Studio</h1>
        </div>

        <div className="hidden sm:block sm:w-24" />
      </header>

      {/* Main Export Content */}
      <main className="max-w-4xl mx-auto w-full my-6 space-y-6">
        {/* Visible Warnings for Preview-only items (Step 2.d) */}
        {exportResult && exportResult.warnings.length > 0 && (
          <div className="bg-[#FEF3C7] border border-[#F59E0B]/50 rounded-xl p-3 flex items-start space-x-2.5 text-xs text-[#92400E]">
            <AlertTriangle className="w-4 h-4 text-[#D97706] flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#92400E]">Notice:</span>
              <p>{exportResult.warnings.join(' ')}</p>
            </div>
          </div>
        )}

        {/* State A: Rendering in Progress */}
        {isExporting ? (
          <div className="bg-white border border-[#E5E2DC] shadow-sm rounded-2xl p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-[#F0EEE9] border border-[#E5E2DC] text-[#D96B27] mx-auto flex items-center justify-center animate-spin">
              <RefreshCw className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[#181715]">Rendering Your Final MP4</h3>
              <p className="text-xs text-[#66625B]">{progress.stage}</p>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-md mx-auto bg-[#E5E2DC] h-2.5 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                className="bg-[#D96B27] h-full transition-all duration-300"
              />
            </div>

            <p className="text-xs font-mono tabular-nums text-[#66625B]">
              {Math.round(progress.ratio * 100)}% • Rendering locally in your browser
            </p>
          </div>
        ) : !verificationPassed || renderError ? (
          /* State B: Verification or Render Failure (Step 3) */
          <div className="bg-[#FEE2E2]/60 border border-[#EF4444]/40 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#FEE2E2] text-[#DC2626] mx-auto flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#DC2626]">Export Verification Failed</h3>
              <p className="text-sm font-semibold text-[#B91C1C]">{renderError}</p>
              {exportResult && (
                <p className="text-xs text-[#66625B] font-mono tabular-nums mt-2">
                  Expected: {exportResult.expectedDurationSec.toFixed(2)}s | Actual: {actualDuration.toFixed(2)}s | Drift: {Math.abs(actualDuration - exportResult.expectedDurationSec).toFixed(3)}s
                </p>
              )}
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={startExport}
                className="px-4 py-2 bg-[#D96B27] hover:bg-[#C25A1B] text-white font-semibold rounded-lg text-xs transition-colors shadow-sm"
              >
                Retry Re-encode
              </button>
              <button
                onClick={() => setScreen('WORKSPACE')}
                className="px-4 py-2 bg-white hover:bg-[#F0EEE9] border border-[#E5E2DC] text-[#181715] rounded-lg text-xs font-medium transition-colors"
              >
                Back to Workspace
              </button>
            </div>
          </div>
        ) : (
          /* State C: Verification Passed */
          <div className="bg-white border border-[#E5E2DC] shadow-sm rounded-2xl p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E2DC] pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-[#0F766E]/15 text-[#0F766E] flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#181715]">Export Complete & Verified!</h3>
                  <p className="text-xs text-[#66625B] tabular-nums">
                    Duration: {actualDuration.toFixed(2)}s (Expected: {exportResult?.expectedDurationSec.toFixed(2)}s, Drift: {(Math.abs(actualDuration - (exportResult?.expectedDurationSec || 0)) * 1000).toFixed(0)}ms)
                  </p>
                </div>
              </div>

              <button
                onClick={handleDownload}
                className="flex items-center space-x-2 bg-[#D96B27] hover:bg-[#C25A1B] text-white font-semibold px-5 py-2.5 rounded-lg text-xs transition-all active:scale-95 shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>Download MP4</span>
              </button>
            </div>

            {/* Video Player */}
            {exportResult?.blobUrl && (
              <div className="aspect-video w-full max-w-2xl mx-auto bg-[#0B0B0A] rounded-xl overflow-hidden border border-[#D8D4CC]">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="bg-[#F7F6F2] border border-[#E5E2DC] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#8E8A82] tracking-wider">Cuts Applied</span>
                <p className="text-base font-bold text-[#D96B27] tabular-nums">{cutsCount} Cuts</p>
              </div>

              <div className="bg-[#F7F6F2] border border-[#E5E2DC] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#8E8A82] tracking-wider">Source Clips</span>
                <p className="text-base font-bold text-[#0F766E] tabular-nums">{activeClipsCount} Segments</p>
              </div>

              <div className="bg-[#F7F6F2] border border-[#E5E2DC] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#8E8A82] tracking-wider">Memes Spliced</span>
                <p className="text-base font-bold text-[#D96B27] tabular-nums">
                  {(() => {
                    const count = exportResult?.memesSplicedCount !== undefined ? exportResult.memesSplicedCount : actualMemesCount;
                    return `${count} ${count === 1 ? 'Meme' : 'Memes'}`;
                  })()}
                </p>
              </div>

              <div className="bg-[#F7F6F2] border border-[#E5E2DC] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#8E8A82] tracking-wider">Music Track</span>
                <p className={`text-base font-bold tabular-nums truncate ${exportResult?.bgMusicBaked ? 'text-[#0F766E]' : 'text-[#8E8A82]'}`} title={exportResult?.bgMusicName}>
                  {exportResult?.bgMusicBaked ? `${Math.round((exportResult.bgMusicVolume ?? 1) * 100)}%` : 'None'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Collapsible "Export details" Section */}
        {exportResult && (
          <div className="bg-white border border-[#E5E2DC] shadow-sm rounded-xl overflow-hidden">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-4 py-3 bg-[#F0EEE9] hover:bg-[#E7E4DD] flex items-center justify-between text-xs font-semibold text-[#181715] transition-colors"
            >
              <span>Export & Audio Details</span>
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDetails && (
              <div className="p-4 space-y-3 text-xs font-mono tabular-nums text-[#181715] border-t border-[#E5E2DC]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[#66625B]">Exit Code: </span>
                    <span className={exportResult.exitCode === 0 ? 'text-[#0F766E] font-bold' : 'text-[#DC2626] font-bold'}>
                      {exportResult.exitCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Elapsed Render Time: </span>
                    <span className="text-[#181715]">{(exportResult.elapsedTimeMs / 1000).toFixed(2)}s</span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Expected Duration: </span>
                    <span className="text-[#181715]">{exportResult.expectedDurationSec.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Actual Duration: </span>
                    <span className="text-[#181715]">{actualDuration.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Output Size: </span>
                    <span className="text-[#181715]">{(exportResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB ({exportResult.fileSizeBytes} bytes)</span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Audio Track: </span>
                    <span className="text-[#181715]">{exportResult.hasAudio ? 'Present (AAC 192k)' : 'Silent fallback (no source audio detected)'}</span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Speaker Voice Enhance: </span>
                    <span className={exportResult.voiceEnhanceBaked ? 'text-[#0F766E] font-bold' : 'text-[#8E8A82]'}>
                      {exportResult.voiceEnhanceBaked ? 'Baked into MP4 (85Hz HPF + 260Hz cut + 2.8kHz presence boost + Compressor + Limiter)' : 'Disabled'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Reduce Low Hum (Basic): </span>
                    <span className={exportResult.noiseRemovalBaked ? 'text-[#0F766E] font-bold' : 'text-[#8E8A82]'}>
                      {exportResult.noiseRemovalBaked ? 'Baked into MP4 (Cascaded 180Hz HPF + 6.2kHz LPF + Noise Gate)' : 'Disabled'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#66625B]">Background Music Track: </span>
                    <span className={exportResult.bgMusicBaked ? 'text-[#0F766E] font-bold' : 'text-[#8E8A82]'}>
                      {exportResult.bgMusicBaked ? `Baked into MP4: ${exportResult.bgMusicName} (Volume: ${Math.round((exportResult.bgMusicVolume ?? 1) * 100)}%, amix)` : 'Disabled / None'}
                    </span>
                  </div>
                </div>

                {/* Segments Table */}
                <div className="pt-2">
                  <span className="text-[#66625B] font-bold text-[10px] uppercase">Active Source Segments ({exportResult.segments.length}):</span>
                  <div className="mt-1 bg-[#F7F6F2] rounded p-2 border border-[#E5E2DC] text-[10px] space-y-1">
                    {exportResult.segments.map((seg) => (
                      <div key={seg.index} className="flex justify-between">
                        <span>Segment #{seg.index}: source [{seg.startSec.toFixed(3)}s → {seg.endSec.toFixed(3)}s]</span>
                        <span className="text-[#D96B27]">Duration: {seg.durSec.toFixed(3)}s</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* FFmpeg Arguments */}
                <div className="pt-2">
                  <span className="text-[#66625B] font-bold text-[10px] uppercase">FFmpeg Execution Arguments:</span>
                  <pre className="mt-1 bg-[#F7F6F2] p-2.5 rounded border border-[#E5E2DC] text-[10px] whitespace-pre-wrap break-all text-[#66625B]">
                    ffmpeg {exportResult.ffmpegArgs.join(' ')}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto w-full pt-4 border-t border-[#E5E2DC] text-center text-xs text-[#8E8A82] flex items-center justify-center">
        <span>Fastcutz.ai • Browser-First Creator Studio</span>
      </footer>
    </div>
  );
};
