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
        <ellipse cx="55" cy="24" rx="34" ry="6" fill="#FF6B35" opacity="0.12" />
        <ellipse cx="55" cy="20" rx="20" ry="4" fill="#22D3EE" opacity="0.15" />

        {/* Pod Outer Cradle Shell */}
        <path
          d="M20 6 C20 6 28 28 55 28 C82 28 90 6 90 6 L88 2 C88 2 80 22 55 22 C30 22 22 2 22 2 Z"
          fill="#1E294B"
          stroke="#3B4D82"
          strokeWidth="1.2"
        />
        {/* Pod Base Mounting Foot (Flush on border) */}
        <rect x="34" y="26" width="42" height="4" rx="2" fill="#141B34" stroke="#2B3763" strokeWidth="1" />

        {/* Glowing Emerald-Cyan Charging Strip */}
        <rect x="44" y="10.5" width="22" height="2.5" rx="1.25" fill="#22D3EE" opacity="0.9" />
        <rect x="46" y="10.5" width="18" height="2.5" rx="1.25" fill="#67E8F9" opacity="0.7" />

        {/* Crisp Nameplate Badge: FASTCUTZ */}
        <rect x="35" y="15" width="40" height="10" rx="2.5" fill="#141B34" stroke="#2B3763" strokeWidth="1" />
        <text
          x="55"
          y="22.5"
          textAnchor="middle"
          fill="#BAE6FD"
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
          <line x1="30" y1="17" x2="30" y2="8" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
          {/* Glowing Coral-Orange Antenna Bulb */}
          <circle cx="30" cy="6.5" r="3.5" fill="#FF6B35" />
          <circle cx="30" cy="6.5" r="5.5" fill="#FF6B35" opacity="0.3" />
          <circle cx="28.8" cy="5.2" r="1" fill="#FFFFFF" opacity="0.9" />

          {/* Left & Right Ear Bolt Accents */}
          <rect x="5" y="27" width="3" height="10" rx="1.5" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1" />
          <rect x="52" y="27" width="3" height="10" rx="1.5" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1" />

          {/* Sleek Pearl-White / Cool-Silver Head Shell */}
          <rect
            x="7"
            y="16"
            width="46"
            height="36"
            rx="14"
            fill="#EEF2FF"
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

          {/* Expressive Glowing Electric Cyan Eyes (Blinking Animation) */}
          <g className="animate-fastcutz-blink">
            {/* Left Eye */}
            <rect x="17.5" y="28" width="8" height="9" rx="4" fill="#22D3EE" />
            <circle cx="23" cy="30.2" r="1.3" fill="#FFFFFF" />
            {/* Right Eye */}
            <rect x="34.5" y="28" width="8" height="9" rx="4" fill="#22D3EE" />
            <circle cx="40" cy="30.2" r="1.3" fill="#FFFFFF" />
          </g>

          {/* Cute Mint Smile Line */}
          <path
            d="M27 39.5 Q30 41.5 33 39.5"
            stroke="#34D399"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />

          {/* Compact Rounded Paws */}
          <ellipse cx="14" cy="51" rx="4" ry="3" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1" />
          <ellipse cx="46" cy="51" rx="4" ry="3" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1" />
        </g>
      </svg>

      {/* Mini glowing meme cartridge in hands when carrying across stage */}
      {isCarrying && (
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-40 flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#1E2547] border border-[#FF6B35] shadow-[0_0_12px_rgba(255,107,53,0.7)] animate-pulse">
          <div className="w-1.5 h-1.5 rounded-full bg-[#FF6B35]" />
          <span className="font-mono text-[7.5px] font-bold text-[#FBBF24] tracking-wider">MP4</span>
        </div>
      )}
    </div>
  );
};

/**
 * Studio Key Light / Softbox
 * Angled ~20° to cast a soft warm volumetric amber light cone onto the Upload Dropbox
 */
