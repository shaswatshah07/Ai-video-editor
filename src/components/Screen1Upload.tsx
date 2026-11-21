import React, { useState, useEffect, useRef } from 'react';
import { Upload, Wand2, ArrowRight, AlertCircle, FileVideo } from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { TimelineItem } from '../types/edl';
import { MEME_LIBRARY, MemeLibraryItem } from '../utils/memeLibrary';

// Types for the mascot animation lifecycle
type BotPhase = 'idle' | 'to-cupboard' | 'searching' | 'to-computer' | 'inserting' | 'returning';

// 5-Frame Rolling Sequence: [Slot A (Empty/Meme)] -> [WELCOME] -> [TO] -> [Fastcutz.ai] -> [Slot B (Empty/Meme)]
type FrameSlotType = 'slotA' | 'welcome' | 'to' | 'fastcutz' | 'slotB';
const SEQUENCE_ORDER: FrameSlotType[] = ['slotA', 'welcome', 'to', 'fastcutz', 'slotB'];

// Exact duration matching .animate-filmstrip-marquee (28s in src/index.css) for 1-full-roll restoration
const FULL_ROLL_MS = 28000;

/**
 * Stationary Docking Cradle
 * Anchored permanently flush on the top edge of the left-hand Upload Dropbox
 */
const StationaryDockingPod: React.FC = () => {
  return (
    <div className="relative w-[110px] h-[34px] flex items-center justify-center pointer-events-none select-none">
      <svg
        viewBox="0 0 110 34"
        className="w-full h-full overflow-visible"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Glows */}
        <ellipse cx="55" cy="24" rx="34" ry="6" fill="#E8872A" opacity="0.08" />
        <ellipse cx="55" cy="20" rx="20" ry="4" fill="#2DD4BF" opacity="0.12" />

        {/* Pod Outer Cradle Shell */}
        <path
          d="M20 6 C20 6 28 28 55 28 C82 28 90 6 90 6 L88 2 C88 2 80 22 55 22 C30 22 22 2 22 2 Z"
          fill="#1F1E1C"
          stroke="#2E2D29"
          strokeWidth="1.2"
        />
        {/* Pod Base Mounting Foot (Flush on border) */}
        <rect x="34" y="26" width="42" height="4" rx="2" fill="#141412" stroke="#2C2B28" strokeWidth="1" />

        {/* Glowing Studio-Teal Charging Strip */}
        <rect x="44" y="10.5" width="22" height="2.5" rx="1.25" fill="#2DD4BF" opacity="0.9" />
        <rect x="46" y="10.5" width="18" height="2.5" rx="1.25" fill="#5EEAD4" opacity="0.6" />

        {/* Crisp Nameplate Badge: FASTCUTZ */}
        <rect x="35" y="15" width="40" height="10" rx="2.5" fill="#141412" stroke="#2C2B28" strokeWidth="1" />
        <text
          x="55"
          y="22.5"
          textAnchor="middle"
          fill="#A19E97"
          fontSize="6.5"
          fontWeight="bold"
          fontFamily="monospace"
          letterSpacing="0.18em"
        >
          FASTCUTZ
        </text>
      </svg>
    </div>
  );
};

/**
 * Traveling Cute Fastcutz Robot Mascot
 * Glides smoothly across the stage, searches the cupboard, and carries meme cartridges
 */
