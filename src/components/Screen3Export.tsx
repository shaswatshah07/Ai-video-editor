import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, CheckCircle2, AlertCircle, Film, Sparkles, RefreshCw } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { exportProjectVideo, verifyRenderedVideo, RenderProgress } from '../utils/ffmpegExporter';

export const Screen3Export: React.FC = () => {
  const { project, setScreen } = useEditorStore();

  const [isExporting, setIsExporting] = useState<boolean>(true);
  const [progress, setProgress] = useState<RenderProgress>({ ratio: 0, stage: 'Preparing media files...' });
  const [renderedBlobUrl, setRenderedBlobUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [verifiedDuration, setVerifiedDuration] = useState<number | null>(null);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const startExport = async () => {
    if (!project) return;
    setIsExporting(true);
    setRenderError(null);
    setRenderedBlobUrl(null);

    try {
      const outputBlob = await exportProjectVideo(project, (p) => {
        setProgress(p);
      });

      const url = URL.createObjectURL(outputBlob);

      // Output Verification Gate (Spec 6)
      setProgress({ ratio: 0.95, stage: 'Verifying container structure & audio-video playback...' });
      const verification = await verifyRenderedVideo(url);

      if (!verification.valid) {
        throw new Error(`Output verification failed: ${verification.error}`);
      }

      setVerifiedDuration(verification.duration);
      setRenderedBlobUrl(url);
      setIsExporting(false);
      setProgress({ ratio: 1, stage: 'Export Complete!' });
    } catch (err) {
      setRenderError((err as Error).message || 'Failed to render MP4 video.');
      setIsExporting(false);
    }
  };

  useEffect(() => {
    startExport();
    // Cleanup URL on unmount
    return () => {
      if (renderedBlobUrl) URL.revokeObjectURL(renderedBlobUrl);
    };
  }, []);

  if (!project) return null;

  const handleDownload = () => {
    if (!renderedBlobUrl) return;
    const a = document.createElement('a');
    a.href = renderedBlobUrl;
    a.download = `${project.title}_edited.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const activeClipsCount = project.items.filter(it => it.status === 'ACTIVE').length;
  const memesCount = project.items.filter(it => it.kind === 'MEME_CLIP').length;
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

        <div className="w-24" /> {/* Spacer */}
      </header>

      {/* Main Export Content */}
      <main className="max-w-4xl mx-auto w-full my-8 space-y-6">
        {/* Render Progress Card */}
        {isExporting ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-indigo-600/20 text-indigo-400 mx-auto flex items-center justify-center animate-spin">
              <RefreshCw className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-white">Rendering MP4 Video</h3>
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
              {Math.round(progress.ratio * 100)}% Complete • Zero server cost, 100% in-browser
            </p>
          </div>
        ) : renderError ? (
          /* Error State */
          <div className="bg-red-950/30 border border-red-800/60 rounded-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-600/20 text-red-400 mx-auto flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-red-300">Rendering Error</h3>
              <p className="text-xs text-red-400 mt-1">{renderError}</p>
            </div>
            <button
              onClick={startExport}
              className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded-xl text-xs font-medium transition-colors"
            >
              Retry Render
            </button>
          </div>
        ) : (
          /* Success & Preview State */
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-gray-800 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Export Complete & Verified!</h3>
                  <p className="text-xs text-gray-400">
                    Duration: {verifiedDuration?.toFixed(1)}s • Ready for download
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
            {renderedBlobUrl && (
              <div className="aspect-video w-full max-w-2xl mx-auto bg-black rounded-xl overflow-hidden border border-gray-800 shadow-xl">
                <video
                  ref={previewVideoRef}
                  src={renderedBlobUrl}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            {/* Edit Summary Card */}
            <div className="grid grid-cols-3 gap-4 pt-2">
              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Cuts Applied</span>
                <p className="text-lg font-bold text-indigo-400">{cutsCount} Segments</p>
              </div>

              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Active Clips</span>
                <p className="text-lg font-bold text-emerald-400">{activeClipsCount} Clips</p>
              </div>

              <div className="bg-gray-800/40 border border-gray-750 p-3 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Memes Added</span>
                <p className="text-lg font-bold text-purple-400">{memesCount} Memes</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto w-full pt-4 border-t border-gray-900 text-center text-xs text-gray-600 flex items-center justify-between">
        <span>AI Video Editor • 100% Client-Side Processing</span>
        <span className="flex items-center space-x-1 text-gray-500">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Scaler YIIC 9.0 Week 2</span>
        </span>
      </footer>
    </div>
  );
};