const StudioKeyLight: React.FC = () => {
  return (
    <div
      className="hidden lg:block pointer-events-none select-none absolute left-2 xl:left-6 top-0 bottom-4 z-0 w-[105px] xl:w-[130px]"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 130 420"
        preserveAspectRatio="xMidYMax meet"
        className="w-full h-full overflow-visible"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Volumetric Studio Beam Gradient (Warm studio amber-gold cone) */}
          <linearGradient id="softbox-beam" x1="0%" y1="0%" x2="100%" y2="80%">
            <stop offset="0%" stopColor="#FDE047" stopOpacity="0.17" />
            <stop offset="35%" stopColor="#FB923C" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#FB923C" stopOpacity="0" />
          </linearGradient>

          {/* Softbox Diffuser Face Gradient (Warm golden sun) */}
          <linearGradient id="diffuser-glow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FEF08A" />
            <stop offset="40%" stopColor="#FBBF24" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>

          {/* Metal Stand Linear Gradient (Brushed gunmetal-silver) */}
          <linearGradient id="stand-metal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1E293B" />
            <stop offset="50%" stopColor="#64748B" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
        </defs>

        {/* --- Volumetric Light Cone projecting rightward toward the upload dropbox --- */}
        <polygon
          points="88,32 380,120 340,390 88,96"
          fill="url(#softbox-beam)"
          className="mix-blend-screen opacity-90"
        />

        {/* --- Tripod Stand Base Floor Shadow --- */}
        <ellipse cx="65" cy="405" rx="44" ry="7" fill="#000000" fillOpacity="0.45" />

        {/* --- Tripod Legs (3-leg studio c-stand base) --- */}
        {/* Left leg */}
        <path d="M65 355 L20 402" stroke="#334155" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M65 355 L20 402" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="20" cy="402" r="3.5" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Center leg */}
        <path d="M65 355 L65 405" stroke="#334155" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M65 355 L65 405" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="65" cy="405" r="3.5" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Right leg */}
        <path d="M65 355 L110 402" stroke="#334155" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M65 355 L110 402" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="110" cy="402" r="3.5" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Leg Collar Clamp & Tightener */}
        <rect x="58" y="350" width="14" height="9" rx="2" fill="#1E293B" stroke="#475569" strokeWidth="1" />
        <circle cx="74" cy="354.5" r="2.5" fill="#FF6B35" />

        {/* Telescoping Shafts (Lower & Upper) */}
        {/* Lower thick shaft */}
        <rect x="62.5" y="195" width="5" height="157" rx="1.5" fill="url(#stand-metal)" stroke="#1E293B" strokeWidth="0.8" />
        {/* Mid Collar */}
        <rect x="60" y="190" width="10" height="7" rx="1.5" fill="#1E293B" stroke="#475569" strokeWidth="0.8" />
        <circle cx="72" cy="193.5" r="2" fill="#FF6B35" />

        {/* Upper riser shaft */}
        <rect x="63.5" y="75" width="3" height="117" rx="1" fill="#64748B" stroke="#334155" strokeWidth="0.6" />
        {/* Top Swivel Mount & Tilt Bracket */}
        <rect x="61" y="68" width="8" height="9" rx="2" fill="#1E293B" stroke="#475569" strokeWidth="0.8" />
        <circle cx="65" cy="72.5" r="2" fill="#FF6B35" />

        {/* --- Softbox Head Assembly (Angled ~20° toward dropbox) --- */}
        <g transform="rotate(20 65 70)">
          {/* Rear Housing Heatsink & Fixture Body */}
          <path
            d="M38 52 L56 38 L56 82 L38 72 Z"
            fill="#1E293B"
            stroke="#475569"
            strokeWidth="1.2"
          />
          {/* Cooling Fins / Texture */}
          <line x1="43" y1="51" x2="43" y2="73" stroke="#334155" strokeWidth="1" />
          <line x1="49" y1="45" x2="49" y2="77" stroke="#334155" strokeWidth="1" />

          {/* Rear Power Indicator LED */}
          <circle cx="42" cy="62" r="1.8" fill="#FF6B35" className="animate-pulse" />

          {/* Softbox Canopy / Outer Funnel (Reflector Cone) */}
          <path
            d="M56 38 L88 24 L88 96 L56 82 Z"
            fill="#27354A"
            stroke="#475569"
            strokeWidth="1.4"
          />

          {/* Angled Barn Doors / Light Spill Flags */}
          {/* Top Barn Door */}
          <polygon
            points="88,24 108,16 104,27 88,27"
            fill="#1E293B"
            stroke="#475569"
            strokeWidth="0.8"
          />
          {/* Bottom Barn Door */}
          <polygon
            points="88,93 104,93 108,104 88,96"
            fill="#1E293B"
            stroke="#475569"
            strokeWidth="0.8"
          />

          {/* Luminous Diffuser Front Screen (Warm Golden Sun Glow) */}
          <rect
            x="86"
            y="26"
            width="6"
            height="68"
            rx="2.5"
            fill="url(#diffuser-glow)"
            stroke="#FDE047"
            strokeWidth="0.8"
          />
          {/* Diffuser Core Highlight */}
          <rect
            x="87.5"
            y="30"
            width="3"
            height="60"
            rx="1.5"
            fill="#FEF9C3"
            fillOpacity="0.9"
          />
        </g>
      </svg>
    </div>
  );
};

/**
 * Studio Editor Chair (Back View)
 * Centered directly below the Upload Dropbox, facing toward the dropbox as the studio screen
 */
