import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, CheckCircle2, AlertTriangle, AlertCircle, Film, RefreshCw, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { exportProjectVideo, verifyRenderedVideo, RenderProgress, ExportResult } from '../utils/ffmpegExporter';
import { isActualMemeClip } from '../utils/timelineMath';
import { logExportEvent, submitUserFeedback } from '../utils/supabaseClient';
import { ThemeToggle } from './ThemeToggle';
import { Screen3RobotStage } from './Screen3RobotStage';

/**
 * Slim, non-interactive rolling filmstrip for Screen 3:
 * [Thank You] -> [For] -> [Using] -> [Fastcutz]
 */
const Screen3Filmstrip: React.FC = () => {
  const frames = [
    { id: 'f1', text: 'Thank You', tag: '01', isHighlight: false, isPrimary: true },
    { id: 'f2', text: 'For', tag: '02', isHighlight: false, isPrimary: false },
    { id: 'f3', text: 'Using', tag: '03', isHighlight: false, isPrimary: false },
    { id: 'f4', text: 'Fastcutz', tag: '04', isHighlight: true, isPrimary: false },
  ];

  // Repeat sequence 3 times per copy for seamless coverage on all monitor widths
  const repeatedSequence = [...frames, ...frames, ...frames];

  const renderFrame = (item: (typeof frames)[0], key: string) => (
    <div
      key={key}
      className={`w-[155px] sm:w-[185px] h-[52px] sm:h-[58px] rounded-lg border flex flex-col justify-between p-1.5 sm:p-2 shrink-0 ${
        item.isHighlight
          ? 'bg-[#FFF7F2] dark:bg-[#201B18] border-[#D96B27]/50 dark:border-[#E8632A]/60 shadow-[0_2px_8px_rgba(217,107,39,0.12)]'
          : 'bg-white dark:bg-[#1B1A18] border-[#E5E2DC] dark:border-[#2E2C28]'
      }`}
    >
      {/* Top Sprocket Rail */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center space-x-1">
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
        </div>
        <span
          className={`font-mono text-[8px] sm:text-[9px] tabular-nums tracking-widest ${
            item.isHighlight
              ? 'text-[#D96B27] dark:text-[#E8632A] font-bold'
              : 'text-[#8E8A82] dark:text-[#78736B]'
          }`}
        >
          {item.tag}
        </span>
        <div className="flex items-center space-x-1">
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
        </div>
      </div>

      {/* Frame Center Content */}
      <div className="flex items-center justify-center space-x-1.5 py-0.5">
        {item.isHighlight ? (
          <>
            <span className="font-semibold text-xs sm:text-sm tracking-tight text-zinc-900 dark:text-white opacity-100">
              Fastcutz<span className="text-[#D96B27] dark:text-[#E8632A]">.ai</span>
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#D96B27] dark:bg-[#E8632A]" />
          </>
        ) : (
          <span className="font-semibold text-xs sm:text-sm text-zinc-900 dark:text-white opacity-100 tracking-tight">
            {item.text}
          </span>
        )}
      </div>

      {/* Bottom Sprocket Rail */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center space-x-1">
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
        </div>
        <div className="w-1 h-1 rounded-full bg-[#D8D4CC] dark:bg-[#383531]" />
        <div className="flex items-center space-x-1">
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
          <div className="w-2 h-1 rounded-[1.5px] bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27]" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full overflow-hidden pointer-events-none select-none my-1 sm:my-2">
      <div className="w-full relative overflow-hidden py-1 bg-white/80 dark:bg-[#141312] border-y border-[#E5E2DC] dark:border-[#2C2A27] shadow-xs">
        {/* Left & Right Edge-Fade Masks */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 sm:w-20 md:w-32 bg-gradient-to-r from-[#F7F6F2] dark:from-[#0E0E0D] to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 sm:w-20 md:w-32 bg-gradient-to-l from-[#F7F6F2] dark:from-[#0E0E0D] to-transparent z-10" />

        {/* Marquee Track (-50% loop) */}
        <div className="flex w-max animate-filmstrip-marquee select-none">
          {/* Copy 1 (0% to -50%) */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 pr-2.5 sm:pr-3 shrink-0">
            {repeatedSequence.map((item, idx) => renderFrame(item, `s3_c1_${idx}`))}
          </div>
          {/* Copy 2 (-50% to -100%) */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 pr-2.5 sm:pr-3 shrink-0" aria-hidden="true">
            {repeatedSequence.map((item, idx) => renderFrame(item, `s3_c2_${idx}`))}
          </div>
        </div>
      </div>
    </div>
  );
};

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
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

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
    setFeedbackError(null);
    try {
      const res = await submitUserFeedback({
        rating: feedbackRating,
        comment: feedbackComment,
      });
      if (res && res.ok) {
        setFeedbackSubmitted(true);
      } else {
        setFeedbackError('Could not save feedback right now — please try again.');
      }
    } catch {
      setFeedbackError('Could not save feedback right now — please try again.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] dark:bg-[#0E0E0D] text-[#181715] dark:text-[#F4F2EC] flex flex-col justify-between p-3 sm:p-5">
      {/* Top Header */}
      <header className="max-w-4xl mx-auto w-full flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5E2DC] dark:border-[#2C2A27]">
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

      {/* Slim Non-Interactive Rolling Filmstrip: [Thank You] -> [For] -> [Using] -> [Fastcutz] */}
      <Screen3Filmstrip />

      {/* Main Export Content */}
      <main className="max-w-4xl mx-auto w-full my-3 sm:my-5 space-y-4 sm:space-y-5">
        {/* Visible Warnings for other export items if any */}
        {exportResult && exportResult.warnings.filter(w => !w.toLowerCase().includes('transition')).length > 0 && (
          <div className="bg-[#FEF3C7] dark:bg-[#78350F]/40 border border-[#F59E0B]/50 dark:border-[#F59E0B]/40 rounded-xl p-3 flex items-start space-x-2.5 text-xs text-[#92400E] dark:text-[#FCD34D]">
            <AlertTriangle className="w-4 h-4 text-[#D97706] dark:text-[#FBBF24] flex-shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#92400E] dark:text-[#FCD34D]">Notice:</span>
              <p>{exportResult.warnings.filter(w => !w.toLowerCase().includes('transition')).join(' ')}</p>
            </div>
          </div>
        )}

        {/* State A: Rendering in Progress */}
        {isExporting ? (
          <div className="pt-1 sm:pt-2 pb-1 space-y-3 sm:space-y-4">
            <div className="bg-white dark:bg-[#171615] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm rounded-2xl p-4 sm:p-6 text-center space-y-3 sm:space-y-4">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#F0EEE9] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#D96B27] dark:text-[#E8632A] mx-auto flex items-center justify-center animate-spin">
                <RefreshCw className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>

              <div className="space-y-1">
                <h3 className="text-base sm:text-lg font-semibold text-[#181715] dark:text-[#F4F2EC]">Rendering Your Final MP4</h3>
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

            {/* Storytelling Scene A: Fastcutz puts edits together */}
            <Screen3RobotStage mode="rendering" />
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
              <div className="w-full max-w-2xl mx-auto max-h-[220px] sm:max-h-[250px] aspect-video bg-[#0B0B0A] dark:bg-[#070706] rounded-xl overflow-hidden border border-[#D8D4CC] dark:border-[#2E2C28] flex items-center justify-center">
                <video
                  ref={previewVideoRef}
                  src={exportResult.blobUrl}
                  controls
                  playsInline
                  className="w-full h-full max-h-[220px] sm:max-h-[250px] object-contain"
                />
              </div>
            )}

            {/* Edit Summary Card */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 pt-1">
              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-2.5 sm:p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Cuts Applied</span>
                <p className="text-base font-bold text-[#181715] dark:text-[#F4F2EC] font-mono tabular-nums">
                  {cutsCount} {cutsCount === 1 ? 'Cut' : 'Cuts'}
                </p>
              </div>

              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-2.5 sm:p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Source Clips</span>
                <p className="text-base font-bold text-[#181715] dark:text-[#F4F2EC] font-mono tabular-nums">
                  {activeClipsCount} {activeClipsCount === 1 ? 'Segment' : 'Segments'}
                </p>
              </div>

              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-2.5 sm:p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Memes Spliced</span>
                <p className="text-base font-bold text-[#181715] dark:text-[#F4F2EC] font-mono tabular-nums">
                  {(() => {
                    const count = exportResult?.memesSplicedCount !== undefined ? exportResult.memesSplicedCount : actualMemesCount;
                    return `${count} ${count === 1 ? 'Meme' : 'Memes'}`;
                  })()}
                </p>
              </div>

              <div className="bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] p-2.5 sm:p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Music Track</span>
                <p className={`text-base font-bold font-mono tabular-nums truncate ${exportResult?.bgMusicBaked ? 'text-[#181715] dark:text-[#F4F2EC]' : 'text-[#8E8A82] dark:text-[#78736B]'}`} title={exportResult?.bgMusicName}>
                  {exportResult?.bgMusicBaked ? `${Math.round((exportResult.bgMusicVolume ?? 1) * 100)}%` : 'None'}
                </p>
              </div>
            </div>

            {/* Storytelling Scene B: Export Complete Resting & Reading Scene (High Placement) */}
            <Screen3RobotStage mode="complete" />

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
                            onClick={() => {
                              setFeedbackRating(star);
                              if (feedbackError) setFeedbackError(null);
                            }}
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

                  {feedbackError && (
                    <div className="p-2.5 bg-[#FEF2F2] dark:bg-[#450A0A]/40 border border-[#FCA5A5] dark:border-[#991B1B] rounded-lg text-xs text-[#991B1B] dark:text-[#FCA5A5]">
                      {feedbackError}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2">
                    <textarea
                      rows={2}
                      value={feedbackComment}
                      onChange={(e) => {
                        setFeedbackComment(e.target.value);
                        if (feedbackError) setFeedbackError(null);
                      }}
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
              <span>Under the Hood · Render Diagnostics</span>
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDetails && (
              <div className="p-4 space-y-3 text-xs font-mono tabular-nums text-[#181715] dark:text-[#F4F2EC] border-t border-[#E5E2DC] dark:border-[#2C2A27]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Engine: </span>
                    <span className="text-[#181715] dark:text-[#F4F2EC]">FFmpeg.wasm (100% Local in Browser)</span>
                  </div>
                  <div>
                    <span className="text-[#66625B] dark:text-[#A39E95]">Server Video Upload: </span>
                    <span className="text-[#0F766E] dark:text-[#2DD4BF] font-semibold">0 B (Processed On-Device)</span>
                  </div>
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