const TravelingRobot: React.FC<{ isSearching: boolean; isCarrying: boolean }> = ({ isSearching, isCarrying }) => {
  return (
    <div className={`relative w-[60px] h-[64px] flex items-center justify-center ${isSearching ? 'animate-fastcutz-search' : ''}`}>
      <svg
        viewBox="0 0 60 64"
        className="w-full h-full overflow-visible drop-shadow-[0_6px_14px_rgba(0,0,0,0.65)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className={isSearching ? '' : 'animate-fastcutz-breathe'}>
          {/* Top Antenna Stem */}
          <line x1="30" y1="17" x2="30" y2="8" stroke="#3A3833" strokeWidth="2" strokeLinecap="round" />
          {/* Glowing Amber Antenna Bulb */}
          <circle cx="30" cy="6.5" r="3.5" fill="#E8872A" />
          <circle cx="30" cy="6.5" r="5.5" fill="#E8872A" opacity="0.25" />
          <circle cx="28.8" cy="5.2" r="1" fill="#FFFFFF" opacity="0.8" />

          {/* Left & Right Ear Bolt Accents */}
          <rect x="5" y="27" width="3" height="10" rx="1.5" fill="#1A1917" stroke="#2E2D29" strokeWidth="1" />
          <rect x="52" y="27" width="3" height="10" rx="1.5" fill="#1A1917" stroke="#2E2D29" strokeWidth="1" />

          {/* Rounded Matte Graphite Head Shell */}
          <rect
            x="7"
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
            x="11.5"
            y="22"
            width="37"
            height="22"
            rx="8"
            fill="#0F0F0E"
            stroke="#161614"
            strokeWidth="1"
          />
          {/* Visor Glare Curve */}
          <path
            d="M16 25 C23 23.5 37 23.5 44 25"
            stroke="#2A2926"
            strokeWidth="1"
            strokeLinecap="round"
          />

          {/* Expressive Glowing Teal Eyes (Blinking Animation) */}
          <g className="animate-fastcutz-blink">
            {/* Left Eye */}
            <rect x="17.5" y="28" width="8" height="9" rx="4" fill="#2DD4BF" />
            <circle cx="23" cy="30.2" r="1.3" fill="#FFFFFF" />
            {/* Right Eye */}
            <rect x="34.5" y="28" width="8" height="9" rx="4" fill="#2DD4BF" />
            <circle cx="40" cy="30.2" r="1.3" fill="#FFFFFF" />
          </g>

          {/* Cute Smile Line */}
          <path
            d="M27 39.5 Q30 41.5 33 39.5"
            stroke="#2DD4BF"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />

          {/* Compact Rounded Paws */}
          <ellipse cx="14" cy="51" rx="4" ry="3" fill="#2A2925" stroke="#3A3833" strokeWidth="1" />
          <ellipse cx="46" cy="51" rx="4" ry="3" fill="#2A2925" stroke="#3A3833" strokeWidth="1" />
        </g>
      </svg>

      {/* Mini glowing meme cartridge in hands when carrying across stage */}
      {isCarrying && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-40 flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#1C1A17] border border-[#E8872A] shadow-[0_0_12px_rgba(232,135,42,0.7)] animate-pulse">
          <div className="w-1.5 h-1.5 rounded-full bg-[#E8872A]" />
          <span className="font-mono text-[7.5px] font-bold text-[#FCD34D] tracking-wider">MP4</span>
        </div>
      )}
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

  // Dynamic Meme Slots for Empty Frames in Filmstrip: [Slot A, Slot B]
  const [slotMemes, setSlotMemes] = useState<[MemeLibraryItem | null, MemeLibraryItem | null]>([null, null]);

  // Mascot Phase State Machine
  const [botPhase, setBotPhase] = useState<BotPhase>('idle');
  const [showEasyBubble, setShowEasyBubble] = useState(false);
  const nextReplaceSlotRef = useRef<number>(0);

  // Interactive Scissor-Cut state
  const filmstripRef = useRef<HTMLDivElement>(null);
  const [isHoveringStrip, setIsHoveringStrip] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 });
  const [isSnipping, setIsSnipping] = useState(false);
  const [cutFrames, setCutFrames] = useState<Record<string, 'cutting' | 'cut'>>({});

  const animTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      animTimersRef.current.forEach(clearTimeout);
      animTimersRef.current = [];
    };
  }, []);

  // Track cursor position inside filmstrip for custom scissors
  const handleStripMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!filmstripRef.current) return;
    const rect = filmstripRef.current.getBoundingClientRect();
    setCursorPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  // Trigger Interactive Scissor Cut on a frame
  const handleCutFrame = (instanceKey: string) => {
    if (cutFrames[instanceKey]) return;

    // 1. Physically snap scissor blades shut
    setIsSnipping(true);
    const snipTimer = setTimeout(() => setIsSnipping(false), 260);
    animTimersRef.current.push(snipTimer);

    // 2. Set state to 'cutting' (triggers amber flash line, CUT badge, left/right physics drop)
    setCutFrames(prev => ({ ...prev, [instanceKey]: 'cutting' }));

    // 3. After 560ms (split animation finishes), transition to 'cut' (recessed splice gap)
    const dropTimer = setTimeout(() => {
      setCutFrames(prev => ({ ...prev, [instanceKey]: 'cut' }));
    }, 560);
    animTimersRef.current.push(dropTimer);

    // 4. Restore frame after exactly 1 full rolling cycle (28s)
    const restoreTimer = setTimeout(() => {
      setCutFrames(prev => {
        const next = { ...prev };
        delete next[instanceKey];
        return next;
      });
    }, FULL_ROLL_MS);
    animTimersRef.current.push(restoreTimer);
  };

  // Trigger Interactive Meme Fetch Sequence
  const handleFetchMeme = () => {
    if (botPhase !== 'idle') return;

    animTimersRef.current.forEach(clearTimeout);
    animTimersRef.current = [];
    setShowEasyBubble(false);

    // 1. Glide to cupboard (700ms)
    setBotPhase('to-cupboard');

    const t1 = setTimeout(() => {
      // 2. Open drawer & search (850ms)
      setBotPhase('searching');

      const t2 = setTimeout(() => {
        // 3. Glide to computer carrying meme cartridge (1050ms)
        setBotPhase('to-computer');

        const t3 = setTimeout(() => {
          // 4. Insert into computer (650ms)
          setBotPhase('inserting');

          // Pick random meme avoiding whatever is already displayed in slots
          const currentIds = slotMemes.filter(Boolean).map(m => m!.id);
          const pool = MEME_LIBRARY.filter(m => !currentIds.includes(m.id));
          const candidates = pool.length > 0 ? pool : MEME_LIBRARY;
          const pickedMeme = candidates[Math.floor(Math.random() * candidates.length)];

          setSlotMemes(prev => {
            if (!prev[0]) {
              return [pickedMeme, prev[1]];
            } else if (!prev[1]) {
              return [prev[0], pickedMeme];
            } else {
              const target = nextReplaceSlotRef.current;
              nextReplaceSlotRef.current = target === 0 ? 1 : 0;
              return target === 0 ? [pickedMeme, prev[1]] : [prev[0], pickedMeme];
            }
          });

          const t4 = setTimeout(() => {
            // 5. Return to docking pod (850ms)
            setBotPhase('returning');

            const t5 = setTimeout(() => {
              // 6. Reset to idle with friendly bubble
              setBotPhase('idle');
              setShowEasyBubble(true);
              const t6 = setTimeout(() => {
                setShowEasyBubble(false);
              }, 1400);
              animTimersRef.current.push(t6);
            }, 850);
            animTimersRef.current.push(t5);
          }, 650);
          animTimersRef.current.push(t4);
        }, 1050);
        animTimersRef.current.push(t3);
      }, 850);
      animTimersRef.current.push(t2);
    }, 700);
    animTimersRef.current.push(t1);
  };

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

  // Internal visual element of a frame (rendered normally or duplicated into split halves)
  const renderFrameVisual = (frameType: FrameSlotType) => {
    const meme = frameType === 'slotA' ? slotMemes[0] : frameType === 'slotB' ? slotMemes[1] : null;
    const isFastcutz = frameType === 'fastcutz';
    const hasMeme = meme !== null;

    return (
      <div
        className={`w-full h-full rounded-lg border flex flex-col justify-between p-1.5 md:p-2 relative overflow-hidden transition-all ${
          hasMeme
            ? 'bg-black border-[#2DD4BF]/60 shadow-[0_0_20px_-6px_rgba(45,212,191,0.35)]'
            : isFastcutz
            ? 'bg-[#1C1A17] border-[#E8872A]/50 shadow-[0_0_20px_-8px_rgba(232,135,42,0.25)]'
            : 'bg-[#1A1917] border-[#2C2B28]'
        }`}
      >
        {/* If this slot holds a meme, render auto-playing looping video background */}
        {hasMeme && (
          <div className="absolute inset-0 z-0 overflow-hidden">
            <video
              src={meme.url}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/60 pointer-events-none" />
          </div>
        )}

        {/* Top Sprocket Rail */}
        <div className="flex items-center justify-between px-1 relative z-10">
          <div className="flex items-center space-x-1.5">
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
          <span
            className={`font-mono text-[8px] md:text-[9px] tabular-nums tracking-widest ${
              hasMeme
                ? 'text-[#2DD4BF] font-semibold'
                : isFastcutz
                ? 'text-[#E8872A] font-bold'
                : 'text-[#52504B]'
            }`}
          >
            {hasMeme
              ? 'MEME ON AIR'
              : isFastcutz
              ? 'F03'
              : frameType === 'welcome'
              ? 'REC · 01'
              : frameType === 'to'
              ? 'F02'
              : 'F00'}
          </span>
          <div className="flex items-center space-x-1.5">
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
        </div>

        {/* Frame Center Content */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden z-10 my-0.5">
          {hasMeme ? (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-black/60 border border-[#2DD4BF]/40 backdrop-blur-sm shadow-sm">
              <span className="text-[10px] md:text-[11px] font-bold text-[#F4F2EE] tracking-wide truncate max-w-[170px]">
                {meme.title.toUpperCase()}
              </span>
            </div>
          ) : (
            <>
              {frameType === 'slotA' && (
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className="absolute top-0.5 left-1.5 w-1.5 h-1.5 border-t border-l border-[#33312B]" />
                  <div className="absolute top-0.5 right-1.5 w-1.5 h-1.5 border-t border-r border-[#33312B]" />
                  <div className="absolute bottom-0.5 left-1.5 w-1.5 h-1.5 border-b border-l border-[#33312B]" />
                  <div className="absolute bottom-0.5 right-1.5 w-1.5 h-1.5 border-b border-r border-[#33312B]" />
                  <span className="text-[8.5px] font-mono text-[#52504B] tracking-wider">[EMPTY SLOT A]</span>
                </div>
              )}
              {frameType === 'welcome' && (
                <span className="text-2xl md:text-3xl font-bold tracking-[0.14em] text-[#F4F2EE] font-sans">
                  WELCOME
                </span>
              )}
              {frameType === 'to' && (
                <span className="text-2xl md:text-3xl font-semibold tracking-[0.2em] text-[#A19E97] font-sans">
                  TO
                </span>
              )}
              {frameType === 'fastcutz' && (
                <span className="text-2xl md:text-3xl font-extrabold tracking-tight">
                  <span className="text-[#F4F2EE]">Fastcutz</span>
                  <span className="text-[#E8872A]">.ai</span>
                </span>
              )}
              {frameType === 'slotB' && (
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className="absolute top-0.5 left-1.5 w-1.5 h-1.5 border-t border-l border-[#33312B]" />
                  <div className="absolute top-0.5 right-1.5 w-1.5 h-1.5 border-t border-r border-[#33312B]" />
                  <div className="absolute bottom-0.5 left-1.5 w-1.5 h-1.5 border-b border-l border-[#33312B]" />
                  <div className="absolute bottom-0.5 right-1.5 w-1.5 h-1.5 border-b border-r border-[#33312B]" />
                  <span className="text-[8.5px] font-mono text-[#52504B] tracking-wider">[EMPTY SLOT B]</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom Sprocket Rail */}
        <div className="flex items-center justify-between px-1 relative z-10">
          <div className="flex items-center space-x-1.5">
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
          <span className="font-mono text-[8px] md:text-[9px] text-[#52504B] tabular-nums tracking-widest">
            {frameType === 'slotA' ? '00:00:12' : frameType === 'welcome' ? '00:01:00' : frameType === 'to' ? '00:02:00' : frameType === 'fastcutz' ? '00:03:00' : '00:04:00'}
          </span>
          <div className="flex items-center space-x-1.5">
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0E0E0D] border border-[#2A2926]" />
          </div>
        </div>
      </div>
    );
  };

  // Helper to render individual filmstrip frame (supporting normal, cutting, and cut splice-gap states)
  const renderFilmstripFrame = (frameType: FrameSlotType, instanceKey: string) => {
    const state = cutFrames[instanceKey];

    return (
      <div
        key={instanceKey}
        className="w-[220px] md:w-[250px] h-[82px] md:h-[92px] shrink-0 relative select-none"
      >
        {/* State 1: Normal Interactive Frame (Scissors hover & click) */}
        {!state && (
          <div
            onClick={() => handleCutFrame(instanceKey)}
            className="w-full h-full cursor-pointer group rounded-lg transition-all hover:border-[#E8872A]/80 hover:shadow-[0_0_14px_rgba(232,135,42,0.25)]"
          >
            {renderFrameVisual(frameType)}
          </div>
        )}

        {/* State 2: 'cutting' (0–560ms) - Left/right split shear and drop + amber cut line + CUT badge */}
        {state === 'cutting' && (
          <div className="w-full h-full relative overflow-visible rounded-lg bg-[#0B0B0A]/90 border border-[#2C2B28]/50">
            {/* Left half with inset(0 50% 0 0) and animate-frame-split-left */}
            <div
              className="absolute inset-0 rounded-lg overflow-hidden animate-frame-split-left pointer-events-none"
              style={{ clipPath: 'inset(0 50% 0 0)' }}
            >
              {renderFrameVisual(frameType)}
            </div>

            {/* Right half with inset(0 0 0 50%) and animate-frame-split-right */}
            <div
              className="absolute inset-0 rounded-lg overflow-hidden animate-frame-split-right pointer-events-none"
              style={{ clipPath: 'inset(0 0 0 50%)' }}
            >
              {renderFrameVisual(frameType)}
            </div>

            {/* Vertical Amber Cut Slice Line */}
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-[#E8872A] shadow-[0_0_10px_#E8872A] animate-cut-slice-line z-30 pointer-events-none" />

            {/* Floating ✂ CUT Badge */}
            <div className="absolute top-1/2 left-1/2 z-40 pointer-events-none animate-cut-badge-pop whitespace-nowrap">
              <span className="px-2 py-0.5 rounded-full bg-[#1C1A17] border border-[#E8872A] text-[#FCD34D] font-mono text-[9px] font-bold shadow-lg">
                ✂ CUT
              </span>
            </div>
          </div>
        )}

        {/* State 3: 'cut' (560ms until 1 full roll finishes) - Clean Recessed Cutout Slot */}
        {state === 'cut' && (
          <div className="w-full h-full rounded-lg border border-dashed border-[#E8872A]/30 bg-[#0B0B0A]/90 flex flex-col items-center justify-center space-y-1 p-2 relative overflow-hidden">
            <div className="absolute top-1.5 inset-x-2 flex items-center justify-between opacity-30">
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#2A2926]" />
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#2A2926]" />
            </div>
            <div className="flex items-center space-x-1 text-[#E8872A]/70">
              <span className="text-xs">✂</span>
              <span className="font-mono text-[8px] md:text-[9px] text-[#A19E97]/80 tracking-widest uppercase">
                SPLICE GAP
              </span>
            </div>
            <span className="font-mono text-[7px] text-[#52504B] tracking-wider">
              RESTORES NEXT ROLL
            </span>
            <div className="absolute bottom-1.5 inset-x-2 flex items-center justify-between opacity-30">
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#2A2926]" />
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#2A2926]" />
            </div>
          </div>
        )}
      </div>
    );
  };

  // Robot transition speed mapping
  const robotTransitionDuration =
    botPhase === 'to-computer'
      ? 'duration-[1050ms]'
      : botPhase === 'returning'
      ? 'duration-[850ms]'
      : botPhase === 'to-cupboard'
      ? 'duration-[700ms]'
      : 'duration-300';

  return (
    <div className="min-h-screen bg-[#0E0E0D] text-[#F4F2EE] flex flex-col overflow-y-auto">
      {/* Top Rolling Cinema Filmstrip Hero with Custom Scissor Cursor */}
      <section id="hero-space" className="w-full overflow-hidden pt-4 pb-2">
        <div
          ref={filmstripRef}
          onMouseEnter={() => setIsHoveringStrip(true)}
          onMouseLeave={() => setIsHoveringStrip(false)}
          onMouseMove={handleStripMouseMove}
          className={`w-full relative overflow-hidden py-1.5 bg-[#141412] border-y border-[#2C2B28] ${
            isHoveringStrip ? 'md:cursor-none' : ''
          }`}
        >
          {/* Subtle Discoverability Hint */}
          <div className="pointer-events-none absolute top-1.5 right-4 z-20 flex items-center space-x-1 opacity-70">
            <span className="text-[10px] font-mono text-[#6B6862] tracking-wider">Click any frame to cut ✂</span>
          </div>

          {/* Left & Right Gradient Fade Masks */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 md:w-36 bg-gradient-to-r from-[#0E0E0D] to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 md:w-36 bg-gradient-to-l from-[#0E0E0D] to-transparent z-10" />

          {/* Floating Custom Studio Scissor Cursor (Follows Pointer & Snips on Click) */}
          {isHoveringStrip && (
            <div
              className="pointer-events-none absolute z-40 transition-transform duration-75 ease-out"
              style={{
                left: `${cursorPos.x}px`,
                top: `${cursorPos.y}px`,
                transform: 'translate(-30%, -30%) rotate(-25deg)',
                willChange: 'left, top'
              }}
            >
              <svg
                viewBox="0 0 28 28"
                className="w-7 h-7 overflow-visible drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Top Blade & Handle */}
                <g className={isSnipping ? 'animate-scissor-top' : ''}>
                  <path
                    d="M12 14 L26 8 C27 7.5 26.5 6 25 6.5 L12 12 Z"
                    fill="#F4F2EE"
                    stroke="#C5C2BA"
                    strokeWidth="0.5"
                  />
                  <path
                    d="M12 14 C10 13 8 10 5 10 C2 10 1 13 1 15 C1 18 3 20 6 19 C9 18 11 16 12 14 Z"
                    fill="none"
                    stroke="#E8872A"
                    strokeWidth="2"
                  />
                </g>
                {/* Bottom Blade & Handle */}
                <g className={isSnipping ? 'animate-scissor-bottom' : ''}>
                  <path
                    d="M12 14 L26 20 C27 20.5 26.5 22 25 21.5 L12 16 Z"
                    fill="#E6E3DC"
                    stroke="#A19E97"
                    strokeWidth="0.5"
                  />
                  <path
                    d="M12 14 C10 15 8 18 5 18 C2 18 1 15 1 13 C1 10 3 8 6 9 C9 10 11 12 12 14 Z"
                    fill="none"
                    stroke="#E8872A"
                    strokeWidth="2"
                  />
                </g>
                {/* Pivot Screw */}
                <circle cx="12" cy="14" r="2" fill="#E8872A" stroke="#1F1E1C" strokeWidth="0.8" />
                <circle cx="12" cy="14" r="0.75" fill="#FFFFFF" />
              </svg>
            </div>
          )}

          {/* Marquee Track (Smooth, continuous -50% marquee loop) */}
          <div className="flex w-max animate-filmstrip-marquee select-none">
            {/* Copy 1 (0% to -50%) - 2 sets of the 5-frame sequence */}
            <div className="flex items-center space-x-3 md:space-x-4 pr-3 md:pr-4 shrink-0">
              {SEQUENCE_ORDER.map((slot, i) => renderFilmstripFrame(slot, `s1_${slot}_${i}`))}
              {SEQUENCE_ORDER.map((slot, i) => renderFilmstripFrame(slot, `s2_${slot}_${i}`))}
            </div>
            {/* Copy 2 (-50% to -100%) - 2 identical sets */}
            <div className="flex items-center space-x-3 md:space-x-4 pr-3 md:pr-4 shrink-0" aria-hidden="true">
              {SEQUENCE_ORDER.map((slot, i) => renderFilmstripFrame(slot, `s3_${slot}_${i}`))}
              {SEQUENCE_ORDER.map((slot, i) => renderFilmstripFrame(slot, `s4_${slot}_${i}`))}
            </div>
          </div>
        </div>
      </section>

      {/* Middle Interactive Demo Stage: Cupboard (Left) -> Docking Pod / Fastcutz Robot (Center-Left) -> Computer Monitor (Right) */}
      <section className="relative w-full max-w-6xl mx-auto h-[145px] md:h-[160px] mt-2 mb-0 px-4 flex items-end">
        {/* Left Side: Clickable "MEME" Filing Cabinet / Cupboard */}
        <button
          onClick={handleFetchMeme}
          disabled={botPhase !== 'idle'}
          className={`absolute left-3 md:left-8 bottom-2 z-20 flex flex-col items-center group focus:outline-none ${
            botPhase !== 'idle' ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'
          }`}
          title="Click to fetch a meme reaction"
        >
          {/* Cupboard SVG */}
          <div className="w-[84px] md:w-[88px] h-[94px] md:h-[98px] transition-transform group-hover:scale-[1.02]">
            <svg
              viewBox="0 0 88 98"
              className="w-full h-full drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Outer Cabinet Shell */}
              <rect x="8" y="8" width="72" height="84" rx="6" fill="#1C1B19" stroke="#35332F" strokeWidth="1.5" />
              <rect x="12" y="12" width="64" height="76" rx="4" fill="#161614" />

              {/* Status Indicator LED */}
              <circle cx="18" cy="18" r="2" fill="#2DD4BF" opacity="0.9" />

              {/* Top Drawer (Slides open when searching) */}
              <g className={botPhase === 'searching' ? 'translate-x-2 transition-transform duration-300' : 'transition-transform duration-300'}>
                <rect x="14" y="24" width="60" height="30" rx="3.5" fill="#242320" stroke="#3A3833" strokeWidth="1" />
                <rect x="36" y="37" width="16" height="4" rx="2" fill="#E8872A" />
                {/* Plaque: MEME */}
                <rect x="27" y="27" width="34" height="7.5" rx="2" fill="#141412" stroke="#2C2B28" strokeWidth="0.8" />
                <text
                  x="44"
                  y="33"
                  textAnchor="middle"
                  fill="#E8872A"
                  fontSize="6"
                  fontWeight="bold"
                  fontFamily="monospace"
                  letterSpacing="0.2em"
                >
                  MEME
                </text>
              </g>

              {/* Bottom Drawer */}
              <g>
                <rect x="14" y="56" width="60" height="30" rx="3.5" fill="#1F1E1C" stroke="#2E2D29" strokeWidth="1" />
                <rect x="36" y="69" width="16" height="4" rx="2" fill="#6E6B64" />
                {/* Plaque: VAULT */}
                <rect x="27" y="59" width="34" height="7.5" rx="2" fill="#141412" stroke="#2C2B28" strokeWidth="0.8" />
                <text
                  x="44"
                  y="65"
                  textAnchor="middle"
                  fill="#6E6B64"
                  fontSize="6"
                  fontFamily="monospace"
                  letterSpacing="0.12em"
                >
                  VAULT
                </text>
              </g>
            </svg>
          </div>

          {/* Action Label Badge */}
          <span
            className={`mt-1 text-[10px] font-mono px-2.5 py-0.5 rounded-full border transition-all shadow-sm ${
              botPhase === 'searching'
                ? 'bg-[#E8872A]/20 border-[#E8872A] text-[#FCD34D]'
                : botPhase !== 'idle'
                ? 'bg-[#1F1E1C] border-[#2C2B28] text-[#6E6B64]'
                : 'bg-[#1F1E1C] border-[#2C2B28] text-[#A19E97] group-hover:border-[#E8872A] group-hover:text-[#F4F2EE] group-hover:scale-105'
            }`}
          >
            {botPhase === 'searching' ? 'Searching...' : botPhase !== 'idle' ? 'Adding...' : '⚡ Click to fetch meme'}
          </span>
        </button>

        {/* Center-Left: Fixed Docking Pod (Permanently anchored flush on top of Upload Dropbox) */}
        <div className="absolute left-[25%] md:left-[29%] -translate-x-1/2 bottom-0 z-10 pointer-events-none select-none">
          <StationaryDockingPod />
        </div>

        {/* Traveling Cute Fastcutz Robot */}
        <div
          className={`absolute z-30 transition-all ${robotTransitionDuration} ease-in-out pointer-events-none select-none ${
            botPhase === 'idle'
              ? 'left-[25%] md:left-[29%] -translate-x-1/2 bottom-[12px]'
              : botPhase === 'to-cupboard'
              ? 'left-[98px] md:left-[118px] -translate-x-1/2 bottom-[20px] -translate-y-2'
              : botPhase === 'searching'
              ? 'left-[98px] md:left-[118px] -translate-x-1/2 bottom-[18px]'
              : botPhase === 'to-computer'
              ? 'left-[calc(100%-150px)] md:left-[calc(100%-170px)] -translate-x-1/2 bottom-[22px]'
              : botPhase === 'inserting'
              ? 'left-[calc(100%-150px)] md:left-[calc(100%-170px)] -translate-x-1/2 bottom-[18px]'
              : /* returning */ 'left-[25%] md:left-[29%] -translate-x-1/2 bottom-[12px]'
          }`}
        >
          {/* Floating Status & Speech Bubbles */}
          {botPhase === 'searching' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#1F1E1C] border border-[#E8872A]/50 text-[#FCD34D] font-mono text-[9px] shadow-lg animate-bounce">
              Searching memes... 🔍
            </div>
          )}
          {botPhase === 'to-computer' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#1F1E1C] border border-[#2DD4BF]/50 text-[#5EEAD4] font-mono text-[9px] shadow-lg">
              Adding meme... 🎬
            </div>
          )}
          {botPhase === 'inserting' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#14B8A6]/20 border border-[#2DD4BF] text-[#5EEAD4] font-mono text-[9px] shadow-lg animate-pulse">
              Injecting to strip! ⚡
            </div>
          )}
          {botPhase === 'idle' && showEasyBubble && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#1F1E1C] border border-[#2DD4BF]/50 text-[#5EEAD4] font-mono text-[9px] shadow-lg animate-float-badge">
              Easy! ✨
            </div>
          )}

          <TravelingRobot
            isSearching={botPhase === 'searching'}
            isCarrying={botPhase === 'to-computer' || botPhase === 'inserting'}
          />
        </div>

        {/* Right Side: Studio Computer / Timeline Monitor */}
        <div className="absolute right-3 md:right-8 bottom-2 z-20 flex flex-col items-center pointer-events-none select-none">
          <div className={`w-[100px] md:w-[104px] h-[84px] md:h-[88px] ${botPhase === 'inserting' ? 'animate-computer-pop' : ''}`}>
            <svg
              viewBox="0 0 104 88"
              className="w-full h-full drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Monitor Stand Base & Neck */}
              <rect x="36" y="74" width="32" height="6" rx="2" fill="#141412" stroke="#2C2B28" strokeWidth="1" />
              <rect x="49" y="60" width="6" height="15" rx="1" fill="#262522" stroke="#35332F" strokeWidth="1" />

              {/* Monitor Outer Frame */}
              <rect x="4" y="4" width="96" height="58" rx="6" fill="#1F1E1C" stroke="#35332F" strokeWidth="1.2" />

              {/* Display Screen */}
              <rect
                x="8"
                y="8"
                width="88"
                height="50"
                rx="4"
                fill={botPhase === 'inserting' ? '#142E2B' : '#0E0E0D'}
                stroke={botPhase === 'inserting' ? '#2DD4BF' : '#1A1917'}
                strokeWidth="1"
              />

              {botPhase === 'inserting' ? (
                /* Inserting Screen Flash: MEME ADDED ✓ */
                <g>
                  <rect x="16" y="22" width="72" height="22" rx="3" fill="#14B8A6" fillOpacity="0.25" stroke="#2DD4BF" strokeWidth="0.8" />
                  <text
                    x="52"
                    y="36"
                    textAnchor="middle"
                    fill="#5EEAD4"
                    fontSize="7"
                    fontWeight="bold"
                    fontFamily="monospace"
                    letterSpacing="0.1em"
                  >
                    MEME ADDED ✓
                  </text>
                </g>
              ) : (
                /* Idle Screen: Mini Studio Timeline Tracks */
                <g>
                  <rect x="14" y="16" width="50" height="4" rx="2" fill="#2C2B28" />
                  <rect x="14" y="24" width="70" height="4" rx="2" fill="#E8872A" opacity="0.8" />
                  <rect x="14" y="32" width="38" height="4" rx="2" fill="#2DD4BF" opacity="0.8" />
                  {/* Red Playhead line */}
                  <line x1="42" y1="12" x2="42" y2="40" stroke="#EF4444" strokeWidth="1.2" />
                  <text x="52" y="47" textAnchor="middle" fill="#52504B" fontSize="5.5" fontFamily="monospace">
                    STUDIO MONITOR
                  </text>
                </g>
              )}
            </svg>
          </div>

          <span className="mt-1 text-[9.5px] font-mono text-[#6E6B64]">
            {botPhase === 'inserting' ? 'Synced to Filmstrip' : 'Timeline Monitor'}
          </span>
        </div>
      </section>

      {/* Main Content Area: Lowered Upload Dropbox & Mode Selection */}
      <main className="max-w-6xl mx-auto w-full px-6 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mt-1">
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
      <footer className="max-w-6xl mx-auto w-full px-6 pt-4 pb-6 border-t border-[#2C2B28] text-center text-xs text-[#6E6B64] mt-auto">
        AI Video Editor • 100% Client-Side Processing • Scaler YIIC 9.0 Week 2
      </footer>
    </div>
  );
};