const StudioEditorChair: React.FC = () => {
  return (
    <div
      className="w-[135px] md:w-[155px] h-[135px] md:h-[150px] flex items-center justify-center pointer-events-none select-none"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 155 150"
        className="w-full h-full drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="chair-spine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1E2749" />
            <stop offset="50%" stopColor="#313F70" />
            <stop offset="100%" stopColor="#1E2749" />
          </linearGradient>

          <linearGradient id="chair-piston" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="50%" stopColor="#64748B" />
            <stop offset="100%" stopColor="#334155" />
          </linearGradient>
        </defs>

        {/* Ambient Floor Shadow Ellipse */}
        <ellipse cx="77.5" cy="142" rx="46" ry="6" fill="#000000" fillOpacity="0.45" />

        {/* 5-Spoke Caster Base (Brushed silver-slate) */}
        {/* Spoke 1: Far Left */}
        <line x1="77.5" y1="124" x2="42" y2="138" stroke="#475569" strokeWidth="4" strokeLinecap="round" />
        <line x1="77.5" y1="124" x2="42" y2="138" stroke="#64748B" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="42" cy="139" r="3" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Spoke 2: Mid Left */}
        <line x1="77.5" y1="124" x2="58" y2="143" stroke="#475569" strokeWidth="4.5" strokeLinecap="round" />
        <line x1="77.5" y1="124" x2="58" y2="143" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="58" cy="144" r="3" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Spoke 3: Center Down */}
        <line x1="77.5" y1="124" x2="77.5" y2="145" stroke="#475569" strokeWidth="5" strokeLinecap="round" />
        <line x1="77.5" y1="124" x2="77.5" y2="145" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="77.5" cy="146" r="3.2" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Spoke 4: Mid Right */}
        <line x1="77.5" y1="124" x2="97" y2="143" stroke="#475569" strokeWidth="4.5" strokeLinecap="round" />
        <line x1="77.5" y1="124" x2="97" y2="143" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="97" cy="144" r="3" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Spoke 5: Far Right */}
        <line x1="77.5" y1="124" x2="113" y2="138" stroke="#475569" strokeWidth="4" strokeLinecap="round" />
        <line x1="77.5" y1="124" x2="113" y2="138" stroke="#64748B" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="113" cy="139" r="3" fill="#1E293B" stroke="#475569" strokeWidth="1" />

        {/* Center Hub Star Cap */}
        <circle cx="77.5" cy="124" r="6" fill="#334155" stroke="#64748B" strokeWidth="1.2" />

        {/* Pneumatic Gas-Lift Piston Cylinder */}
        <rect x="74" y="104" width="7" height="20" rx="1.5" fill="url(#chair-piston)" stroke="#1E293B" strokeWidth="0.8" />
        {/* Tilt Mechanism Under-Seat Box */}
        <rect x="66" y="99" width="23" height="7" rx="2" fill="#1E293B" stroke="#475569" strokeWidth="1" />
        {/* Tilt tension knob */}
        <rect x="74" y="103" width="7" height="3" rx="1" fill="#FF6B35" opacity="0.9" />

        {/* Armrests (Left & Right - Peeking out symmetrically) */}
        {/* Left Armrest */}
        <path
          d="M44 68 C44 54 48 48 55 48 L56 52 C51 52 48 56 48 68 L48 83 C48 87 53 88 58 88 L58 92 C50 92 44 89 44 83 Z"
          fill="#232E54"
          stroke="#3B4A7D"
          strokeWidth="1"
        />
        {/* Left armrest soft top pad */}
        <rect x="42" y="47" width="14" height="4.5" rx="2" fill="#313F70" stroke="#4A5D9E" strokeWidth="0.8" />

        {/* Right Armrest */}
        <path
          d="M111 68 C111 54 107 48 100 48 L99 52 C104 52 107 56 107 68 L107 83 C107 87 102 88 97 88 L97 92 C105 92 111 89 111 83 Z"
          fill="#232E54"
          stroke="#3B4A7D"
          strokeWidth="1"
        />
        {/* Right armrest soft top pad */}
        <rect x="99" y="47" width="14" height="4.5" rx="2" fill="#313F70" stroke="#4A5D9E" strokeWidth="0.8" />

        {/* High-Back Contoured Creator Shell (Back View) */}
        {/* Main Outer Backrest Silhouette */}
        <path
          d="M58 26 C58 23 60 21 64 21 L91 21 C95 21 97 23 97 26 L95 44 C99 52 102 60 102 74 C102 89 97 96 92 98 L63 98 C58 96 53 89 53 74 C53 60 56 52 60 44 Z"
          fill="#232E54"
          stroke="#4A5D9E"
          strokeWidth="1.4"
        />

        {/* Back Spine Reinforcement Frame */}
        <path
          d="M74.5 30 L80.5 30 L80.5 96 L74.5 96 Z"
          fill="url(#chair-spine)"
          stroke="#3D5087"
          strokeWidth="0.8"
        />

        {/* Lumbar Support Ribbed Wings (Left & Right) */}
        <path
          d="M60 62 C65 65 72 66 74 66 L74 77 C71 77 64 76 58 71 Z"
          fill="#2A3764"
          stroke="#4A5D9E"
          strokeWidth="0.8"
        />
        <path
          d="M95 62 C90 65 83 66 81 66 L81 77 C84 77 91 76 97 71 Z"
          fill="#2A3764"
          stroke="#4A5D9E"
          strokeWidth="0.8"
        />

        {/* Upper Backrest Cushion Contour */}
        <rect x="63" y="32" width="29" height="18" rx="4" fill="#313F70" stroke="#4A5D9E" strokeWidth="0.8" />

        {/* Headrest Cushion Unit (Top Center) */}
        <rect x="61" y="9" width="33" height="15" rx="4.5" fill="#2A3764" stroke="#4A5D9E" strokeWidth="1.2" />
        <rect x="63.5" y="11.5" width="28" height="10" rx="3" fill="#1E2749" />

        {/* Signature Coral-Orange Stitching Accent on Headrest */}
        <line x1="66" y1="16.5" x2="89" y2="16.5" stroke="#FF6B35" strokeWidth="1.5" strokeDasharray="3 1.5" strokeLinecap="round" />

        {/* Headrest Mounting Bracket Neck */}
        <rect x="73.5" y="21" width="8" height="4" rx="1" fill="#3B4A7D" stroke="#4A5D9E" strokeWidth="0.8" />
      </svg>
    </div>
  );
};

/**
 * Potted Indoor Studio Plants
 * Living studio greenery beside the Mode A/B cards with gentle ambient sway
 */
