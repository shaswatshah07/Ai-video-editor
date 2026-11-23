import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, CheckCircle2, AlertTriangle, AlertCircle, Film, RefreshCw, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { exportProjectVideo, verifyRenderedVideo, RenderProgress, ExportResult } from '../utils/ffmpegExporter';
import { isActualMemeClip } from '../utils/timelineMath';
import { logExportEvent, submitUserFeedback } from '../utils/supabaseClient';
import { ThemeToggle } from './ThemeToggle';

export const Screen3Export: React.FC = () => {
  const { project, setScreen, bgMusic } = useEditorStore();

  const [isExporting, setIsExporting] = useState<boolean>(true);
  const [progress, setProgress] = useState<RenderProgress>({ ratio: 0, stage: 'Preparing media files...' });
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [verificationPassed, setVerificationPassed] = useState<boolean>(false);
  const [actualDuration, setActualDuration] = useState<number>(0);
  const [showDetails, setShowDetails] = useState<boolean>(false);

  // Silent 1x Export logging tracking ref
  const loggedExportRef = useRef<string | null>(null);

  // Quick Feedback state
  const [feedbackRating, setFeedbackRating] = useState<number>(0);
  const [feedbackHover, setFeedbackHover] = useState<number>(0);
  const [feedbackComment, setFeedbackComment] = useState<string>('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState<boolean>(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<boolean>(false);

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

  // Silent 1x Export Event Logging (export_events)
  useEffect(() => {
    if (verificationPassed && exportResult?.blobUrl && loggedExportRef.current !== exportResult.blobUrl) {
      loggedExportRef.current = exportResult.blobUrl;
      const memesCount = exportResult.memesSplicedCount !== undefined ? exportResult.memesSplicedCount : actualMemesCount;
      void logExportEvent({
        durationSec: actualDuration || exportResult.expectedDurationSec,
        cutsCount,
        memesCount,
      });
    }
  }, [verificationPassed, exportResult, actualDuration, cutsCount, actualMemesCount]);

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackRating < 1 || isSubmittingFeedback) return;
    setIsSubmittingFeedback(true);
    try {
      await submitUserFeedback({
        rating: feedbackRating,
        comment: feedbackComment,
      });
    } finally {
      setIsSubmittingFeedback(false);
      setFeedbackSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] dark:bg-[#0E0E0D] text-[#181715] dark:text-[#F4F2EC] flex flex-col justify-between p-4 sm:p-6">
      {/* Top Header */}
      <header className="max-w-4xl mx-auto w-full flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-[#E5E2DC] dark:border-[#2C2A27]">
        <button
          onClick={() => setScreen('WORKSPACE')}
          className="flex items-center space-x-2 text-xs font-medium text-[#181715] dark:text-[#F4F2EC] hover:text-[#000000] dark:hover:text-white transition-colors bg-white dark:bg-[#1E1D1B] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2825] px-3 py-2 rounded-lg border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Workspace</span>
        </button>

        <div className="flex items-center space-x-2">
          <Film className="w-5 h-5 text-[#D96B27] dark:text-[#E8632A]" />
          <h1 className="text-base font-bold text-[#181715] dark:text-[#F4F2EC]">Export & Render Studio</h1>
        </div>

        <div className="flex items-center justify-end">
          <ThemeToggle compact />
        </div>
      </header>

      {/* Main Export Content */}
      <main className="max-w-4xl mx-auto w-full my-6 space-y-6">
        {/* Visible Warnings for Preview-only items (Step 2.d) */}
        {exportResult && exportResult.warnings.length > 0 && (
          <div className="bg-[#FEF3C7] dark:bg-[#78350F]/40 border border-[#F59E0B]/50 dark:border-[#F59E0B]/40 rounded-xl p-3 flex items-start space-x-2.5 text-xs text-[#92400E] dark:text-[#FCD34D]">
            <AlertTriangle className="w-4 h-4 text-[#D97706] dark:text-[#FBBF24] flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#92400E] dark:text-[#FCD34D]">Notice:</span>
              <p>{exportResult.warnings.join(' ')}</p>
            </div>
          </div>
        )}

        {/* State A: Rendering in Progress */}
        {isExporting ? (
          <div className="bg-white dark:bg-[#171615] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm rounded-2xl p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#D96B27] dark:text-[#E8632A] mx-auto flex items-center justify-center animate-spin">
              <RefreshCw className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[#181715] dark:text-[#F4F2EC]">Rendering Your Final MP4</h3>
              <p className="text-xs text-[#66625B] dark:text-[#A39E95]">{progress.stage}</p>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-md mx-auto bg-[#E5E2DC] dark:bg-[#2C2A27] h-2.5 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                className="bg-[#D96B27] dark:bg-[#E8632A] h-full transition-all duration-300"
              />
            </div>

            <p className="text-xs font-mono tabular-nums text-[#66625B] dark:text-[#A39E95]">
              {Math.round(progress.ratio * 100)}% • Rendering locally in your browser
            </p>
          </div>
        ) : !verificationPassed || renderError ? (
          /* State B: Verification or Render Failure (Step 3) */
          <div className="bg-[#FEE2E2]/60 dark:bg-[#450A0A]/40 border border-[#EF4444]/40 dark:border-[#991B1B] rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-[#FEE2E2] dark:bg-[#7F1D1D]/50 text-[#DC2626] dark:text-[#FCA5A5] mx-auto flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#DC2626] dark:text-[#F87171]">Export Verification Failed</h3>
              <p className="text-sm font-semibold text-[#B91C1C] dark:text-[#FCA5A5]">{renderError}</p>
              {exportResult && (
                <p className="text-xs text-[#66625B] dark:text-[#A39E95] font-mono tabular-nums mt-2">
                  Expected: {exportResult.expectedDurationSec.toFixed(2)}s | Actual: {actualDuration.toFixed(2)}s | Drift: {Math.abs(actualDuration - exportResult.expectedDurationSec).toFixed(3)}s
                </p>
              )}
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={startExport}
                className="px-4 py-2 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25A1B] dark:hover:bg-[#F2743D] text-white font-semibold rounded-lg text-xs transition-colors shadow-sm cursor-pointer"
              >
                Retry Re-encode
              </button>
              <button
                onClick={() => setScreen('WORKSPACE')}
                className="px-4 py-2 bg-white dark:bg-[#1E1D1B] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2825] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC] rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Back to Workspace
              </button>
            </div>
          </div>
        ) : (
          /* State C: Verification Passed */
          <div className="bg-white dark:bg-[#171615] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm rounded-2xl p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E2DC] dark:border-[#2C2A27] pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-[#0F766E]/15 dark:bg-[#14B8A6]/20 text-[#0F766E] dark:text-[#2DD4BF] flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#181715] dark:text-[#F4F2EC]">Export Complete & Verified!</h3>
                  <p className="text-xs text-[#66625B] dark:text-[#A39E95] tabular-nums">
                    Duration: {actualDuration.toFixed(2)}s (Expected: {exportResult?.expectedDurationSec.toFixed(2)}s, Drift: {(Math.abs(actualDuration - (exportResult?.expectedDurationSec || 0)) * 1000).toFixed(0)}ms)
                  </p>
                </div>
              </div>

              <button
                onClick={handleDownload}
                className="flex items-center justify-center space-x-2 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25A1B] dark:hover:bg-[#F2743D] text-white font-semibold px-5 py-2.5 rounded-lg text-xs transition-all active:scale-95 shadow-sm w-full sm:w-auto min-h-[44px] cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download MP4</span>
              </button>
            </div>

            {/* Video Player */}
            {exportResult?.blobUrl && (
              <div className="aspect-video w-full max-w-2xl mx-auto bg-[#0B0B0A] dark:bg-[#070706] rounded-xl overflow-hidden border border-[#D8D4CC] dark:border-[#2E2C28]">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 pt-2">
              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Cuts Applied</span>
                <p className="text-base font-bold text-[#181715] dark:text-[#F4F2EC] font-mono tabular-nums">
                  {cutsCount} {cutsCount === 1 ? 'Cut' : 'Cuts'}
                </p>
              </div>

              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Source Clips</span>
                <p className="text-base font-bold text-[#181715] dark:text-[#F4F2EC] font-mono tabular-nums">
                  {activeClipsCount} {activeClipsCount === 1 ? 'Segment' : 'Segments'}
                </p>
              </div>

              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Memes Spliced</span>
                <p className="text-base font-bold text-[#181715] dark:text-[#F4F2EC] font-mono tabular-nums">
                  {(() => {
                    const count = exportResult?.memesSplicedCount !== undefined ? exportResult.memesSplicedCount : actualMemesCount;
                    return `${count} ${count === 1 ? 'Meme' : 'Memes'}`;
                  })()}
                </p>
              </div>

              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Music Track</span>
                <p className={`text-base font-bold font-mono tabular-nums truncate ${exportResult?.bgMusicBaked ? 'text-[#181715] dark:text-[#F4F2EC]' : 'text-[#8E8A82] dark:text-[#78736B]'}`} title={exportResult?.bgMusicName}>
                  {exportResult?.bgMusicBaked ? `${Math.round((exportResult.bgMusicVolume ?? 1) * 100)}%` : 'None'}
                </p>
              </div>
            </div>

            {/* Quick Feedback Card */}
            <div className="bg-[#FAF9F5] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] rounded-xl p-4 sm:p-5 space-y-3">
              {feedbackSubmitted ? (
                <div className="flex items-center space-x-2 text-[#0F766E] dark:text-[#2DD4BF] text-xs font-semibold py-2">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-[#0F766E] dark:text-[#2DD4BF]" />
                  <span>Thanks! Your feedback was saved.</span>
                </div>
              ) : (
                <form onSubmit={handleSubmitFeedback} className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-[#181715] dark:text-[#F4F2EC]">
                        How was your export experience?
                      </h4>
                      <p className="text-[11px] text-[#66625B] dark:text-[#A39E95]">
                        Helps us improve Fastcutz.ai (takes 10 seconds)
                      </p>
                    </div>

                    {/* 1 to 5 Star Rating */}
                    <div className="flex items-center space-x-1 pt-1 sm:pt-0">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const active = (feedbackHover || feedbackRating) >= star;
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setFeedbackRating(star)}
                            onMouseEnter={() => setFeedbackHover(star)}
                            onMouseLeave={() => setFeedbackHover(0)}
                            className="min-h-[40px] min-w-[40px] p-2 flex items-center justify-center rounded-lg hover:bg-white dark:hover:bg-[#2A2825] transition-colors cursor-pointer"
                            title={`${star} star${star > 1 ? 's' : ''}`}
                          >
                            <Star
                              className={`w-5 h-5 transition-colors ${
                                active
                                  ? 'text-[#D96B27] fill-[#D96B27] dark:text-[#E8632A] dark:fill-[#E8632A]'
                                  : 'text-[#D6D2C9] fill-[#F0EEE9] dark:text-[#423F3A] dark:fill-[#24221F]'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <textarea
                      rows={2}
                      value={feedbackComment}
                      onChange={(e) => setFeedbackComment(e.target.value)}
                      placeholder="What worked well, or what annoyed you? (Optional)"
                      className="flex-1 bg-white dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] rounded-lg p-2.5 text-xs text-[#181715] dark:text-[#F4F2EC] placeholder-[#8E8A82] dark:placeholder-[#78736B] focus:outline-none focus:border-[#D96B27] dark:focus:border-[#E8632A] resize-none select-text"
                    />

                    <button
                      type="submit"
                      disabled={feedbackRating === 0 || isSubmittingFeedback}
                      className="sm:self-end bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25A1B] dark:hover:bg-[#F2743D] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-xs transition-colors shadow-xs cursor-pointer min-h-[40px] flex items-center justify-center shrink-0"
                    >
                      {isSubmittingFeedback ? 'Sending...' : 'Send Feedback'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* STEP 4: Collapsible "Export details" Section */}
        {exportResult && (
          <div className="bg-white dark:bg-[#171615] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm rounded-xl overflow-hidden">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full px-4 py-3 bg-[#F0EEE9] dark:bg-[#1E1D1B] hover:bg-[#E7E4DD] dark:hover:bg-[#262421] flex items-center justify-between text-xs font-semibold text-[#181715] dark:text-[#F4F2EC] transition-colors cursor-pointer"
            >
              <span>Export & Audio Details</span>
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDetails && (
              <div className="p-4 space-y-3 text-xs font-mono tabular-nums text-[#181715] dark:text-[#F4F2EC] border-t border-[#E5E2DC] dark:border-[#2C2A27]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Exit Code: </span>
                    <span className={exportResult.exitCode === 0 ? 'text-[#0F766E] dark:text-[#2DD4BF] font-bold' : 'text-[#DC2626] dark:text-[#F87171] font-bold'}>
                      {exportResult.exitCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Elapsed Render Time: </span>
                    <span className="text-[#181715] dark:text-[#F4F2EC]">{(exportResult.elapsedTimeMs / 1000).toFixed(2)}s</span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Expected Duration: </span>
                    <span className="text-[#181715] dark:text-[#F4F2EC]">{exportResult.expectedDurationSec.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Actual Duration: </span>
                    <span className="text-[#181715] dark:text-[#F4F2EC]">{actualDuration.toFixed(3)}s</span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Output Size: </span>
                    <span className="text-[#181715] dark:text-[#F4F2EC]">{(exportResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB ({exportResult.fileSizeBytes} bytes)</span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Audio Track: </span>
                    <span className="text-[#181715] dark:text-[#F4F2EC]">{exportResult.hasAudio ? 'Present (AAC 192k)' : 'Silent fallback (no source audio detected)'}</span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Speaker Voice Enhance: </span>
                    <span className={exportResult.voiceEnhanceBaked ? 'text-[#0F766E] dark:text-[#2DD4BF] font-bold' : 'text-[#8E8A82] dark:text-[#78736B]'}>
                      {exportResult.voiceEnhanceBaked ? 'Baked into MP4 (85Hz HPF + 260Hz cut + 2.8kHz presence boost + Compressor + Limiter)' : 'Disabled'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Reduce Low Hum (Basic): </span>
                    <span className={exportResult.noiseRemovalBaked ? 'text-[#0F766E] dark:text-[#2DD4BF] font-bold' : 'text-[#8E8A82] dark:text-[#78736B]'}>
                      {exportResult.noiseRemovalBaked ? 'Baked into MP4 (Cascaded 180Hz HPF + 6.2kHz LPF + Noise Gate)' : 'Disabled'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Background Music Track: </span>
                    <span className={exportResult.bgMusicBaked ? 'text-[#0F766E] dark:text-[#2DD4BF] font-bold' : 'text-[#8E8A82] dark:text-[#78736B]'}>
                      {exportResult.bgMusicBaked ? `Baked into MP4: ${exportResult.bgMusicName} (Volume: ${Math.round((exportResult.bgMusicVolume ?? 1) * 100)}%, amix)` : 'Disabled / None'}
                    </span>
                  </div>
                </div>

                {/* Segments Table */}
                <div className="pt-2">
                  <span className="text-[#66625B] dark:text-[#A39E95] font-bold text-[10px] uppercase">Active Source Segments ({exportResult.segments.length}):</span>
                  <div className="mt-1 bg-[#F7F6F2] dark:bg-[#141312] rounded p-2 border border-[#E5E2DC] dark:border-[#2C2A27] text-[10px] space-y-1">
                    {exportResult.segments.map((seg) => (
                      <div key={seg.index} className="flex justify-between">
                        <span>Segment #{seg.index}: source [{seg.startSec.toFixed(3)}s → {seg.endSec.toFixed(3)}s]</span>
                        <span className="text-[#D96B27] dark:text-[#E8632A]">Duration: {seg.durSec.toFixed(3)}s</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* FFmpeg Arguments */}
                <div className="pt-2">
                  <span className="text-[#66625B] dark:text-[#A39E95] font-bold text-[10px] uppercase">FFmpeg Execution Arguments:</span>
                  <pre className="mt-1 bg-[#F7F6F2] dark:bg-[#141312] p-2.5 rounded border border-[#E5E2DC] dark:border-[#2C2A27] text-[10px] whitespace-pre-wrap break-all text-[#66625B] dark:text-[#A39E95]">
                    ffmpeg {exportResult.ffmpegArgs.join(' ')}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto w-full pt-4 border-t border-[#E5E2DC] dark:border-[#2C2A27] text-center text-xs text-[#8E8A82] dark:text-[#78736B] flex items-center justify-center">
        <span>Fastcutz.ai • Browser-First Creator Studio</span>
      </footer>
    </div>
  );
};
