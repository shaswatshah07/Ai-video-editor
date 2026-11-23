import React, { useState, useEffect, useRef } from 'react';

export interface Screen3RobotStageProps {
  mode: 'rendering' | 'complete';
}

/**
 * Fastcutz Robot Mascot Avatar
 * Reusable mascot matching Screen 1's identity:
 * - Pearl-white / cool-silver rounded head & compact body (#F4F6FA / #E2E8F0)
 * - Glossy dark visor (#0F172A)
 * - Expressive cyan/teal eyes (#22D3EE), switching between normal, happy (^ ^), and reading
 * - Terracotta antenna tip (#E8632A)
 */
interface RobotAvatarProps {
  eyeMode?: 'normal' | 'happy' | 'reading';
  headTilt?: number;
  holdingItem?: 'sticky-note' | 'puzzle-block' | 'broom' | 'book' | null;
  isArranging?: boolean;
}

const RobotAvatar: React.FC<RobotAvatarProps> = ({
  eyeMode = 'normal',
  headTilt = 0,
  holdingItem = null,
  isArranging = false,
}) => {
  return (
    <div
      className={`relative w-[54px] sm:w-[62px] h-[58px] sm:h-[66px] flex items-center justify-center ${
        isArranging ? 'animate-fastcutz-arrange' : ''
      }`}
      style={{
        transform: headTilt ? `rotate(${headTilt}deg)` : undefined,
        transition: 'transform 300ms ease-out',
      }}
    >
      <svg
        viewBox="0 0 60 64"
        className="w-full h-full overflow-visible drop-shadow-[0_4px_10px_rgba(0,0,0,0.18)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g>
          {/* Top Antenna Stem */}
          <line x1="30" y1="17" x2="30" y2="8" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" />
          {/* Glowing Terracotta Antenna Bulb */}
          <circle cx="30" cy="6.5" r="3.5" fill="#E8632A" />
          <circle cx="30" cy="6.5" r="5.5" fill="#E8632A" opacity="0.28" />
          <circle cx="28.8" cy="5.2" r="1" fill="#FFFFFF" opacity="0.9" />

          {/* Left & Right Ear Bolt Accents */}
          <rect x="5" y="27" width="3" height="10" rx="1.5" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1" />
          <rect x="52" y="27" width="3" height="10" rx="1.5" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1" />

          {/* Sleek Crisp White/Silver Head Shell with Subtle Outline */}
          <rect
            x="7"
            y="16"
            width="46"
            height="36"
            rx="14"
            fill="#F4F6FA"
            stroke="#94A3B8"
            strokeWidth="1.5"
          />

          {/* Curved Dark Glossy Visor Face */}
          <rect
            x="11.5"
            y="22"
            width="37"
            height="22"
            rx="8"
            fill="#0F172A"
            stroke="#1E293B"
            strokeWidth="1"
          />
          {/* Visor Glare Curve */}
          <path
            d="M16 25 C23 23.5 37 23.5 44 25"
            stroke="#334155"
            strokeWidth="1"
            strokeLinecap="round"
          />

          {/* Expressive Eyes */}
          {eyeMode === 'happy' ? (
            /* Joyful Curved ^ ^ Eyes while swinging */
            <g>
              <path
                d="M 18 33 Q 21.5 28 25 33"
                stroke="#22D3EE"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 35 33 Q 38.5 28 42 33"
                stroke="#22D3EE"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          ) : eyeMode === 'reading' ? (
            /* Downward-glancing eyes while reading book */
            <g>
              <rect x="18" y="31" width="7.5" height="6.5" rx="3.2" fill="#22D3EE" />
              <circle cx="23" cy="33.8" r="1.1" fill="#FFFFFF" />
              <rect x="34.5" y="31" width="7.5" height="6.5" rx="3.2" fill="#22D3EE" />
              <circle cx="39.5" cy="33.8" r="1.1" fill="#FFFFFF" />
            </g>
          ) : (
            /* Normal Alert Glowing Cyan Eyes */
            <g className="animate-fastcutz-blink">
              <rect x="17.5" y="28" width="8" height="9" rx="4" fill="#22D3EE" />
              <circle cx="23" cy="30.2" r="1.3" fill="#FFFFFF" />
              <rect x="34.5" y="28" width="8" height="9" rx="4" fill="#22D3EE" />
              <circle cx="40" cy="30.2" r="1.3" fill="#FFFFFF" />
            </g>
          )}

          {/* Cute Mint Smile Line */}
          <path
            d="M27 39.5 Q30 41.5 33 39.5"
            stroke="#10B981"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />

          {/* Compact Rounded Paws */}
          <ellipse cx="14" cy="51" rx="4" ry="3" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1" />
          <ellipse cx="46" cy="51" rx="4" ry="3" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1" />
        </g>
      </svg>

      {/* Held Item: Sticky Note */}
      {holdingItem === 'sticky-note' && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="w-4 h-4 bg-[#FDE047] border border-[#CA8A04] rounded-xs shadow-xs rotate-[-8deg] flex flex-col justify-center items-center p-0.5">
            <div className="w-2.5 h-[1px] bg-[#A16207] mb-0.5" />
            <div className="w-2 h-[1px] bg-[#A16207]" />
          </div>
        </div>
      )}

      {/* Held Item: Puzzle Block */}
      {holdingItem === 'puzzle-block' && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="w-4.5 h-4 bg-[#E8632A] border border-[#C25E1F] rounded-xs shadow-[0_2px_8px_rgba(232,99,42,0.4)] flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white/60" />
          </div>
        </div>
      )}

      {/* Held Item: Broom (Sweeping) */}
      {holdingItem === 'broom' && (
        <div className="absolute -bottom-2 -left-3 z-30 pointer-events-none animate-broom-sweep origin-top">
          <svg viewBox="0 0 24 38" className="w-6 h-9.5 overflow-visible" fill="none">
            {/* Wooden Handle */}
            <line x1="18" y1="2" x2="7" y2="25" stroke="#B47B48" strokeWidth="2.5" strokeLinecap="round" />
            {/* Bristles Head */}
            <path
              d="M 5 25 L 12 23 L 15 35 L 2 35 Z"
              fill="#EAB308"
              stroke="#CA8A04"
              strokeWidth="0.8"
            />
            {/* Bristle texture lines */}
            <line x1="5" y1="27" x2="4" y2="34" stroke="#A16207" strokeWidth="0.8" />
            <line x1="8" y1="26" x2="8" y2="34" stroke="#A16207" strokeWidth="0.8" />
            <line x1="11" y1="25" x2="12" y2="34" stroke="#A16207" strokeWidth="0.8" />
          </svg>
        </div>
      )}

      {/* Held Item: Open Mini Hardcover Book */}
      {holdingItem === 'book' && (
        <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 z-30 pointer-events-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]">
          <div className="relative w-[32px] sm:w-[36px] h-[22px] sm:h-[25px] flex items-center justify-center">
            {/* Terracotta Book Cover Spine & Backing */}
            <div className="absolute inset-0 bg-[#D96B27] border border-[#B45309] rounded-[3px] shadow-sm transform -rotate-1" />
            {/* Open Pages Spread (Cream White with Spine Fold) */}
            <div className="relative z-10 w-[28px] sm:w-[32px] h-[18px] sm:h-[20px] bg-[#FEF3C7] border border-[#FDE68A] rounded-[2px] flex items-center justify-between px-1 py-0.5 shadow-inner">
              {/* Left Page Text Lines */}
              <div className="flex-1 flex flex-col justify-between h-full pr-0.5 border-r border-[#D97706]/30">
                <div className="w-full h-[1.5px] bg-[#44403C] rounded-full" />
                <div className="w-3/4 h-[1.5px] bg-[#57534E] rounded-full" />
                <div className="w-4/5 h-[1.5px] bg-[#78716C] rounded-full" />
              </div>
              {/* Right Page Text Lines */}
              <div className="flex-1 flex flex-col justify-between h-full pl-0.5">
                <div className="w-full h-[1.5px] bg-[#44403C] rounded-full" />
                <div className="w-4/5 h-[1.5px] bg-[#57534E] rounded-full" />
                <div className="w-2/3 h-[1.5px] bg-[#78716C] rounded-full" />
              </div>
            </div>
            {/* Ribbon Bookmark Tail */}
            <div className="absolute -bottom-1 right-2.5 w-1 h-2 bg-[#DC2626] rounded-b-xs transform rotate-12" />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Sticky-Note Edit Board (Left Side in Scene A)
 */
const StickyNotesBoard: React.FC<{ isReading: boolean }> = ({ isReading }) => {
  return (
    <div className="relative w-[88px] sm:w-[112px] h-[95px] sm:h-[110px] flex items-center justify-center">
      <svg
        viewBox="0 0 112 110"
        className="w-full h-full overflow-visible drop-shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Easel Tripod Legs */}
        <line x1="56" y1="22" x2="56" y2="108" stroke="#5A3A22" strokeWidth="3" strokeLinecap="round" />
        <line x1="56" y1="22" x2="18" y2="108" stroke="#7A5334" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="56" y1="22" x2="94" y2="108" stroke="#7A5334" strokeWidth="3.5" strokeLinecap="round" />
        {/* Easel Cross Shelf */}
        <line x1="24" y1="78" x2="88" y2="78" stroke="#8B5E3C" strokeWidth="3.5" strokeLinecap="round" />

        {/* Board Outer Wooden Frame */}
        <rect
          x="10"
          y="10"
          width="92"
          height="66"
          rx="5"
          className="fill-[#7A5334] dark:fill-[#2E241C] stroke-[#5A3A22] dark:stroke-[#6B533E]"
          strokeWidth="1.5"
        />

        {/* Cork Surface */}
        <rect
          x="14"
          y="14"
          width="84"
          height="58"
          rx="3"
          className="fill-[#C89B6E] dark:fill-[#4B3624]"
        />

        {/* Cork Specks */}
        <circle cx="28" cy="22" r="0.8" fill="#5A3A22" opacity="0.3" />
        <circle cx="48" cy="38" r="0.8" fill="#5A3A22" opacity="0.3" />
        <circle cx="78" cy="25" r="0.8" fill="#5A3A22" opacity="0.3" />
        <circle cx="68" cy="62" r="0.8" fill="#5A3A22" opacity="0.3" />

        {/* Sticky Note 1: Yellow (Top-Left) */}
        <g transform="translate(18, 18) rotate(-4)">
          <rect width="22" height="20" rx="1.5" fill="#FDE047" stroke="#CA8A04" strokeWidth="0.6" />
          <circle cx="11" cy="2.5" r="1.5" fill="#EF4444" />
          <line x1="3" y1="7" x2="19" y2="7" stroke="#854D0E" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="11" x2="16" y2="11" stroke="#854D0E" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="15" x2="14" y2="15" stroke="#854D0E" strokeWidth="0.8" strokeLinecap="round" />
        </g>

        {/* Sticky Note 2: Teal (Top-Right) */}
        <g transform="translate(56, 19) rotate(3)">
          <rect width="22" height="20" rx="1.5" fill="#5EEAD4" stroke="#0D9488" strokeWidth="0.6" />
          <circle cx="11" cy="2.5" r="1.5" fill="#0F766E" />
          <line x1="3" y1="7" x2="19" y2="7" stroke="#115E59" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="11" x2="17" y2="11" stroke="#115E59" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="15" x2="13" y2="15" stroke="#115E59" strokeWidth="0.8" strokeLinecap="round" />
        </g>

        {/* Sticky Note 3: Coral (Bottom-Left) — Highlighted when reading */}
        <g transform="translate(22, 44) rotate(4)">
          <rect
            width="22"
            height="20"
            rx="1.5"
            fill="#FB923C"
            stroke="#EA580C"
            strokeWidth={isReading ? '1.5' : '0.6'}
            className={isReading ? 'animate-pulse' : ''}
          />
          <circle cx="11" cy="2.5" r="1.5" fill="#C2410C" />
          <line x1="3" y1="7" x2="18" y2="7" stroke="#7C2D12" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="11" x2="15" y2="11" stroke="#7C2D12" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="15" x2="11" y2="15" stroke="#7C2D12" strokeWidth="0.8" strokeLinecap="round" />
        </g>

        {/* Sticky Note 4: Rose (Bottom-Right) */}
        <g transform="translate(58, 45) rotate(-3)">
          <rect width="21" height="19" rx="1.5" fill="#FBCFE8" stroke="#DB2777" strokeWidth="0.6" />
          <circle cx="10.5" cy="2.5" r="1.5" fill="#BE185D" />
          <line x1="3" y1="7" x2="17" y2="7" stroke="#831843" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="11" x2="15" y2="11" stroke="#831843" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="3" y1="15" x2="12" y2="15" stroke="#831843" strokeWidth="0.8" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
};

/**
 * Puzzle / Edit Blocks Assembly Zone (Right Side in Scene A)
 */
interface PuzzleZoneProps {
  arrangedCount: number;
}

const PuzzleZone: React.FC<PuzzleZoneProps> = ({ arrangedCount }) => {
  // 4 blocks config: [coral, teal, amber, indigo]
  const blocks = [
    { id: 0, color: '#E8632A', border: '#C25E1F', label: '01', scatter: 'translate(-14px, 8px) rotate(-16deg)' },
    { id: 1, color: '#14B8A6', border: '#0D9488', label: '02', scatter: 'translate(14px, -10px) rotate(20deg)' },
    { id: 2, color: '#F59E0B', border: '#D97706', label: '03', scatter: 'translate(-10px, 18px) rotate(14deg)' },
    { id: 3, color: '#818CF8', border: '#6366F1', label: '04', scatter: 'translate(16px, 16px) rotate(-18deg)' },
  ];

  const allArranged = arrangedCount >= 4;

  return (
    <div className="relative w-[98px] sm:w-[126px] h-[95px] sm:h-[110px] flex items-center justify-center">
      {/* Assembly Mat Base Plate */}
      <div
        className={`w-[78px] sm:w-[94px] h-[72px] sm:h-[84px] rounded-xl bg-[#FAF9F5] dark:bg-[#1A1917] border border-[#E5E2DC] dark:border-[#2C2A27] p-1.5 flex flex-col items-center justify-center relative transition-shadow duration-300 ${
          allArranged ? 'shadow-[0_0_12px_rgba(20,184,166,0.5)] border-[#2DD4BF]' : 'shadow-xs'
        }`}
      >
        {/* Subtle 2x2 grid guideline */}
        <div className="w-[58px] sm:w-[68px] h-[58px] sm:h-[68px] grid grid-cols-2 grid-rows-2 gap-1 relative">
          {blocks.map((block) => {
            const isSnapped = block.id < arrangedCount;
            return (
              <div
                key={block.id}
                className="w-full h-full relative border border-dashed border-[#D8D4CC] dark:border-[#383531] rounded-md flex items-center justify-center"
              >
                {/* The Puzzle Piece */}
                <div
                  style={{
                    backgroundColor: block.color,
                    borderColor: block.border,
                    transform: isSnapped ? 'none' : block.scatter,
                  }}
                  className={`w-full h-full rounded-md border flex items-center justify-center text-[8px] font-mono font-bold text-white shadow-xs transition-all duration-500 ease-out select-none ${
                    isSnapped ? 'z-20' : 'z-10 opacity-75'
                  }`}
                >
                  <span>{block.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Completion spark shimmer indicator */}
        {allArranged && (
          <div className="absolute -top-1.5 -right-1 px-1 py-0.5 rounded-full bg-[#14B8A6] text-white text-[7.5px] font-bold font-mono shadow-xs animate-bounce">
            OK!
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Classic Vintage Wooden Rocking Armchair SVG Components
 * Split into Back Layer & Front Layer for genuine 3D robot seating depth
 */
const RockingChairBack: React.FC = () => {
  return (
    <svg
      viewBox="0 0 140 120"
      className="w-[138px] sm:w-[158px] h-[120px] sm:h-[136px] overflow-visible absolute inset-0 pointer-events-none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Back Rocker Runner */}
      <path d="M 12 114 Q 70 120 128 114" stroke="#5A321C" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      {/* Back Leg Uprights */}
      <line x1="36" y1="74" x2="28" y2="115" stroke="#7C4A2D" strokeWidth="4" strokeLinecap="round" />
      <line x1="102" y1="74" x2="110" y2="115" stroke="#7C4A2D" strokeWidth="4" strokeLinecap="round" />

      {/* Seat Cushion / Pan */}
      <path
        d="M 32 74 L 106 74 Q 106 82 100 84 L 38 84 Q 32 82 32 74 Z"
        fill="#9A3412"
        stroke="#7C2D12"
        strokeWidth="1.2"
      />

      {/* Slatted Wooden Backrest on the left */}
      <line x1="36" y1="74" x2="16" y2="16" stroke="#7C4A2D" strokeWidth="5" strokeLinecap="round" />
      <path d="M 14 18 Q 30 10 46 18" stroke="#A46843" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* Slats */}
      <line x1="24" y1="74" x2="20" y2="20" stroke="#935733" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="32" y1="74" x2="30" y2="17" stroke="#935733" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="40" y1="74" x2="40" y2="20" stroke="#935733" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
};

const RockingChairFront: React.FC = () => {
  return (
    <svg
      viewBox="0 0 140 120"
      className="w-[138px] sm:w-[158px] h-[120px] sm:h-[136px] overflow-visible absolute inset-0 pointer-events-none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Front Rocker Runner */}
      <path d="M 8 116 Q 70 123 132 116" stroke="#7C4A2D" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M 12 115 Q 70 121 128 115" stroke="#A46843" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.6" />

      {/* Front Leg */}
      <line x1="98" y1="74" x2="108" y2="116" stroke="#7C4A2D" strokeWidth="4.5" strokeLinecap="round" />

      {/* Scrolled Curved Wooden Armrest on front */}
      <path
        d="M 24 50 Q 60 46 102 52 Q 110 54 110 61 Q 107 66 100 65"
        stroke="#A46843"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="108" cy="61" r="3" fill="#7C4A2D" />
      {/* Armrest Post */}
      <line x1="100" y1="56" x2="98" y2="74" stroke="#7C4A2D" strokeWidth="3.5" />

      {/* Signature Spoked Wooden Side Wheel */}
      <g>
        {/* Outer Wheel Rim */}
        <circle cx="68" cy="94" r="20" stroke="#7C4A2D" strokeWidth="3.5" fill="none" />
        <circle cx="68" cy="94" r="19" stroke="#A46843" strokeWidth="1" fill="none" opacity="0.6" />
        {/* Spokes (8 radial lines) */}
        <line x1="68" y1="74" x2="68" y2="114" stroke="#5A321C" strokeWidth="1.8" />
        <line x1="48" y1="94" x2="88" y2="94" stroke="#5A321C" strokeWidth="1.8" />
        <line x1="54" y1="80" x2="82" y2="108" stroke="#5A321C" strokeWidth="1.8" />
        <line x1="54" y1="108" x2="82" y2="80" stroke="#5A321C" strokeWidth="1.8" />
        {/* Center Hub */}
        <circle cx="68" cy="94" r="5" fill="#5A321C" stroke="#A46843" strokeWidth="1.2" />
        <circle cx="68" cy="94" r="2.2" fill="#C68A5D" />
      </g>
    </svg>
  );
};

/**
 * Screen3RobotStage Component
 * Primary storytelling stage for Screen 3
 */
export const Screen3RobotStage: React.FC<Screen3RobotStageProps> = ({ mode }) => {
  // SCENE A (mode === 'rendering') state
  type RenderPhase = 'to-board' | 'reading-notes' | 'to-puzzle' | 'arranging';
  const [renderPhase, setRenderPhase] = useState<RenderPhase>('to-board');
  const [arrangedCount, setArrangedCount] = useState<number>(0);

  // SCENE B (mode === 'complete') state
  type DonePhase = 'sweeping' | 'walking-to-chair' | 'swinging' | 'reading';
  const [donePhase, setDonePhase] = useState<DonePhase>('sweeping');
  const [scraps, setScraps] = useState<{ id: number; left: string; swept: boolean }[]>([
    { id: 1, left: '20%', swept: false },
    { id: 2, left: '33%', swept: false },
    { id: 3, left: '46%', swept: false },
  ]);

  // Timers cleanup ref
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAllTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  // Scene A Animation Loop
  useEffect(() => {
    if (mode !== 'rendering') return;

    clearAllTimers();
    let isMounted = true;

    const runLoop = () => {
      if (!isMounted) return;

      // 1. to-board (750ms glide to left)
      setRenderPhase('to-board');
      const t1 = setTimeout(() => {
        if (!isMounted) return;

        // 2. reading-notes (950ms head tilt & check)
        setRenderPhase('reading-notes');
        const t2 = setTimeout(() => {
          if (!isMounted) return;

          // 3. to-puzzle (950ms carry item right)
          setRenderPhase('to-puzzle');
          const t3 = setTimeout(() => {
            if (!isMounted) return;

            // 4. arranging (850ms micro-hop & snap puzzle piece)
            setRenderPhase('arranging');
            setArrangedCount((prev) => (prev >= 4 ? 0 : prev + 1));

            const t4 = setTimeout(() => {
              if (!isMounted) return;
              runLoop();
            }, 850);
            timersRef.current.push(t4);
          }, 950);
          timersRef.current.push(t3);
        }, 950);
        timersRef.current.push(t2);
      }, 750);
      timersRef.current.push(t1);
    };

    runLoop();

    return () => {
      isMounted = false;
      clearAllTimers();
    };
  }, [mode]);

  // Scene B 4-Phase Completion Sequence
  useEffect(() => {
    if (mode !== 'complete') return;

    clearAllTimers();
    setDonePhase('sweeping');
    setScraps([
      { id: 1, left: '20%', swept: false },
      { id: 2, left: '33%', swept: false },
      { id: 3, left: '46%', swept: false },
    ]);

    // t = 1.2s: sweep scrap 1
    const t1 = setTimeout(() => {
      setScraps((prev) => prev.map((s) => (s.id === 1 ? { ...s, swept: true } : s)));
    }, 1200);

    // t = 2.3s: sweep scrap 2
    const t2 = setTimeout(() => {
      setScraps((prev) => prev.map((s) => (s.id === 2 ? { ...s, swept: true } : s)));
    }, 2300);

    // t = 3.4s: sweep scrap 3
    const t3 = setTimeout(() => {
      setScraps((prev) => prev.map((s) => (s.id === 3 ? { ...s, swept: true } : s)));
    }, 3400);

    // t = 4.0s: Phase 2 - walking-to-chair
    const t4 = setTimeout(() => {
      setDonePhase('walking-to-chair');
    }, 4000);

    // t = 5.0s: Phase 3 - swinging (happy rocking chair)
    const t5 = setTimeout(() => {
      setDonePhase('swinging');
    }, 5000);

    // t = 8.8s: Phase 4 - reading (peaceful gentle rock + open book)
    const t6 = setTimeout(() => {
      setDonePhase('reading');
    }, 8800);

    timersRef.current.push(t1, t2, t3, t4, t5, t6);

    return () => {
      clearAllTimers();
    };
  }, [mode]);

  // -------------------------------------------------------------
  // RENDER: SCENE A (WHILE RENDERING)
  // -------------------------------------------------------------
  if (mode === 'rendering') {
    const isAtBoard = renderPhase === 'to-board' || renderPhase === 'reading-notes';
    const isCarrying = renderPhase === 'to-puzzle';
    const isArranging = renderPhase === 'arranging';

    return (
      <div className="w-full max-w-4xl mx-auto relative h-[140px] sm:h-[155px] mt-2 sm:mt-3 px-2 sm:px-4 overflow-hidden pointer-events-none select-none">
        {/* Left Side: Sticky-Notes Pin Board */}
        <div className="absolute left-2 sm:left-6 bottom-6 z-10 scale-[0.82] sm:scale-100 origin-bottom-left">
          <StickyNotesBoard isReading={renderPhase === 'reading-notes'} />
        </div>

        {/* Right Side: Puzzle Edit Blocks Assembly Zone */}
        <div className="absolute right-2 sm:right-6 bottom-6 z-10 scale-[0.82] sm:scale-100 origin-bottom-right">
          <PuzzleZone arrangedCount={arrangedCount} />
        </div>

        {/* Center Moving Fastcutz Robot */}
        <div
          className={`absolute bottom-6 z-20 transition-all duration-[850ms] ease-in-out scale-[0.85] sm:scale-100 origin-bottom ${
            isAtBoard
              ? 'left-[22%] sm:left-[20%]'
              : 'left-[62%] sm:left-[66%]'
          }`}
        >
          {/* Floating Speech Pill */}
          {renderPhase === 'reading-notes' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-white dark:bg-[#1E1D1B] border border-[#D96B27] dark:border-[#E8632A] text-[#D96B27] dark:text-[#E8632A] font-mono text-[9px] font-bold shadow-md animate-bounce">
              Checking notes...
            </div>
          )}
          {renderPhase === 'arranging' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-white dark:bg-[#1E1D1B] border border-[#0F766E] dark:border-[#2DD4BF] text-[#0F766E] dark:text-[#2DD4BF] font-mono text-[9px] font-bold shadow-md animate-pulse">
              Arranging edits...
            </div>
          )}

          <RobotAvatar
            eyeMode="normal"
            headTilt={renderPhase === 'reading-notes' ? -6 : 0}
            holdingItem={isCarrying ? 'puzzle-block' : null}
            isArranging={isArranging}
          />
        </div>

        {/* Grounded Studio Floor Line */}
        <div className="absolute left-0 right-0 bottom-5 border-b border-[#E5E2DC] dark:border-[#2A2825]" />

        {/* Micro Caption Below Floor Line */}
        <div className="absolute left-0 right-0 bottom-0 text-center text-[10.5px] font-mono text-[#66625B] dark:text-[#8E8980]">
          Fastcutz is putting your edits together...
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: SCENE B (WHEN EXPORT COMPLETES)
  // -------------------------------------------------------------
  const isWalking = donePhase === 'walking-to-chair';
  const isSeated = donePhase === 'swinging' || donePhase === 'reading';

  return (
    <div className="w-full max-w-4xl mx-auto relative h-[136px] sm:h-[150px] my-1 px-2 sm:px-4 overflow-hidden pointer-events-none select-none">
      {/* Sweeping Phase Leftover Trim Scraps */}
      {donePhase === 'sweeping' && (
        <>
          {scraps.map((scrap) => (
            <div
              key={scrap.id}
              style={{ left: scrap.left }}
              className="absolute bottom-5.5 z-10 transition-opacity duration-300"
            >
              {!scrap.swept ? (
                <div
                  className={`w-3.5 h-1.5 rounded-[1px] shadow-2xs rotate-[-8deg] ${
                    scrap.id === 1
                      ? 'bg-[#E8632A]'
                      : scrap.id === 2
                      ? 'bg-[#14B8A6]'
                      : 'bg-[#F59E0B]'
                  }`}
                />
              ) : (
                /* Dust Poof when swept away */
                <div className="w-2.5 h-2.5 rounded-full bg-[#E5E2DC] dark:bg-[#78716C] animate-dust-poof" />
              )}
            </div>
          ))}
        </>
      )}

      {/* Walking or Sweeping Robot (Outside Chair) */}
      {!isSeated && (
        <div
          className={`absolute bottom-5.5 z-20 transition-all duration-[900ms] ease-in-out scale-[0.85] sm:scale-100 origin-bottom ${
            isWalking ? 'left-[calc(100%-150px)] sm:left-[calc(100%-200px)]' : 'left-[22%] sm:left-[30%]'
          }`}
        >
          {donePhase === 'sweeping' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-white dark:bg-[#1E1D1B] border border-[#0F766E] dark:border-[#2DD4BF] text-[#0F766E] dark:text-[#2DD4BF] font-mono text-[9px] font-bold shadow-md">
              Cleaning up trim scraps...
            </div>
          )}

          <RobotAvatar
            eyeMode="normal"
            holdingItem={donePhase === 'sweeping' ? 'broom' : null}
          />
        </div>
      )}

      {/* Classic Vintage Wooden Rocking Armchair Area (Right Side) */}
      <div className="absolute right-[6%] sm:right-[12%] bottom-5 z-20 origin-bottom-right">
        {/* Rocking Pivot Wrapper (Rocks Chair + Seated Robot as a single cohesive unit) */}
        <div
          style={{ transformOrigin: '50% 94%' }}
          className={`relative w-[138px] sm:w-[158px] h-[120px] sm:h-[136px] ${
            donePhase === 'swinging'
              ? 'animate-rocking-chair-happy'
              : donePhase === 'reading'
              ? 'animate-rocking-chair-gentle'
              : ''
          }`}
        >
          {/* Layer 1: Back of Rocking Chair (backrest + seat cushion + back runner) */}
          <RockingChairBack />

          {/* Layer 2: Seated Fastcutz Robot (Sandwiched snugly inside chair) */}
          {isSeated && (
            <div className="absolute left-[36px] sm:left-[42px] bottom-[34px] sm:bottom-[38px] z-10 scale-[0.86] sm:scale-[0.90] origin-bottom">
              {/* Floating Speech Pill */}
              {donePhase === 'swinging' && (
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-white dark:bg-[#1E1D1B] border border-[#D96B27] dark:border-[#E8632A] text-[#D96B27] dark:text-[#E8632A] font-mono text-[9px] font-bold shadow-md animate-bounce">
                  All done! Time to relax...
                </div>
              )}

              <RobotAvatar
                eyeMode={donePhase === 'swinging' ? 'happy' : 'reading'}
                holdingItem={donePhase === 'reading' ? 'book' : null}
              />
            </div>
          )}

          {/* Layer 3: Front of Rocking Chair (front armrest + spoked wooden wheel + front runner) */}
          <RockingChairFront />
        </div>
      </div>

      {/* Grounded Studio Floor Line */}
      <div className="absolute left-0 right-0 bottom-5 border-b border-[#E5E2DC] dark:border-[#2A2825]" />

      {/* Micro Caption Below Floor Line */}
      <div className="absolute left-0 right-0 bottom-0 text-center text-[10.5px] font-mono text-[#66625B] dark:text-[#8E8980]">
        {donePhase === 'reading'
          ? 'Fastcutz did its job — enjoying a good book.'
          : 'Fastcutz is wrapping up your final video...'}
      </div>
    </div>
  );
};