const StudioPottedPlants: React.FC = () => {
  return (
    <div
      className="hidden lg:block pointer-events-none select-none absolute right-2 xl:right-6 bottom-2 z-0 w-[110px] xl:w-[140px]"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 140 210"
        className="w-full h-auto drop-shadow-[0_8px_16px_rgba(0,0,0,0.45)] overflow-visible"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="plant-leaf-dark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="50%" stopColor="#059669" />
            <stop offset="100%" stopColor="#047857" />
          </linearGradient>

          <linearGradient id="plant-leaf-light" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34D399" />
            <stop offset="60%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          <linearGradient id="pot-ceramic" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#B84F2A" />
            <stop offset="50%" stopColor="#D96B43" />
            <stop offset="100%" stopColor="#B84F2A" />
          </linearGradient>
        </defs>

        {/* Ambient Floor Shadow */}
        <ellipse cx="68" cy="198" rx="48" ry="7" fill="#000000" fillOpacity="0.45" />

        {/* --- Swaying Foliage Cluster (Top Leaves) --- */}
        <g className="animate-studio-plant-sway">
          {/* Back Tall Snake Plant Spear (Center-Right) */}
          <path
            d="M68 135 C70 90 85 45 76 10 C68 45 66 90 68 135 Z"
            fill="url(#plant-leaf-dark)"
            stroke="#047857"
            strokeWidth="1"
          />
          {/* Variegation Edge band */}
          <path
            d="M74 15 C79 50 72 90 70 130"
            stroke="#6EE7B7"
            strokeWidth="0.8"
            strokeOpacity="0.5"
            strokeLinecap="round"
          />

          {/* Tall Snake Plant Spear (Left-leaning) */}
          <path
            d="M62 135 C58 95 44 55 48 20 C56 55 64 95 62 135 Z"
            fill="url(#plant-leaf-light)"
            stroke="#059669"
            strokeWidth="1"
          />
          <path
            d="M49 26 C53 60 59 95 60 130"
            stroke="#A7F3D0"
            strokeWidth="0.8"
            strokeOpacity="0.45"
            strokeLinecap="round"
          />

          {/* Tall Central Spear */}
          <path
            d="M66 135 C64 80 62 40 65 6 C69 40 70 80 66 135 Z"
            fill="url(#plant-leaf-dark)"
            stroke="#047857"
            strokeWidth="1"
          />
          {/* Variegation tiger stripes */}
          <line x1="64" y1="35" x2="67" y2="37" stroke="#A7F3D0" strokeOpacity="0.5" strokeWidth="0.9" />
          <line x1="64" y1="55" x2="68" y2="57" stroke="#A7F3D0" strokeOpacity="0.5" strokeWidth="0.9" />
          <line x1="65" y1="75" x2="68" y2="78" stroke="#A7F3D0" strokeOpacity="0.5" strokeWidth="0.9" />

          {/* Broad Arching Monstera Leaf (Left) */}
          <path
            d="M60 138 C50 115 28 100 12 108 C15 125 35 138 60 138 Z"
            fill="url(#plant-leaf-dark)"
            stroke="#047857"
            strokeWidth="1"
          />
          {/* Leaf slit cutout */}
          <path d="M26 114 C32 118 36 122 36 122" stroke="#047857" strokeWidth="1.5" strokeLinecap="round" />

          {/* Broad Arching Leaf (Right) */}
          <path
            d="M72 138 C85 115 110 105 122 115 C115 130 95 140 72 138 Z"
            fill="url(#plant-leaf-light)"
            stroke="#059669"
            strokeWidth="1"
          />
          {/* Leaf vein */}
          <path d="M78 136 C92 126 108 118 116 116" stroke="#A7F3D0" strokeOpacity="0.4" strokeWidth="1" />
        </g>

        {/* --- Main Ribbed Floor Planter Pot (Terracotta) --- */}
        {/* Pot Base Body */}
        <path
          d="M48 142 L53 194 C53 196 55 198 58 198 L82 198 C85 198 87 196 87 194 L92 142 Z"
          fill="url(#pot-ceramic)"
          stroke="#9C3E1D"
          strokeWidth="1.2"
        />

        {/* Planter Vertical Rib Details */}
        <line x1="56" y1="144" x2="60" y2="194" stroke="#B84F2A" strokeWidth="1" />
        <line x1="63" y1="144" x2="66" y2="196" stroke="#B84F2A" strokeWidth="1" />
        <line x1="70" y1="144" x2="70" y2="196" stroke="#E07B55" strokeWidth="1" />
        <line x1="77" y1="144" x2="74" y2="196" stroke="#B84F2A" strokeWidth="1" />
        <line x1="84" y1="144" x2="80" y2="194" stroke="#B84F2A" strokeWidth="1" />

        {/* Pot Soil Top */}
        <ellipse cx="70" cy="142" rx="22" ry="5" fill="#271810" stroke="#42281D" strokeWidth="1" />

        {/* Warm Sandstone Planter Rim Collar */}
        <path
          d="M46 138 L94 138 C95 138 96 139 96 141 L94 144 C94 145 93 146 92 146 L48 146 C47 146 46 145 46 144 L44 141 C44 139 45 138 46 138 Z"
          fill="#F4C7A1"
          stroke="#FBD5B5"
          strokeWidth="0.8"
        />

        {/* --- Small Companion Succulent Pot (Nestled to the right, cute cream/sage) --- */}
        <g>
          {/* Companion Pot Shadow */}
          <ellipse cx="106" cy="197" rx="14" ry="3.5" fill="#000000" fillOpacity="0.35" />
          {/* Mini Pot Body */}
          <path
            d="M96 172 L99 194 C99 196 101 197 103 197 L111 197 C113 197 115 196 115 194 L118 172 Z"
            fill="#E2C6A8"
            stroke="#CBB093"
            strokeWidth="0.8"
          />
          {/* Mini Pot Rim */}
          <rect x="95" y="170" width="24" height="3" rx="1.5" fill="#F0DFCE" stroke="#DFC4A9" strokeWidth="0.8" />
          {/* Succulent Rosette Leaves */}
          <circle cx="107" cy="168" r="4" fill="#059669" stroke="#047857" strokeWidth="0.8" />
          <circle cx="103" cy="169" r="3.5" fill="#10B981" stroke="#059669" strokeWidth="0.6" />
          <circle cx="111" cy="169" r="3.5" fill="#10B981" stroke="#059669" strokeWidth="0.6" />
          <circle cx="107" cy="165" r="3.2" fill="#34D399" stroke="#6EE7B7" strokeWidth="0.6" />
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

  // Dynamic Meme Slots for Empty Frames in Filmstrip: [Slot A, Slot B]
  const [slotMemes, setSlotMemes] = useState<[MemeLibraryItem | null, MemeLibraryItem | null]>([null, null]);

  // Mascot Phase State Machine
  const [botPhase, setBotPhase] = useState<BotPhase>('idle');
  const [showEasyBubble, setShowEasyBubble] = useState(false);
  const nextReplaceSlotRef = useRef<number>(0);

  // Interactive Scissor-Cut state
  const filmstripRef = useRef<HTMLDivElement>(null);
  const frameRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [isHoveringStrip, setIsHoveringStrip] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 });
  const [isSnipping, setIsSnipping] = useState(false);
  const [cutFrames, setCutFrames] = useState<Record<string, 'cutting' | 'cut'>>({});

  const cutTimersRef = useRef<NodeJS.Timeout[]>([]);
  const botTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Cleanup all timers on unmount only
  useEffect(() => {
    return () => {
      cutTimersRef.current.forEach(clearTimeout);
      cutTimersRef.current = [];
      botTimersRef.current.forEach(clearTimeout);
      botTimersRef.current = [];
    };
  }, []);

  // Off-screen left-exit watcher for cut frames:
  // Active only when there is at least one frame in 'cut' state
  useEffect(() => {
    const cutKeys = Object.entries(cutFrames)
      .filter(([_, state]) => state === 'cut')
      .map(([key]) => key);

    if (cutKeys.length === 0) return;

    let animId: number;
    const checkOffscreen = () => {
      const stripLeft = filmstripRef.current
        ? filmstripRef.current.getBoundingClientRect().left
        : 0;

      const keysToClear: string[] = [];

      for (const key of cutKeys) {
        const el = frameRefs.current[key];
        if (el) {
          const rect = el.getBoundingClientRect();
          // As soon as the cut slot has scrolled completely off the left edge of the filmstrip
          if (rect.right < stripLeft - 10) {
            keysToClear.push(key);
          }
        }
      }

      if (keysToClear.length > 0) {
        setCutFrames(prev => {
          const next = { ...prev };
          keysToClear.forEach(k => delete next[k]);
          return next;
        });
      } else {
        animId = requestAnimationFrame(checkOffscreen);
      }
    };

    animId = requestAnimationFrame(checkOffscreen);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [cutFrames]);

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
  const handleCutFrame = (instanceKey: string, frameType: FrameSlotType) => {
    if (cutFrames[instanceKey]) return;

    // 1. Physically snap scissor blades shut
    setIsSnipping(true);
    const snipTimer = setTimeout(() => setIsSnipping(false), 260);
    cutTimersRef.current.push(snipTimer);

    // Identify if this is a meme slot and whether it currently holds a meme
    const slotIdx = frameType === 'slotA' ? 0 : frameType === 'slotB' ? 1 : null;
    const isMemeSlotFilled = slotIdx !== null && slotMemes[slotIdx] !== null;

    // 2. Set state to 'cutting' (0–560ms): slotMemes[slotIdx] remains intact during 0–560ms
    // so renderFrameVisual displays the active meme video splitting cleanly in half!
    setCutFrames(prev => ({ ...prev, [instanceKey]: 'cutting' }));

    // 3. At 560ms (split animation finishes): transition to 'cut' (recessed splice gap)
    // AND if a meme was cut, clear that specific meme slot so it returns as an empty frame!
    const dropTimer = setTimeout(() => {
      setCutFrames(prev => ({ ...prev, [instanceKey]: 'cut' }));

      if (isMemeSlotFilled && slotIdx !== null) {
        setSlotMemes(prev => {
          const next: [MemeLibraryItem | null, MemeLibraryItem | null] = [...prev];
          next[slotIdx] = null;
          return next;
        });
      }
    }, 560);
    cutTimersRef.current.push(dropTimer);

    // 4. Safety fallback (15s) in case watcher loop is paused by tab backgrounding
    const fallbackTimer = setTimeout(() => {
      setCutFrames(prev => {
        if (!prev[instanceKey]) return prev;
        const next = { ...prev };
        delete next[instanceKey];
        return next;
      });
    }, 15000);
    cutTimersRef.current.push(fallbackTimer);
  };

  // Trigger Interactive Meme Fetch Sequence
  const handleFetchMeme = () => {
    if (botPhase !== 'idle') return;

    botTimersRef.current.forEach(clearTimeout);
    botTimersRef.current = [];
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
              botTimersRef.current.push(t6);
            }, 850);
            botTimersRef.current.push(t5);
          }, 650);
          botTimersRef.current.push(t4);
        }, 1050);
        botTimersRef.current.push(t3);
      }, 850);
      botTimersRef.current.push(t2);
    }, 700);
    botTimersRef.current.push(t1);
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
            ? 'bg-[#0B0F1F] border-[#22D3EE]/70 shadow-[0_0_20px_-6px_rgba(34,211,238,0.4)]'
            : isFastcutz
            ? 'bg-[#1E2547] border-[#FF6B35]/70 shadow-[0_0_20px_-6px_rgba(255,107,53,0.3)]'
            : 'bg-[#192140] border-[#2E3C6E]'
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
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
          </div>
          <span
            className={`font-mono text-[8px] md:text-[9px] tabular-nums tracking-widest ${
              hasMeme
                ? 'text-[#22D3EE] font-semibold'
                : isFastcutz
                ? 'text-[#FF6B35] font-bold'
                : frameType === 'welcome'
                ? 'text-[#38BDF8]'
                : frameType === 'to'
                ? 'text-[#818CF8]'
                : 'text-[#7B8EC8]'
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
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
          </div>
        </div>

        {/* Frame Center Content */}
        <div className="flex-1 flex items-center justify-center relative overflow-hidden z-10 my-0.5">
          {hasMeme ? (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-black/60 border border-[#22D3EE]/50 backdrop-blur-sm shadow-sm">
              <span className="text-[10px] md:text-[11px] font-bold text-[#F8FAFC] tracking-wide truncate max-w-[170px]">
                {meme.title.toUpperCase()}
              </span>
            </div>
          ) : (
            <>
              {frameType === 'slotA' && (
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className="absolute top-0.5 left-1.5 w-1.5 h-1.5 border-t border-l border-[#38BDF8]/40" />
                  <div className="absolute top-0.5 right-1.5 w-1.5 h-1.5 border-t border-r border-[#38BDF8]/40" />
                  <div className="absolute bottom-0.5 left-1.5 w-1.5 h-1.5 border-b border-l border-[#38BDF8]/40" />
                  <div className="absolute bottom-0.5 right-1.5 w-1.5 h-1.5 border-b border-r border-[#38BDF8]/40" />
                  <span className="text-[8.5px] font-mono text-[#7B8EC8] tracking-wider">[EMPTY SLOT A]</span>
                </div>
              )}
              {frameType === 'welcome' && (
                <span className="text-2xl md:text-3xl font-bold tracking-[0.14em] text-[#FFFFFF] font-sans">
                  WELCOME
                </span>
              )}
              {frameType === 'to' && (
                <span className="text-2xl md:text-3xl font-semibold tracking-[0.2em] text-[#A5F3FC] font-sans">
                  TO
                </span>
              )}
              {frameType === 'fastcutz' && (
                <span className="text-2xl md:text-3xl font-extrabold tracking-tight">
                  <span className="text-[#FFFFFF]">Fastcutz</span>
                  <span className="text-[#FF6B35]">.ai</span>
                </span>
              )}
              {frameType === 'slotB' && (
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className="absolute top-0.5 left-1.5 w-1.5 h-1.5 border-t border-l border-[#38BDF8]/40" />
                  <div className="absolute top-0.5 right-1.5 w-1.5 h-1.5 border-t border-r border-[#38BDF8]/40" />
                  <div className="absolute bottom-0.5 left-1.5 w-1.5 h-1.5 border-b border-l border-[#38BDF8]/40" />
                  <div className="absolute bottom-0.5 right-1.5 w-1.5 h-1.5 border-b border-r border-[#38BDF8]/40" />
                  <span className="text-[8.5px] font-mono text-[#7B8EC8] tracking-wider">[EMPTY SLOT B]</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom Sprocket Rail */}
        <div className="flex items-center justify-between px-1 relative z-10">
          <div className="flex items-center space-x-1.5">
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
          </div>
          <span className="font-mono text-[8px] md:text-[9px] text-[#7B8EC8] tabular-nums tracking-widest">
            {frameType === 'slotA' ? '00:00:12' : frameType === 'welcome' ? '00:01:00' : frameType === 'to' ? '00:02:00' : frameType === 'fastcutz' ? '00:03:00' : '00:04:00'}
          </span>
          <div className="flex items-center space-x-1.5">
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
            <div className="w-2.5 h-1 rounded-[1.5px] bg-[#0B0F1F] border border-[#303E70]" />
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
        ref={(el) => { frameRefs.current[instanceKey] = el; }}
        className="w-[220px] md:w-[250px] h-[82px] md:h-[92px] shrink-0 relative select-none"
      >
        {/* State 1: Normal Interactive Frame (Scissors hover & click) */}
        {!state && (
          <div
            onClick={() => handleCutFrame(instanceKey, frameType)}
            className="w-full h-full cursor-pointer group rounded-lg transition-all hover:border-[#FF6B35]/80 hover:shadow-[0_0_14px_rgba(255,107,53,0.3)]"
          >
            {renderFrameVisual(frameType)}
          </div>
        )}

        {/* State 2: 'cutting' (0–560ms) - Left/right split shear and drop + amber cut line + CUT badge */}
        {state === 'cutting' && (
          <div className="w-full h-full relative overflow-visible rounded-lg bg-[#0E1326]/90 border border-[#2E3C6E]/60">
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
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-[#FF6B35] shadow-[0_0_12px_#FF6B35,0_0_4px_#FDE047] animate-cut-slice-line z-30 pointer-events-none" />

            {/* Floating ✂ CUT Badge */}
            <div className="absolute top-1/2 left-1/2 z-40 pointer-events-none animate-cut-badge-pop whitespace-nowrap">
              <span className="px-2 py-0.5 rounded-full bg-[#1E2547] border border-[#FF6B35] text-[#FDE047] font-mono text-[9px] font-bold shadow-lg">
                ✂ CUT
              </span>
            </div>
          </div>
        )}

        {/* State 3: 'cut' (560ms until 1 full roll finishes) - Clean Recessed Cutout Slot */}
        {state === 'cut' && (
          <div className="w-full h-full rounded-lg border border-dashed border-[#FF6B35]/40 bg-[#0E1326]/90 flex flex-col items-center justify-center space-y-1 p-2 relative overflow-hidden">
            <div className="absolute top-1.5 inset-x-2 flex items-center justify-between opacity-40">
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#1E294B]" />
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#1E294B]" />
            </div>
            <div className="flex items-center space-x-1 text-[#FF6B35]/80">
              <span className="text-xs">✂</span>
              <span className="font-mono text-[8px] md:text-[9px] text-[#94A3B8] tracking-widest uppercase">
                SPLICE GAP
              </span>
            </div>
            <span className="font-mono text-[7px] text-[#64748B] tracking-wider">
              RESTORES NEXT ROLL
            </span>
            <div className="absolute bottom-1.5 inset-x-2 flex items-center justify-between opacity-40">
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#1E294B]" />
              <div className="w-2.5 h-1 rounded-[1.5px] bg-[#1E294B]" />
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
    <div className="min-h-screen bg-[#0E1326] bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.10),_transparent_55%),radial-gradient(ellipse_at_bottom_left,_rgba(255,140,66,0.09),_transparent_50%)] text-[#F8FAFC] flex flex-col overflow-y-auto">
      {/* Top Rolling Cinema Filmstrip Hero with Custom Scissor Cursor */}
      <section id="hero-space" className="w-full overflow-hidden pt-4 pb-2">
        <div
          ref={filmstripRef}
          onMouseEnter={() => setIsHoveringStrip(true)}
          onMouseLeave={() => setIsHoveringStrip(false)}
          onMouseMove={handleStripMouseMove}
          className={`w-full relative overflow-hidden py-1.5 bg-[#141B34] border-y border-[#2B3763] ${
            isHoveringStrip ? 'md:cursor-none' : ''
          }`}
        >
          {/* Subtle Discoverability Hint */}
          <div className="pointer-events-none absolute top-1.5 right-4 z-20 flex items-center space-x-1 opacity-75">
            <span className="text-[10px] font-mono text-[#7B8EC8] tracking-wider">Click any frame to cut ✂</span>
          </div>

          {/* Left & Right Gradient Fade Masks */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 md:w-36 bg-gradient-to-r from-[#0E1326] to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 md:w-36 bg-gradient-to-l from-[#0E1326] to-transparent z-10" />

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
                    fill="#F8FAFC"
                    stroke="#CBD5E1"
                    strokeWidth="0.5"
                  />
                  <path
                    d="M12 14 C10 13 8 10 5 10 C2 10 1 13 1 15 C1 18 3 20 6 19 C9 18 11 16 12 14 Z"
                    fill="none"
                    stroke="#FF6B35"
                    strokeWidth="2"
                  />
                </g>
                {/* Bottom Blade & Handle */}
                <g className={isSnipping ? 'animate-scissor-bottom' : ''}>
                  <path
                    d="M12 14 L26 20 C27 20.5 26.5 22 25 21.5 L12 16 Z"
                    fill="#F1F5F9"
                    stroke="#94A3B8"
                    strokeWidth="0.5"
                  />
                  <path
                    d="M12 14 C10 15 8 18 5 18 C2 18 1 15 1 13 C1 10 3 8 6 9 C9 10 11 12 12 14 Z"
                    fill="none"
                    stroke="#FF6B35"
                    strokeWidth="2"
                  />
                </g>
                {/* Pivot Screw */}
                <circle cx="12" cy="14" r="2" fill="#FF6B35" stroke="#1E2547" strokeWidth="0.8" />
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
              <rect x="8" y="8" width="72" height="84" rx="6" fill="#1D3557" stroke="#3E6BA3" strokeWidth="1.5" />
              <rect x="12" y="12" width="64" height="76" rx="4" fill="#152744" />

              {/* Status Indicator LED */}
              <circle cx="18" cy="18" r="2" fill="#22D3EE" opacity="0.9" />

              {/* Top Drawer (Slides open when searching) */}
              <g className={botPhase === 'searching' ? 'translate-x-2 transition-transform duration-300' : 'transition-transform duration-300'}>
                <rect x="14" y="24" width="60" height="30" rx="3.5" fill="#2A4D7C" stroke="#4878B5" strokeWidth="1" />
                <rect x="36" y="37" width="16" height="4" rx="2" fill="#FF6B35" />
                {/* Plaque: MEME */}
                <rect x="27" y="27" width="34" height="7.5" rx="2" fill="#14213D" stroke="#2E4773" strokeWidth="0.8" />
                <text
                  x="44"
                  y="33"
                  textAnchor="middle"
                  fill="#FBBF24"
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
                <rect x="14" y="56" width="60" height="30" rx="3.5" fill="#213B63" stroke="#375D91" strokeWidth="1" />
                <rect x="36" y="69" width="16" height="4" rx="2" fill="#64748B" />
                {/* Plaque: VAULT */}
                <rect x="27" y="59" width="34" height="7.5" rx="2" fill="#14213D" stroke="#2E4773" strokeWidth="0.8" />
                <text
                  x="44"
                  y="65"
                  textAnchor="middle"
                  fill="#7B8EC8"
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
                ? 'bg-[#FF6B35]/20 border-[#FF6B35] text-[#FDE047]'
                : botPhase !== 'idle'
                ? 'bg-[#1E2749] border-[#2E3C6E] text-[#64748B]'
                : 'bg-[#161E38] border border-[#38BDF8]/50 text-[#7DD3FC] group-hover:border-[#FF6B35] group-hover:text-[#FFFFFF] group-hover:scale-105'
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
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#1E2547] border border-[#FF6B35]/60 text-[#FDE047] font-mono text-[9px] shadow-lg animate-bounce">
              Searching memes... 🔍
            </div>
          )}
          {botPhase === 'to-computer' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#1E2547] border border-[#22D3EE]/60 text-[#67E8F9] font-mono text-[9px] shadow-lg">
              Adding meme... 🎬
            </div>
          )}
          {botPhase === 'inserting' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#065F46]/60 border border-[#34D399] text-[#6EE7B7] font-mono text-[9px] shadow-lg animate-pulse">
              Injecting to strip! ⚡
            </div>
          )}
          {botPhase === 'idle' && showEasyBubble && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-full bg-[#1E2547] border border-[#22D3EE]/60 text-[#67E8F9] font-mono text-[9px] shadow-lg animate-float-badge">
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
              <rect x="36" y="74" width="32" height="6" rx="2" fill="#141B34" stroke="#2B3763" strokeWidth="1" />
              <rect x="49" y="60" width="6" height="15" rx="1" fill="#1E2749" stroke="#3B4A7D" strokeWidth="1" />

              {/* Monitor Outer Frame */}
              <rect x="4" y="4" width="96" height="58" rx="6" fill="#1E2749" stroke="#3B4A7D" strokeWidth="1.2" />

              {/* Display Screen */}
              <rect
                x="8"
                y="8"
                width="88"
                height="50"
                rx="4"
                fill={botPhase === 'inserting' ? '#064E3B' : '#0B0F1F'}
                stroke={botPhase === 'inserting' ? '#34D399' : '#222E54'}
                strokeWidth="1"
              />

              {botPhase === 'inserting' ? (
                /* Inserting Screen Flash: MEME ADDED ✓ */
                <g>
                  <rect x="16" y="22" width="72" height="22" rx="3" fill="#059669" fillOpacity="0.3" stroke="#34D399" strokeWidth="0.8" />
                  <text
                    x="52"
                    y="36"
                    textAnchor="middle"
                    fill="#34D399"
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
                  <rect x="14" y="16" width="50" height="4" rx="2" fill="#22D3EE" opacity="0.9" />
                  <rect x="14" y="24" width="70" height="4" rx="2" fill="#FF6B35" opacity="0.9" />
                  <rect x="14" y="32" width="38" height="4" rx="2" fill="#A78BFA" opacity="0.9" />
                  <rect x="56" y="32" width="28" height="4" rx="2" fill="#34D399" opacity="0.9" />
                  {/* Red Playhead line */}
                  <line x1="42" y1="12" x2="42" y2="40" stroke="#EF4444" strokeWidth="1.2" />
                  <text x="52" y="47" textAnchor="middle" fill="#7B8EC8" fontSize="5.5" fontFamily="monospace">
                    STUDIO MONITOR
                  </text>
                </g>
              )}
            </svg>
          </div>

          <span className="mt-1 text-[9.5px] font-mono text-[#7B8EC8]">
            {botPhase === 'inserting' ? 'Synced to Filmstrip' : 'Timeline Monitor'}
          </span>
        </div>
      </section>

      {/* Studio Stage Section: Key Light (Left) + Upload Dropbox / Mode Cards (Center) + Potted Plants (Right) */}
      <section className="relative w-full max-w-[1440px] mx-auto overflow-hidden">
        {/* Studio Key Light (Angled towards the Upload Dropbox) */}
        <StudioKeyLight />

        {/* Studio Potted Indoor Plants (Bottom Right beside Mode Cards) */}
        <StudioPottedPlants />

        {/* Main Content Area: Lowered Upload Dropbox & Mode Selection */}
        <main className="max-w-6xl mx-auto w-full px-6 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mt-1 relative z-10">
          {/* Left Column: Drag & Drop Dropzone */}
          <div className="lg:col-span-7 space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all ${
                isDragging
                  ? 'border-[#FF6B35] bg-[#FF6B35]/15 scale-[1.01]'
                  : selectedFile
                  ? 'border-[#22D3EE]/60 bg-[#22D3EE]/10'
                  : 'border-[#3B4C80] hover:border-[#FF6B35] bg-[#161E38]/90'
              }`}
            >
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                onChange={handleFileInput}
                className="absolute inset-0 opacity-0 cursor-pointer"
                disabled={isProcessing}
              />

              <div className="w-16 h-16 rounded-2xl bg-[#222E54] border border-[#3D5087] flex items-center justify-center mb-4">
                {selectedFile ? (
                  <FileVideo className="w-8 h-8 text-[#22D3EE]" />
                ) : (
                  <Upload className="w-8 h-8 text-[#38BDF8]" />
                )}
              </div>

              {selectedFile ? (
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#22D3EE]">{selectedFile.name}</p>
                  <p className="text-xs text-[#A5B4DC] tabular-nums">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready for processing
                  </p>
                  <span className="inline-block mt-2 text-xs text-[#FF7A45] hover:underline cursor-pointer">
                    Click or drag to change file
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-base font-medium text-[#F8FAFC]">
                    Drag and drop your video here, or <span className="text-[#FF7A45] font-semibold underline">browse files</span>
                  </p>
                  <p className="text-xs text-[#7B8EC8]">
                    Supports MP4, MOV, and WebM • Max 250 MB • Max 5 minutes
                  </p>
                </div>
              )}
            </div>

            {/* Studio Editor Chair (Directly below Dropbox, facing it as screen) */}
            <div className="flex justify-center pointer-events-none select-none pt-1">
              <StudioEditorChair />
            </div>

            {errorMsg && (
              <div className="flex items-center space-x-2 p-3 bg-[#DC2626]/15 border border-[#EF4444]/40 rounded-xl text-[#FCA5A5] text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {isProcessing && (
              <div className="p-4 bg-[#1E2749] border border-[#3B4C80] rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs text-[#F8FAFC]">
                  <span className="flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-[#FF6B35] animate-ping" />
                    <span>{processingStatus}</span>
                  </span>
                </div>
                <div className="w-full bg-[#141B34] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-gradient-to-r from-[#FF6B35] to-[#FF8C42] h-full w-2/3 animate-pulse" />
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Mode Selection (Auto Edit vs Custom Edit) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Card A: Auto Edit Recipes */}
            <div className="bg-[#161E38] border border-[#2E3C6B] hover:border-[#475CA0] rounded-2xl p-6 space-y-4 transition-colors">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-[#222E54] border border-[#3D5087] text-[#FF6B35] flex items-center justify-center">
                  <Wand2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">Mode A: AI Auto-Edit</h3>
                  <p className="text-xs text-[#A5B4DC]">Select automated enhancements to apply</p>
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
                    className="flex items-center space-x-3 text-xs text-[#A5B4DC] cursor-pointer select-none hover:text-[#F8FAFC] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={autoOptions[key as keyof typeof autoOptions]}
                      onChange={(e) =>
                        setAutoOptions({ ...autoOptions, [key]: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-[#3D5087] accent-[#FF6B35] bg-[#1E2749]"
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
                className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-[#FF6B35] to-[#FF8C42] hover:from-[#FF7D4D] hover:to-[#FFA05C] text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[#FF6B35]/25 active:scale-[0.99]"
              >
                <span>Start Auto Edit</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Card B: Custom Edit */}
            <div className="bg-[#161E38] border border-[#2E3C6B] hover:border-[#475CA0] rounded-2xl p-5 flex items-center justify-between transition-colors">
              <div>
                <h4 className="text-sm font-semibold text-[#F8FAFC]">Mode B: Custom Edit</h4>
                <p className="text-xs text-[#A5B4DC]">Direct workspace access without auto changes</p>
              </div>
              <button
                onClick={() => handleStartEditing(false)}
                disabled={!selectedFile || isProcessing}
                className="px-4 py-2 bg-[#232F56] hover:bg-[#2E3E70] border border-[#435796] text-[#E2E8F0] text-xs font-medium rounded-lg transition-colors disabled:opacity-40"
              >
                Custom Edit
              </button>
            </div>
          </div>
        </main>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto w-full px-6 pt-4 pb-6 border-t border-[#2B3763] text-center text-xs text-[#6E7FA8] mt-auto">
        AI Video Editor • 100% Client-Side Processing • Scaler YIIC 9.0 Week 2
      </footer>
    </div>
  );
};
