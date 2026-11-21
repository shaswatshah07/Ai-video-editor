import React, { useState } from 'react';
import { Upload, Wand2, ArrowRight, AlertCircle, FileVideo } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { TimelineItem } from '../types/edl';

// 5-Frame Rolling Filmstrip Sequence: [Empty] -> [WELCOME] -> [TO] -> [Fastcutz.ai] -> [Empty]
const FILMSTRIP_FRAMES = [
  {
    id: 'empty_lead',
    type: 'empty',
    tag: 'F00',
    timecode: '00:00:12'
  },
  {
    id: 'welcome',
    type: 'welcome',
    tag: 'REC · 01',
    timecode: '00:01:00'
  },
  {
    id: 'to',
    type: 'to',
    tag: 'F02',
    timecode: '00:02:00'
  },
  {
    id: 'fastcutz',
    type: 'fastcutz',
    tag: 'F03',
    timecode: '00:03:00'
  },
  {
    id: 'empty_trail',
    type: 'empty',
    tag: 'F04',
    timecode: '00:04:00'
  }
];

// Custom Inline SVG Mascot: Cute "Fastcutz" Robot resting inside a docking cradle
const FastcutzRobotMascot: React.FC = () => {
  return (
    <div className="relative w-[110px] h-[86px] flex items-center justify-center">
      <svg
        viewBox="0 0 110 86"
        className="w-full h-full overflow-visible drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Faint Studio Lighting Glows */}
        <ellipse cx="55" cy="72" rx="34" ry="7" fill="#E8872A" opacity="0.08" />
        <ellipse cx="55" cy="68" rx="20" ry="4" fill="#2DD4BF" opacity="0.12" />

        {/* --- Docking Pod (Sits Flush on Dropbox Top Border) --- */}
        {/* Pod Outer Cradle Shell */}
        <path
          d="M20 58 C20 58 28 80 55 80 C82 80 90 58 90 58 L88 54 C88 54 80 74 55 74 C30 74 22 54 22 54 Z"
          fill="#1F1E1C"
          stroke="#2E2D29"
          strokeWidth="1.2"
        />
        {/* Pod Base Mounting Foot (Flush on border) */}
        <rect x="34" y="78" width="42" height="4" rx="2" fill="#141412" stroke="#2C2B28" strokeWidth="1" />

        {/* Glowing Studio-Teal Charging Strip */}
        <rect x="44" y="62.5" width="22" height="2.5" rx="1.25" fill="#2DD4BF" opacity="0.9" />
        <rect x="46" y="62.5" width="18" height="2.5" rx="1.25" fill="#5EEAD4" opacity="0.6" />

        {/* Crisp Nameplate Badge: FASTCUTZ */}
        <rect x="35" y="67" width="40" height="10" rx="2.5" fill="#141412" stroke="#2C2B28" strokeWidth="1" />
        <text
          x="55"
          y="74.5"
          textAnchor="middle"
          fill="#A19E97"
          fontSize="6.5"
          fontWeight="bold"
          fontFamily="monospace"
          letterSpacing="0.18em"
        >
          FASTCUTZ
        </text>

        {/* --- Fastcutz Cute Robot (Idle Breathe Animation) --- */}
        <g className="animate-fastcutz-breathe">
          {/* Top Antenna Stem */}
          <line x1="55" y1="17" x2="55" y2="8" stroke="#3A3833" strokeWidth="2" strokeLinecap="round" />
          {/* Glowing Amber Antenna Bulb */}
          <circle cx="55" cy="6.5" r="3.5" fill="#E8872A" />
          <circle cx="55" cy="6.5" r="5.5" fill="#E8872A" opacity="0.25" />
          <circle cx="53.8" cy="5.2" r="1" fill="#FFFFFF" opacity="0.8" />

          {/* Left & Right Ear Bolt Accents */}
          <rect x="30" y="27" width="3" height="10" rx="1.5" fill="#1A1917" stroke="#2E2D29" strokeWidth="1" />
          <rect x="77" y="27" width="3" height="10" rx="1.5" fill="#1A1917" stroke="#2E2D29" strokeWidth="1" />

          {/* Rounded Matte Graphite Head Shell */}
          <rect
            x="32"
            y="16"
            width="46"
            height="36"
            rx="14"
            fill="#23221F"
            stroke="#3A3833"
            strokeWidth="1.5"
          />

          {/* Curved Dark Glossy Visor Face */}
          <rect
            x="36.5"
            y="22"
            width="37"
            height="22"
            rx="8"
            fill="#0F0F0E"
            stroke="#161614"
            strokeWidth="1"
          />
          {/* Visor Specular Reflection Curve */}
          <path
            d="M41 25 C48 23.5 62 23.5 69 25"
            stroke="#2A2926"
            strokeWidth="1"
            strokeLinecap="round"
          />

          {/* Expressive Glowing Teal Eyes (Blinking Animation) */}
          <g className="animate-fastcutz-blink">
            {/* Left Eye */}
            <rect x="42.5" y="28" width="8" height="9" rx="4" fill="#2DD4BF" />
            <circle cx="48" cy="30.2" r="1.3" fill="#FFFFFF" />
            {/* Right Eye */}
            <rect x="59.5" y="28" width="8" height="9" rx="4" fill="#2DD4BF" />
            <circle cx="65" cy="30.2" r="1.3" fill="#FFFFFF" />
          </g>

          {/* Tiny Cute Smile Line */}
          <path
            d="M52 39.5 Q55 41.5 58 39.5"
            stroke="#2DD4BF"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />

          {/* Compact Rounded Paws resting comfortably on the front cradle rim */}
          <ellipse cx="39" cy="51" rx="4" ry="3" fill="#2A2925" stroke="#3A3833" strokeWidth="1" />
          <ellipse cx="71" cy="51" rx="4" ry="3" fill="#2A2925" stroke="#3A3833" strokeWidth="1" />
        </g>
      </svg>
    </div>
  );
};

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

  // Helper to render an individual studio filmstrip frame
  const renderFilmstripFrame = (frame: typeof FILMSTRIP_FRAMES[0], key: string) => {
    const isFastcutz = frame.type === 'fastcutz';
    return (
      <div
        key={key}
        className={`w-[260px] md:w-[300px] h-[112px] md:h-[126px] shrink-0 rounded-xl border flex flex-col justify-between p-2.5 relative select-none transition-colors ${
          isFastcutz
            ? 'bg-[#1C1A17] border-[#E8872A]/50 shadow-[0_0_24px_-8px_rgba(232,135,42,0.25)]'
            : 'bg-[#1A1917] border-[#2C2B28]'
        }`}
      >
        {/* Top Sprocket Rail */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center space-x-1.5">
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
          <span
            className={`font-mono text-[9px] tabular-nums tracking-widest ${
              isFastcutz ? 'text-[#E8872A] font-bold' : 'text-[#52504B]'
            }`}
          >
            {frame.tag}
          </span>
          <div className="flex items-center space-x-1.5">
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
        </div>

        {/* Frame Center Display */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden my-0.5">
          {frame.type === 'empty' && (
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Corner Viewfinder Brackets */}
              <div className="absolute top-0.5 left-2 w-2 h-2 border-t border-l border-[#33312B]" />
              <div className="absolute top-0.5 right-2 w-2 h-2 border-t border-r border-[#33312B]" />
              <div className="absolute bottom-0.5 left-2 w-2 h-2 border-b border-l border-[#33312B]" />
              <div className="absolute bottom-0.5 right-2 w-2 h-2 border-b border-r border-[#33312B]" />
              {/* Center crosshair dot */}
              <div className="w-1.5 h-1.5 rounded-full bg-[#2C2B28]" />
            </div>
          )}

          {frame.type === 'welcome' && (
            <div className="flex items-center justify-center">
              <span className="text-3xl md:text-4xl font-bold tracking-[0.14em] text-[#F4F2EE] font-sans">
                WELCOME
              </span>
            </div>
          )}

          {frame.type === 'to' && (
            <div className="flex items-center justify-center">
              <span className="text-3xl md:text-4xl font-semibold tracking-[0.2em] text-[#A19E97] font-sans">
                TO
              </span>
            </div>
          )}

          {frame.type === 'fastcutz' && (
            <div className="flex items-center justify-center">
              <span className="text-3xl md:text-4xl font-extrabold tracking-tight">
                <span className="text-[#F4F2EE]">Fastcutz</span>
                <span className="text-[#E8872A]">.ai</span>
              </span>
            </div>
          )}
        </div>

        {/* Bottom Sprocket Rail */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center space-x-1.5">
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
          <span className="font-mono text-[9px] text-[#52504B] tabular-nums tracking-widest">
            {frame.timecode}
          </span>
          <div className="flex items-center space-x-1.5">
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-3 h-1.5 rounded-[2px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0E0E0D] text-[#F4F2EE] flex flex-col overflow-y-auto">
      {/* Top Rolling Cinema Filmstrip Hero */}
      <section id="hero-space" className="w-full overflow-hidden pt-6 pb-6">
        <div className="w-full relative overflow-hidden py-2 bg-[#141412] border-y border-[#2C2B28]">
          {/* Left & Right Gradient Fade Masks */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 md:w-36 bg-gradient-to-r from-[#0E0E0D] to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 md:w-36 bg-gradient-to-l from-[#0E0E0D] to-transparent z-10" />

          {/* Marquee Track (Smooth, continuous -50% marquee loop) */}
          <div className="flex w-max animate-filmstrip-marquee select-none">
            {/* Copy 1 (0% to -50%) - 2 sets of the 5-frame sequence */}
            <div className="flex items-center space-x-4 md:space-x-6 pr-4 md:pr-6 shrink-0">
              {FILMSTRIP_FRAMES.map((f, i) => renderFilmstripFrame(f, `set1_${f.id}_${i}`))}
              {FILMSTRIP_FRAMES.map((f, i) => renderFilmstripFrame(f, `set2_${f.id}_${i}`))}
            </div>
            {/* Copy 2 (-50% to -100%) - 2 identical sets */}
            <div className="flex items-center space-x-4 md:space-x-6 pr-4 md:pr-6 shrink-0" aria-hidden="true">
              {FILMSTRIP_FRAMES.map((f, i) => renderFilmstripFrame(f, `set3_${f.id}_${i}`))}
              {FILMSTRIP_FRAMES.map((f, i) => renderFilmstripFrame(f, `set4_${f.id}_${i}`))}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area: Upload & Mode Selection */}
      <main className="max-w-6xl mx-auto w-full px-6 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Drag & Drop Dropzone with Fastcutz Robot */}
        <div className="lg:col-span-7 space-y-6">
          <div className="relative mt-14 md:mt-16">
            {/* Fastcutz Robot Mascot & Docking Pod flush on the top border */}
            <div className="absolute -top-[78px] left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none">
              <FastcutzRobotMascot />
            </div>

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

        {/* Right Column: Mode Selection (Auto Edit vs Custom Edit) - Clean Top Clearance */}
        <div className="lg:col-span-5 space-y-6 mt-14 md:mt-16">
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
      <footer className="max-w-6xl mx-auto w-full px-6 pt-4 pb-6 border-t border-[#2C2B28] text-center text-xs text-[#6E6B64] mt-auto">
        AI Video Editor • 100% Client-Side Processing • Scaler YIIC 9.0 Week 2
      </footer>
    </div>
  );
};
