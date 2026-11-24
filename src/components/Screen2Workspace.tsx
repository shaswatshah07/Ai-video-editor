import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Scissors, Trash2,
  Sparkles, Send, Upload, ChevronRight, ChevronLeft, ChevronDown, ArrowRight,
  Check, X, Wand2, ShieldAlert, Download,
  Loader2, AlertCircle, RefreshCw, Search, Plus, Film, GripVertical,
  Music, Volume2, VolumeX, FileText
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { mapProjectToSource, mapSourceToProjectMs } from '../utils/timelineMath';
import { parseCommandWithFallback } from '../utils/commandParser';
import { TransitionType, TimelineItem } from '../types/edl';
import { SILENCE_PRESETS } from '../utils/silenceDetector';
import { downloadTranscriptAsTxt } from '../utils/transcriptParser';
import { MEME_LIBRARY } from '../utils/memeLibrary';
import { ThemeToggle } from './ThemeToggle';

interface ActiveTransitionMatch {
  boundaryMs: number;
  type: TransitionType;
  delta: number;
}

function findActiveTransition(
  projectMs: number,
  items: TimelineItem[]
): ActiveTransitionMatch | null {
  const activeItems = items.filter(
    (it) => it.status !== 'DELETED'
  );
  if (activeItems.length < 2) return null;

  const HALF_WINDOW_MS = 300;

  for (let i = 0; i < activeItems.length - 1; i++) {
    const prevItem = activeItems[i];

    if (!prevItem.transitionOut || prevItem.transitionOut.type === 'none') {
      continue;
    }

    const boundaryMs = prevItem.projectEndMs;
    const delta = projectMs - boundaryMs;

    if (delta >= -HALF_WINDOW_MS && delta <= HALF_WINDOW_MS) {
      return {
        boundaryMs,
        type: prevItem.transitionOut.type,
        delta
      };
    }
  }

  return null;
}

// Module-level cache to ensure primary <video> MediaElementAudioSourceNode is attached ONCE (WeakMap guarded)
const mediaSourceCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

export const Screen2Workspace: React.FC = () => {
  const {
    project,
    currentProjectMs,
    isPlaying,
    previewSpeed,
    timelineZoom,
    thumbnails,
    clipFilmstrips,
    thumbnailProgress,
    selectedItemId,
    commandLogs,
    voiceEnhanceEnabled,
    noiseRemovalEnabled,
    undoStack,
    redoStack,
    transcriptionStatus,
    transcriptionDownloadPercent,
    transcriptionError,
    transcriptionFallbackNotice,
    transcriptQuality,
    transcriptMode,
    addedClipTranscribing,
    setScreen,
    setCurrentProjectMs,
    setIsPlaying,
    setPreviewSpeed,
    zoomIn,
    zoomOut,
    setTranscriptQuality,
    setTranscriptMode,
    updateTranscriptWord,
    generateTranscript,
    cancelTranscription,
    setSelectedItemId,
    splitAtPlayhead,
    deleteSelected,
    keepSilencePause,
    detectSilencesOnly,
    toggleSilenceSelected,
    clearAllSilences,
    applySelectedSilenceCuts,
    setTransition,
    toggleVoiceEnhance,
    toggleNoiseRemoval,
    undo,
    redo,
    userUploadedClips,
    addUploadedMeme,
    removeUploadedMeme,
    insertMemeAtProjectMs,
    replaceMemeClip,
    removeMemeClip,
    reorderTimelineItem,
    appendClipToEnd,
    applyAICommand,
    addCommandLog,
    bgMusic,
    setBgMusic,
    setBgMusicVolume,
    toggleBgMusicMute,
    removeBgMusic
  } = useEditorStore();

  // Dual Video Elements (Spec 3) & Frame-Accurate Transition Stage
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const memeVideoRef = useRef<HTMLVideoElement | null>(null);
  const transitionStageRef = useRef<HTMLDivElement | null>(null);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const bgMusicInputRef = useRef<HTMLInputElement | null>(null);

  // RAF synchronization & Seek Loop Guard
  const rafIdRef = useRef<number | null>(null);
  const lastSeekTargetRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number | null>(null);
  const activeMemeIdRef = useRef<string | null>(null);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const currentProjectMsRef = useRef<number>(currentProjectMs);
  const switchingClipRef = useRef<boolean>(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentProjectMsRef.current = currentProjectMs;
  }, [currentProjectMs]);

  // Web Audio Context & Native Real-Time DSP Filter Refs (audible with zero echo)
  const audioContextRef = useRef<AudioContext | null>(null);
  const nrHighPass1Ref = useRef<BiquadFilterNode | null>(null);
  const nrHighPass2Ref = useRef<BiquadFilterNode | null>(null);
  const nrFanHumCutRef = useRef<BiquadFilterNode | null>(null);
  const nrLowPassRef = useRef<BiquadFilterNode | null>(null);
  const nrGateGainRef = useRef<GainNode | null>(null);
  const nrAnalyserRef = useRef<AnalyserNode | null>(null);
  const veWarmthCutRef = useRef<BiquadFilterNode | null>(null);
  const vePresenceBoostRef = useRef<BiquadFilterNode | null>(null);
  const veCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const veMakeupGainRef = useRef<GainNode | null>(null);

  // UI state
  const [promptInput, setPromptInput] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [isDetectingSilences, setIsDetectingSilences] = useState<boolean>(false);
  const [isLeftOpen, setIsLeftOpen] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [isRightOpen, setIsRightOpen] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [activeMemePlaying, setActiveMemePlaying] = useState<boolean>(false);
  const [isSecondaryReady, setIsSecondaryReady] = useState<boolean>(false);
  const loadedSecondaryUrlRef = useRef<string | null>(null);

  const handleSecondaryReady = useCallback(() => {
    setIsSecondaryReady(true);
  }, []);

  // Frame-accurate playhead-driven transition updater (zero React re-render, zero CSS lag)
  const updateTransitionFrame = useCallback((projectMs: number, items: TimelineItem[]) => {
    if (!transitionStageRef.current) return;
    const el = transitionStageRef.current;
    const match = findActiveTransition(projectMs, items);

    if (!match) {
      if (el.style.opacity !== '1') el.style.opacity = '1';
      if (el.style.clipPath !== 'none') el.style.clipPath = 'none';
      if (el.style.transform !== 'none') el.style.transform = 'none';
      if (el.style.filter !== 'none') el.style.filter = 'none';
      return;
    }

    const { delta, type } = match;

    if (type === 'fade') {
      const opacity = delta < 0
        ? Math.max(0, Math.min(1, Math.abs(delta) / 300))
        : Math.max(0, Math.min(1, delta / 300));
      el.style.opacity = String(opacity);
      el.style.clipPath = 'none';
      el.style.transform = 'none';
      el.style.filter = 'none';
    } else if (type === 'dissolve') {
      const frac = delta < 0
        ? Math.max(0, Math.min(1, Math.abs(delta) / 300))
        : Math.max(0, Math.min(1, delta / 300));
      el.style.opacity = String(frac);
      el.style.filter = `blur(${(1 - frac) * 6}px)`;
      el.style.clipPath = 'none';
      el.style.transform = 'none';
    } else if (type === 'wipeleft') {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
      if (delta < 0) {
        const frac = Math.max(0, Math.min(1, (delta + 300) / 300));
        el.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      } else {
        const frac = Math.max(0, Math.min(1, delta / 300));
        el.style.clipPath = `inset(0 0 0 ${(1 - frac) * 100}%)`;
      }
    } else if (type === 'wiperight') {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
      if (delta < 0) {
        const frac = Math.max(0, Math.min(1, (delta + 300) / 300));
        el.style.clipPath = `inset(0 0 0 ${(1 - frac) * 100}%)`;
      } else {
        const frac = Math.max(0, Math.min(1, delta / 300));
        el.style.clipPath = `inset(0 ${(1 - frac) * 100}% 0 0)`;
      }
    } else if (type === 'slideup') {
      el.style.clipPath = 'none';
      el.style.filter = 'none';
      if (delta < 0) {
        const frac = Math.max(0, Math.min(1, (delta + 300) / 300));
        el.style.transform = `translateY(${(1 - frac) * -100}%)`;
        el.style.opacity = String(frac);
      } else {
        const frac = Math.max(0, Math.min(1, delta / 300));
        el.style.transform = `translateY(${(1 - frac) * 100}%)`;
        el.style.opacity = String(frac);
      }
    }
  }, []);

  // Meme Picker State (Step 2)
  const [memeTab, setMemeTab] = useState<'library' | 'custom'>('library');
  const [memeSearch, setMemeSearch] = useState<string>('');
  const [replacingMemeId, setReplacingMemeId] = useState<string | null>(null);
  const [memeUploadError, setMemeUploadError] = useState<string | null>(null);
  const [isMemeSectionOpen, setIsMemeSectionOpen] = useState<boolean>(true);

  // Drag and drop timeline clip reordering (Step 2)
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  // Dedicated + Add Clip input ref (Step 3.1)
  const addClipInputRef = useRef<HTMLInputElement | null>(null);
  const customClipsListRef = useRef<HTMLDivElement | null>(null);

  // Timeline scrubbing & hover state (Item 2)
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [isPrecisionScrubbing, setIsPrecisionScrubbing] = useState<boolean>(false);
  const playheadTouchTimerRef = useRef<number | null>(null);
  const playheadStartXRef = useRef<number>(0);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  // Editable transcript word state
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editingWordText, setEditingWordText] = useState<string>('');
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);

  // Workspace inline banner error
  const [workspaceBannerError, setWorkspaceBannerError] = useState<string | null>(null);

  // Mobile Drawer tab state
  const [mobileDrawerTab, setMobileDrawerTab] = useState<'ai' | 'clips' | 'audio' | 'transcript'>('ai');

  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const trackContainerRef = useRef<HTMLDivElement | null>(null);

  // Fix 5: Lightweight sessionStorage recovery for sample clip
  useEffect(() => {
    if (!project) return;
    const isSample = Boolean(
      project.sourceFileName === 'sample-video.mp4' ||
      project.sourceFileName === 'fastcutz-sample.mp4' ||
      project.isDemoSample ||
      project.title?.toLowerCase().includes('sample')
    );
    if (!isSample) return;

    try {
      const serializableItems = project.items.map((it) => ({
        id: it.id,
        kind: it.kind,
        title: it.title,
        sourceStartMs: it.sourceStartMs,
        sourceEndMs: it.sourceEndMs,
        durationMs: it.durationMs,
        projectStartMs: it.projectStartMs,
        projectEndMs: it.projectEndMs,
        status: it.status,
        transitionOut: it.transitionOut,
        meta: it.meta,
        blobUrl: it.kind === 'SOURCE_CLIP' ? '' : it.blobUrl
      }));
      const snapshot = {
        version: 1,
        savedAt: Date.now(),
        currentProjectMs,
        items: serializableItems
      };
      sessionStorage.setItem('fastcutz_sample_session_v1', JSON.stringify(snapshot));
    } catch {
      // ignore
    }
  }, [project, currentProjectMs]);

  // Map and sort transcript words to Project Time (including added video clips and reordered clips)
  const getWordProjectMs = useCallback((w: { sourceStartMs: number; sourceEndMs: number; clipId?: string }, items: NonNullable<typeof project>['items']): number | null => {
    if (w.clipId && w.clipId !== 'primary') {
      const item = items.find((it) => it.id === w.clipId);
      if (!item || item.status === 'DELETED') return null;
      return item.projectStartMs + Math.max(0, w.sourceStartMs - item.sourceStartMs);
    }
    const sourceItems = items.filter((it) => it.kind === 'SOURCE_CLIP');
    return mapSourceToProjectMs(w.sourceStartMs, sourceItems.length > 0 ? sourceItems : items);
  }, []);

  // Fix 4.3: Render ALL transcript words in ONE single chronological list sorted by original word.sourceStartMs
  const mappedTranscriptWords = useMemo(() => {
    if (!project?.transcript) return [];
    const mapped = project.transcript.map((w) => ({
      word: w,
      projMs: getWordProjectMs(w, project.items)
    }));
    return mapped.sort((a, b) => a.word.sourceStartMs - b.word.sourceStartMs);
  }, [project?.transcript, project?.items, getWordProjectMs]);

  // Setup Web Audio Node Chain on user gesture, playback start, or mount
  const setupWebAudio = useCallback(() => {
    const videoEl = mainVideoRef.current;
    if (!videoEl) return;

    try {
      if (!audioContextRef.current) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new AudioCtxClass();
      }
      const ctx = audioContextRef.current;

      // Build Real-Time DSP Filter Chain once
      if (!nrHighPass1Ref.current) {
        // 1. Noise Removal Stage (audible in live preview, matches FFmpeg native export filters)
        // Cascaded High-pass filter stage 1 at 180 Hz (cuts fan motor hum, transparent at 10 Hz when OFF)
        const nrHighPass1 = ctx.createBiquadFilter();
        nrHighPass1.type = 'highpass';
        nrHighPass1.frequency.value = noiseRemovalEnabled ? 180 : 10;
        nrHighPass1.Q.value = 0.7071;
        nrHighPass1Ref.current = nrHighPass1;

        // Cascaded High-pass filter stage 2 at 180 Hz (combines to 24 dB/oct steep cut for ceiling fan hum)
        const nrHighPass2 = ctx.createBiquadFilter();
        nrHighPass2.type = 'highpass';
        nrHighPass2.frequency.value = noiseRemovalEnabled ? 180 : 10;
        nrHighPass2.Q.value = 0.7071;
        nrHighPass2Ref.current = nrHighPass2;

        // Peaking cut filter at 250 Hz, Q = 1.2, -5.0 dB (targets resonant ceiling fan motor drone, 0 dB when OFF)
        const nrFanHumCut = ctx.createBiquadFilter();
        nrFanHumCut.type = 'peaking';
        nrFanHumCut.frequency.value = 250;
        nrFanHumCut.Q.value = 1.2;
        nrFanHumCut.gain.value = noiseRemovalEnabled ? -5.0 : 0;
        nrFanHumCutRef.current = nrFanHumCut;

        // Low-pass filter at 6200 Hz (cuts fan blade air-whoosh and high hiss, transparent at 22 kHz when OFF)
        const nrLowPass = ctx.createBiquadFilter();
        nrLowPass.type = 'lowpass';
        nrLowPass.frequency.value = noiseRemovalEnabled ? 6200 : 22000;
        nrLowPass.Q.value = 0.7071;
        nrLowPassRef.current = nrLowPass;

        // Noise Gate / Downward Expander Gain Node
        const nrGateGain = ctx.createGain();
        nrGateGain.gain.value = 1.0;
        nrGateGainRef.current = nrGateGain;

        // Listen-only Analyser Node for envelope detection (zero output audio impact)
        const nrAnalyser = ctx.createAnalyser();
        nrAnalyser.fftSize = 256;
        nrAnalyser.smoothingTimeConstant = 0.3;
        nrAnalyserRef.current = nrAnalyser;

        // 2. Voice Enhancement Stage (Warmth cut + Presence boost + Dynamics compressor + Makeup gain)
        // Boxiness/room-echo cut: peaking filter at 260 Hz, Q = 1.2, -3.5 dB (0 dB when OFF)
        const veWarmthCut = ctx.createBiquadFilter();
        veWarmthCut.type = 'peaking';
        veWarmthCut.frequency.value = 260;
        veWarmthCut.Q.value = 1.2;
        veWarmthCut.gain.value = voiceEnhanceEnabled ? -3.5 : 0;
        veWarmthCutRef.current = veWarmthCut;

        // Vocal clarity boost: peaking filter at 2800 Hz, Q = 1.0, +4.5 dB (0 dB when OFF)
        const vePresenceBoost = ctx.createBiquadFilter();
        vePresenceBoost.type = 'peaking';
        vePresenceBoost.frequency.value = 2800;
        vePresenceBoost.Q.value = 1.0;
        vePresenceBoost.gain.value = voiceEnhanceEnabled ? 4.5 : 0;
        vePresenceBoostRef.current = vePresenceBoost;

        // Voice compressor: threshold -18 dB, ratio 3.5, attack 10ms, release 120ms (transparent when OFF)
        const veCompressor = ctx.createDynamicsCompressor();
        veCompressor.threshold.value = voiceEnhanceEnabled ? -18 : 0;
        veCompressor.knee.value = 12;
        veCompressor.ratio.value = voiceEnhanceEnabled ? 3.5 : 1;
        veCompressor.attack.value = 0.01;
        veCompressor.release.value = 0.12;
        veCompressorRef.current = veCompressor;

        // Makeup Gain: 1.25x (+2 dB) when ON, 1.0x when OFF
        const veMakeupGain = ctx.createGain();
        veMakeupGain.gain.value = voiceEnhanceEnabled ? 1.25 : 1.0;
        veMakeupGainRef.current = veMakeupGain;

        // Connect the real-time DSP filter chain strictly in series:
        // nrHighPass1 -> nrHighPass2 -> nrFanHumCut -> nrLowPass -> nrGateGain -> veWarmthCut -> vePresenceBoost -> veCompressor -> veMakeupGain -> destination
        nrHighPass1.connect(nrHighPass2);
        nrHighPass2.connect(nrFanHumCut);
        nrFanHumCut.connect(nrLowPass);
        nrLowPass.connect(nrGateGain);

        // Tap envelope detection analyzer off nrLowPass (listen-only, no parallel route to destination)
        nrLowPass.connect(nrAnalyser);

        nrGateGain.connect(veWarmthCut);
        veWarmthCut.connect(vePresenceBoost);
        vePresenceBoost.connect(veCompressor);
        veCompressor.connect(veMakeupGain);
        veMakeupGain.connect(ctx.destination);
      }

      // Connect primary <video> element to the DSP chain once (guarded by WeakMap cache)
      let sourceNode = mediaSourceCache.get(videoEl);
      if (!sourceNode && nrHighPass1Ref.current) {
        sourceNode = ctx.createMediaElementSource(videoEl);
        mediaSourceCache.set(videoEl, sourceNode);
        sourceNode.connect(nrHighPass1Ref.current);
      }
    } catch {
      // Audio element might already be connected or blocked by autoplay policy
    }
  }, [voiceEnhanceEnabled, noiseRemovalEnabled]);

  // Dynamically update audio node parameters when store toggles (instant live auditioning)
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;

    // Real-Time Noise Removal cascaded filters
    if (nrHighPass1Ref.current) {
      nrHighPass1Ref.current.frequency.setValueAtTime(noiseRemovalEnabled ? 180 : 10, now);
    }
    if (nrHighPass2Ref.current) {
      nrHighPass2Ref.current.frequency.setValueAtTime(noiseRemovalEnabled ? 180 : 10, now);
    }
    if (nrFanHumCutRef.current) {
      nrFanHumCutRef.current.gain.setValueAtTime(noiseRemovalEnabled ? -5.0 : 0, now);
    }
    if (nrLowPassRef.current) {
      nrLowPassRef.current.frequency.setValueAtTime(noiseRemovalEnabled ? 6200 : 22000, now);
    }
    if (!noiseRemovalEnabled && nrGateGainRef.current) {
      nrGateGainRef.current.gain.setValueAtTime(1.0, now);
    }

    // Real-Time Speaker Voice Enhancement filters
    if (veWarmthCutRef.current) {
      veWarmthCutRef.current.gain.setValueAtTime(voiceEnhanceEnabled ? -3.5 : 0, now);
    }
    if (vePresenceBoostRef.current) {
      vePresenceBoostRef.current.gain.setValueAtTime(voiceEnhanceEnabled ? 4.5 : 0, now);
    }
    if (veCompressorRef.current) {
      veCompressorRef.current.threshold.setValueAtTime(voiceEnhanceEnabled ? -18 : 0, now);
      veCompressorRef.current.ratio.setValueAtTime(voiceEnhanceEnabled ? 3.5 : 1, now);
    }
    if (veMakeupGainRef.current) {
      veMakeupGainRef.current.gain.setValueAtTime(voiceEnhanceEnabled ? 1.25 : 1.0, now);
    }
  }, [voiceEnhanceEnabled, noiseRemovalEnabled]);

  // Real-Time Adaptive Downward Expander / Noise Gate Envelope Loop
  useEffect(() => {
    let animId: number;
    const dataArray = new Uint8Array(256);
    const recentRmsHistory: number[] = [];
    let rollingNoiseFloor = 0.015;

    const updateGate = () => {
      const ctx = audioContextRef.current;
      const analyser = nrAnalyserRef.current;
      const gateGain = nrGateGainRef.current;

      if (ctx && analyser && gateGain) {
        const now = ctx.currentTime;
        if (!noiseRemovalEnabled) {
          gateGain.gain.setTargetAtTime(1.0, now, 0.02);
        } else {
          analyser.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const norm = (dataArray[i] - 128) / 128;
            sum += norm * norm;
          }
          const rms = Math.sqrt(sum / dataArray.length);

          // Maintain rolling history of recent RMS frames (~50 frames ≈ 0.8s)
          recentRmsHistory.push(rms);
          if (recentRmsHistory.length > 50) {
            recentRmsHistory.shift();
          }

          // Track rolling background noiseFloor from the lowest ~20% of recent RMS frames
          if (recentRmsHistory.length >= 10) {
            const sorted = [...recentRmsHistory].sort((a, b) => a - b);
            const lowestIdx = Math.floor(sorted.length * 0.20);
            const measuredFloor = sorted[lowestIdx];
            rollingNoiseFloor = rollingNoiseFloor * 0.95 + measuredFloor * 0.05;
          }

          // Adaptive threshold based on measured continuous fan/room noise floor
          const gateThreshold = Math.max(0.018, rollingNoiseFloor * 1.9);

          if (rms < gateThreshold) {
            // Below speech threshold: smooth downward attenuation to 0.05 with release 0.15s to silence fan hum
            gateGain.gain.setTargetAtTime(0.05, now, 0.15);
          } else {
            // Speech detected: fast attack 0.012s to full 1.0x gain
            gateGain.gain.setTargetAtTime(1.0, now, 0.012);
          }
        }
      }

      animId = requestAnimationFrame(updateGate);
    };

    animId = requestAnimationFrame(updateGate);
    return () => cancelAnimationFrame(animId);
  }, [noiseRemovalEnabled]);

  // Ensure AudioContext resumes whenever Noise Removal is toggled ON
  useEffect(() => {
    if (noiseRemovalEnabled && audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, [noiseRemovalEnabled]);

  // Reset secondary video state whenever project changes
  useEffect(() => {
    activeMemeIdRef.current = null;
    loadedSecondaryUrlRef.current = null;
    setIsSecondaryReady(false);
    setActiveMemePlaying(false);
    if (transitionStageRef.current) {
      transitionStageRef.current.style.opacity = '1';
      transitionStageRef.current.style.clipPath = 'none';
      transitionStageRef.current.style.transform = 'none';
      transitionStageRef.current.style.filter = 'none';
    }
    if (memeVideoRef.current) {
      memeVideoRef.current.pause();
      memeVideoRef.current.removeAttribute('src');
      memeVideoRef.current.load();
    }
    if (bgMusicRef.current) {
      bgMusicRef.current.pause();
    }
  }, [project?.id, project?.sourceVideoUrl]);

  // Reactive background music volume & mute sync
  useEffect(() => {
    if (!bgMusicRef.current) return;
    if (bgMusic) {
      bgMusicRef.current.volume = bgMusic.isMuted ? 0 : Math.max(0, Math.min(1, bgMusic.volume));
      bgMusicRef.current.muted = bgMusic.isMuted;
    }
  }, [bgMusic?.volume, bgMusic?.isMuted]);

  // Apply playback speed to video and audio elements
  const applyPlaybackSpeed = useCallback((speed: number) => {
    if (mainVideoRef.current) {
      mainVideoRef.current.playbackRate = speed;
      mainVideoRef.current.preservesPitch = true;
    }
    if (memeVideoRef.current) {
      memeVideoRef.current.playbackRate = speed;
      memeVideoRef.current.preservesPitch = true;
    }
    if (bgMusicRef.current) {
      bgMusicRef.current.playbackRate = speed;
      bgMusicRef.current.preservesPitch = true;
    }
  }, []);

  useEffect(() => {
    applyPlaybackSpeed(previewSpeed);
  }, [previewSpeed, applyPlaybackSpeed]);

  // Main Virtual Playback Engine RAF Loop (Spec 3 - Freeze-Free, Master-Clock Driven)
  useEffect(() => {
    if (!project) return;

    const loop = (timestamp: number) => {
      if (isPlayingRef.current) {
        if (lastTickTimeRef.current === null) {
          lastTickTimeRef.current = timestamp;
        }
        lastTickTimeRef.current = timestamp;

        const totalDuration = project.totalProjectDurationMs;
        const activeItems = project.items.filter(it => it.status !== 'DELETED');

        if (activeItems.length === 0 || currentProjectMsRef.current >= totalDuration) {
          setIsPlaying(false);
          isPlayingRef.current = false;
          lastTickTimeRef.current = null;
          setCurrentProjectMs(totalDuration);
          currentProjectMsRef.current = totalDuration;
          if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
          if (memeVideoRef.current && !memeVideoRef.current.paused) memeVideoRef.current.pause();
          if (memeVideoRef.current) memeVideoRef.current.muted = true;
          if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
          return;
        }

        const curProjMs = currentProjectMsRef.current;
        let currentItemIndex = activeItems.findIndex(it => curProjMs >= it.projectStartMs && curProjMs < it.projectEndMs);
        if (currentItemIndex < 0) {
          // If in a gap or deleted region, jump forward to next active clip
          const nextActive = activeItems.find(it => it.projectStartMs > curProjMs);
          if (nextActive) {
            currentProjectMsRef.current = nextActive.projectStartMs;
            setCurrentProjectMs(nextActive.projectStartMs);
            currentItemIndex = activeItems.indexOf(nextActive);
          } else {
            setIsPlaying(false);
            isPlayingRef.current = false;
            lastTickTimeRef.current = null;
            setCurrentProjectMs(totalDuration);
            currentProjectMsRef.current = totalDuration;
            if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
            if (memeVideoRef.current && !memeVideoRef.current.paused) memeVideoRef.current.pause();
            if (memeVideoRef.current) memeVideoRef.current.muted = true;
            if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
            return;
          }
        }

        const item = activeItems[currentItemIndex];

        if (item.kind === 'SOURCE_CLIP') {
          // SOURCE_CLIP: mainVideoRef is the master video clock
          if (activeMemePlaying) {
            setActiveMemePlaying(false);
          }
          if (memeVideoRef.current) {
            if (!memeVideoRef.current.paused) memeVideoRef.current.pause();
            memeVideoRef.current.muted = true;
          }

          const video = mainVideoRef.current;
          if (video) {
            if (video.playbackRate !== previewSpeed) {
              video.playbackRate = previewSpeed;
              video.preservesPitch = true;
            }

            if (video.paused && !video.ended && !video.seeking && video.readyState >= 2) {
              video.play().catch(() => {});
            }

            // Only update positions if not mid-seek and not mid-switching lock
            if (!video.seeking && !switchingClipRef.current) {
              const curVideoMs = Math.round(video.currentTime * 1000);

              // Check if video reached or passed current segment's sourceEndMs
              if (curVideoMs >= item.sourceEndMs) {
                const nextItem = activeItems[currentItemIndex + 1];

                if (!nextItem) {
                  // Reached end of timeline
                  setIsPlaying(false);
                  isPlayingRef.current = false;
                  lastTickTimeRef.current = null;
                  setCurrentProjectMs(totalDuration);
                  currentProjectMsRef.current = totalDuration;
                  video.pause();
                  if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
                  return;
                }

                switchingClipRef.current = true;
                setTimeout(() => { switchingClipRef.current = false; }, 80);

                if (nextItem.kind === 'SOURCE_CLIP') {
                  // Contiguous Split Rule: if gap <= 80ms, let video play smoothly through with ZERO seek
                  const isContiguous = Math.abs(nextItem.sourceStartMs - item.sourceEndMs) <= 80;
                  if (isContiguous) {
                    const nextProj = nextItem.projectStartMs + Math.max(0, curVideoMs - nextItem.sourceStartMs);
                    currentProjectMsRef.current = nextProj;
                    setCurrentProjectMs(nextProj);
                  } else {
                    // Non-contiguous cut (>80ms gap): seek once to next clip's start
                    if (lastSeekTargetRef.current !== nextItem.sourceStartMs) {
                      lastSeekTargetRef.current = nextItem.sourceStartMs;
                      video.currentTime = nextItem.sourceStartMs / 1000;
                    }
                    currentProjectMsRef.current = nextItem.projectStartMs;
                    setCurrentProjectMs(nextItem.projectStartMs);
                  }
                } else {
                  // Next item is a MEME_CLIP: switch cleanly and lock handoff
                  video.pause();
                  video.muted = true;
                  setActiveMemePlaying(true);
                  currentProjectMsRef.current = nextItem.projectStartMs;
                  setCurrentProjectMs(nextItem.projectStartMs);

                  if (memeVideoRef.current) {
                    memeVideoRef.current.muted = false;
                    if (loadedSecondaryUrlRef.current !== nextItem.blobUrl) {
                      loadedSecondaryUrlRef.current = nextItem.blobUrl;
                      setIsSecondaryReady(false);
                      memeVideoRef.current.src = nextItem.blobUrl;
                    } else if (memeVideoRef.current.readyState >= 2) {
                      setIsSecondaryReady(true);
                    }
                    memeVideoRef.current.playbackRate = previewSpeed;
                    memeVideoRef.current.preservesPitch = true;
                    const memeStartSec = (nextItem.sourceStartMs || 0) / 1000;
                    if (!memeVideoRef.current.seeking && lastSeekTargetRef.current !== nextItem.sourceStartMs) {
                      lastSeekTargetRef.current = nextItem.sourceStartMs;
                      memeVideoRef.current.currentTime = memeStartSec;
                    }
                    memeVideoRef.current.play().catch(() => {});
                  }
                }
              } else {
                // Still playing within item
                // If video is significantly behind segment start (>250ms), align once
                const driftBack = item.sourceStartMs - curVideoMs;
                if (driftBack > 250 && lastSeekTargetRef.current !== item.sourceStartMs) {
                  lastSeekTargetRef.current = item.sourceStartMs;
                  video.currentTime = item.sourceStartMs / 1000;
                }

                // Advance playhead in lockstep with video's native hardware clock
                const offsetMs = Math.max(0, curVideoMs - item.sourceStartMs);
                const nextProj = Math.min(item.projectEndMs, item.projectStartMs + offsetMs);
                currentProjectMsRef.current = nextProj;
                setCurrentProjectMs(nextProj);
              }

            }
          }
        } else {
          // MEME_CLIP: memeVideoRef is the master video clock
          if (!activeMemePlaying) {
            setActiveMemePlaying(true);
          }
          if (mainVideoRef.current) {
            if (!mainVideoRef.current.paused) mainVideoRef.current.pause();
            mainVideoRef.current.muted = true;
          }

          const memeVideo = memeVideoRef.current;
          if (memeVideo) {
            memeVideo.muted = false;
            if (loadedSecondaryUrlRef.current !== item.blobUrl) {
              loadedSecondaryUrlRef.current = item.blobUrl;
              setIsSecondaryReady(false);
              memeVideo.src = item.blobUrl;
              memeVideo.playbackRate = previewSpeed;
              memeVideo.preservesPitch = true;
              const startSec = (item.sourceStartMs || 0) / 1000;
              if (!memeVideo.seeking) {
                memeVideo.currentTime = startSec;
              }
              memeVideo.play().catch(() => {});
            } else {
              if (!isSecondaryReady && memeVideo.readyState >= 2) {
                setIsSecondaryReady(true);
              }
              if (memeVideo.playbackRate !== previewSpeed) {
                memeVideo.playbackRate = previewSpeed;
                memeVideo.preservesPitch = true;
              }
              if (memeVideo.paused && !memeVideo.ended && !memeVideo.seeking && memeVideo.readyState >= 2) {
                memeVideo.play().catch(() => {});
              }
            }

            if (!memeVideo.seeking && !switchingClipRef.current) {
              const curMemeMs = Math.round(memeVideo.currentTime * 1000);

              if (curMemeMs >= item.sourceEndMs) {
                const nextItem = activeItems[currentItemIndex + 1];

                if (!nextItem) {
                  setIsPlaying(false);
                  isPlayingRef.current = false;
                  lastTickTimeRef.current = null;
                  setCurrentProjectMs(totalDuration);
                  currentProjectMsRef.current = totalDuration;
                  memeVideo.pause();
                  memeVideo.muted = true;
                  if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
                  return;
                }

                switchingClipRef.current = true;
                setTimeout(() => { switchingClipRef.current = false; }, 80);

                if (nextItem.kind === 'MEME_CLIP' && loadedSecondaryUrlRef.current === nextItem.blobUrl) {
                  // Contiguous split on same meme
                  const isContiguous = Math.abs(nextItem.sourceStartMs - item.sourceEndMs) <= 80;
                  if (isContiguous) {
                    const nextProj = nextItem.projectStartMs + Math.max(0, curMemeMs - nextItem.sourceStartMs);
                    currentProjectMsRef.current = nextProj;
                    setCurrentProjectMs(nextProj);
                  } else {
                    if (lastSeekTargetRef.current !== nextItem.sourceStartMs) {
                      lastSeekTargetRef.current = nextItem.sourceStartMs;
                      memeVideo.currentTime = (nextItem.sourceStartMs || 0) / 1000;
                    }
                    currentProjectMsRef.current = nextItem.projectStartMs;
                    setCurrentProjectMs(nextItem.projectStartMs);
                  }
                } else if (nextItem.kind === 'SOURCE_CLIP') {
                  // Switch back to source clip
                  memeVideo.pause();
                  memeVideo.muted = true;
                  setActiveMemePlaying(false);
                  currentProjectMsRef.current = nextItem.projectStartMs;
                  setCurrentProjectMs(nextItem.projectStartMs);

                  if (mainVideoRef.current) {
                    mainVideoRef.current.muted = false;
                    if (!mainVideoRef.current.seeking && lastSeekTargetRef.current !== nextItem.sourceStartMs) {
                      lastSeekTargetRef.current = nextItem.sourceStartMs;
                      mainVideoRef.current.currentTime = nextItem.sourceStartMs / 1000;
                    }
                    mainVideoRef.current.play().catch(() => {});
                  }
                } else {
                  // Switch to different meme
                  currentProjectMsRef.current = nextItem.projectStartMs;
                  setCurrentProjectMs(nextItem.projectStartMs);
                }
              } else {
                // Still playing within meme
                const offsetMs = Math.max(0, curMemeMs - item.sourceStartMs);
                const nextProj = Math.min(item.projectEndMs, item.projectStartMs + offsetMs);
                currentProjectMsRef.current = nextProj;
                setCurrentProjectMs(nextProj);
              }
            }
          }
        }

        // Loop Background Music
        if (bgMusic && !bgMusic.isMuted && bgMusic.volume > 0 && bgMusicRef.current) {
          const musicDurSec = Math.max(0.1, bgMusic.durationMs / 1000);
          const targetMusicSec = (currentProjectMsRef.current / 1000) % musicDurSec;
          if (Math.abs(bgMusicRef.current.currentTime - targetMusicSec) > 0.15 && !bgMusicRef.current.seeking) {
            bgMusicRef.current.currentTime = targetMusicSec;
          }
          if (bgMusicRef.current.playbackRate !== previewSpeed) {
            bgMusicRef.current.playbackRate = previewSpeed;
            bgMusicRef.current.preservesPitch = true;
          }
          if (bgMusicRef.current.paused) {
            bgMusicRef.current.play().catch(() => {});
          }
        } else if (bgMusicRef.current && !bgMusicRef.current.paused) {
          bgMusicRef.current.pause();
        }

        // Frame-accurate playhead-driven transition update
        updateTransitionFrame(currentProjectMsRef.current, project.items);
      } else {
        // Paused: halt all playback
        lastTickTimeRef.current = null;
        lastSeekTargetRef.current = null;
        if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
        if (memeVideoRef.current && !memeVideoRef.current.paused) memeVideoRef.current.pause();
        if (memeVideoRef.current) memeVideoRef.current.muted = true;
        if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
        if (project) {
          updateTransitionFrame(currentProjectMsRef.current, project.items);
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying, project, previewSpeed, bgMusic, updateTransitionFrame, setIsPlaying, setCurrentProjectMs, activeMemePlaying, isSecondaryReady]);

  // Synchronize transition frame immediately whenever playhead position changes (scrubbing, seeking, or playing)
  useEffect(() => {
    if (project) {
      updateTransitionFrame(currentProjectMs, project.items);
    }
  }, [currentProjectMs, project, updateTransitionFrame]);

  // Auto-scroll playhead into view when playing and timeline is zoomed
  useEffect(() => {
    if (isPlaying && timelineZoom > 1 && timelineContainerRef.current && project) {
      const container = timelineContainerRef.current;
      const totalWidth = container.scrollWidth;
      const clientWidth = container.clientWidth;
      if (totalWidth > clientWidth && project.totalProjectDurationMs > 0) {
        const playheadX = (currentProjectMs / project.totalProjectDurationMs) * totalWidth;
        const currentScroll = container.scrollLeft;
        // Keep playhead within view
        if (playheadX > currentScroll + clientWidth * 0.75 || playheadX < currentScroll + clientWidth * 0.1) {
          container.scrollLeft = playheadX - clientWidth * 0.3;
        }
      }
    }
  }, [currentProjectMs, isPlaying, timelineZoom, project]);

  // Handle Play/Pause Toggle
  const togglePlayPause = () => {
    setupWebAudio();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    if (!isPlaying && project && currentProjectMsRef.current >= project.totalProjectDurationMs) {
      setCurrentProjectMs(0);
      currentProjectMsRef.current = 0;
      handleSeek(0);
    }
    const willPlay = !isPlaying;
    setIsPlaying(willPlay);
    isPlayingRef.current = willPlay;

    if (willPlay && project) {
      lastSeekTargetRef.current = null;
      lastTickTimeRef.current = null;
      const { item, sourceMs } = mapProjectToSource(currentProjectMsRef.current, project.items);
      if (item && item.kind === 'SOURCE_CLIP' && mainVideoRef.current) {
        setActiveMemePlaying(false);
        if (memeVideoRef.current) {
          if (!memeVideoRef.current.paused) memeVideoRef.current.pause();
          memeVideoRef.current.muted = true;
        }
        mainVideoRef.current.muted = false;
        const targetSec = sourceMs / 1000;
        if (Math.abs(mainVideoRef.current.currentTime - targetSec) > 0.15 && !mainVideoRef.current.seeking) {
          mainVideoRef.current.currentTime = targetSec;
        }
        mainVideoRef.current.playbackRate = previewSpeed;
        mainVideoRef.current.preservesPitch = true;
        mainVideoRef.current.play().catch(() => {
          setIsPlaying(false);
          isPlayingRef.current = false;
        });
      } else if (item && item.kind === 'MEME_CLIP' && memeVideoRef.current) {
        setActiveMemePlaying(true);
        if (mainVideoRef.current) {
          if (!mainVideoRef.current.paused) mainVideoRef.current.pause();
          mainVideoRef.current.muted = true;
        }
        memeVideoRef.current.muted = false;
        if (loadedSecondaryUrlRef.current !== item.blobUrl) {
          loadedSecondaryUrlRef.current = item.blobUrl;
          setIsSecondaryReady(false);
          memeVideoRef.current.src = item.blobUrl;
        } else if (!isSecondaryReady && memeVideoRef.current.readyState >= 2) {
          setIsSecondaryReady(true);
        }
        memeVideoRef.current.playbackRate = previewSpeed;
        memeVideoRef.current.preservesPitch = true;
        const targetSec = sourceMs / 1000;
        if (Math.abs(memeVideoRef.current.currentTime - targetSec) > 0.15 && !memeVideoRef.current.seeking) {
          memeVideoRef.current.currentTime = targetSec;
        }
        memeVideoRef.current.play().catch(() => {
          setIsPlaying(false);
          isPlayingRef.current = false;
        });
      }
    }
  };

  // Ensure AudioContext resumes whenever playback is triggered
  useEffect(() => {
    if (isPlaying) {
      setupWebAudio();
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    }
  }, [isPlaying, setupWebAudio]);

  // Handle Manual Scrubbing
  const handleSeek = (newProjectMs: number) => {
    const clamped = Math.max(0, Math.min(newProjectMs, project?.totalProjectDurationMs || 0));
    currentProjectMsRef.current = clamped;
    setCurrentProjectMs(clamped);
    lastSeekTargetRef.current = null;

    if (project) {
      const { item, sourceMs } = mapProjectToSource(clamped, project.items);
      if (item && item.kind === 'SOURCE_CLIP') {
        setActiveMemePlaying(false);
        if (memeVideoRef.current) {
          if (!memeVideoRef.current.paused) memeVideoRef.current.pause();
          memeVideoRef.current.muted = true;
        }
        const sec = sourceMs / 1000;
        if (mainVideoRef.current) {
          mainVideoRef.current.muted = false;
          mainVideoRef.current.currentTime = sec;
          lastSeekTargetRef.current = sourceMs;
          if (isPlayingRef.current && mainVideoRef.current.paused) {
            mainVideoRef.current.play().catch(() => {});
          }
        }
      } else if (item && item.kind === 'MEME_CLIP') {
        setActiveMemePlaying(true);
        if (mainVideoRef.current) {
          if (!mainVideoRef.current.paused) mainVideoRef.current.pause();
          mainVideoRef.current.muted = true;
        }
        if (memeVideoRef.current) {
          memeVideoRef.current.muted = false;
          if (loadedSecondaryUrlRef.current !== item.blobUrl) {
            loadedSecondaryUrlRef.current = item.blobUrl;
            setIsSecondaryReady(false);
            memeVideoRef.current.src = item.blobUrl;
          } else if (memeVideoRef.current.readyState >= 2) {
            setIsSecondaryReady(true);
          }
          const memeSec = sourceMs / 1000;
          memeVideoRef.current.currentTime = memeSec;
          lastSeekTargetRef.current = sourceMs;
          if (isPlayingRef.current && memeVideoRef.current.paused) {
            memeVideoRef.current.play().catch(() => {});
          }
        }
      }

      // Sync background music loop position on seek
      if (bgMusic && bgMusicRef.current) {
        const musicDurSec = Math.max(0.1, bgMusic.durationMs / 1000);
        bgMusicRef.current.currentTime = (clamped / 1000) % musicDurSec;
        if (isPlayingRef.current && !bgMusic.isMuted && bgMusic.volume > 0 && bgMusicRef.current.paused) {
          bgMusicRef.current.play().catch(() => {});
        }
      }

      // Frame-accurate playhead-driven transition update
      updateTransitionFrame(clamped, project.items);
    }
  };

  // Format timestamp for InShot-style floating label (e.g. "0:11.1")
  const formatReadout = (ms: number): string => {
    const totalSec = Math.max(0, ms) / 1000;
    const mins = Math.floor(totalSec / 60);
    const secVal = (totalSec % 60).toFixed(1);
    const secFormatted = Number(secVal) < 10 ? `0${secVal}` : secVal;
    return `${mins}:${secFormatted}`;
  };

  // Calculate track time and percentage from cursor clientX
  const calcTrackTimeAndPct = useCallback((clientX: number) => {
    if (!trackContainerRef.current || !project || project.totalProjectDurationMs <= 0) return null;
    const rect = trackContainerRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const pct = rect.width > 0 ? clickX / rect.width : 0;
    const timeMs = Math.round(pct * project.totalProjectDurationMs);
    return { pct: pct * 100, timeMs };
  }, [project]);

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a, label, [data-no-scrub="true"]')) {
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if not supported
    }
    const res = calcTrackTimeAndPct(e.clientX);
    if (!res) return;
    setIsScrubbing(true);
    handleSeek(res.timeMs);
    setHoverTimeMs(res.timeMs);
    setHoverPct(res.pct);
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing && (e.target as HTMLElement).closest('button, input, select, textarea, a, label, [data-no-scrub="true"]')) {
      setHoverTimeMs(null);
      setHoverPct(null);
      return;
    }
    const res = calcTrackTimeAndPct(e.clientX);
    if (!res) return;
    setHoverTimeMs(res.timeMs);
    setHoverPct(res.pct);
    if (isScrubbing) {
      handleSeek(res.timeMs);
    }
  };

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    setIsScrubbing(false);
    setHoverTimeMs(null);
    setHoverPct(null);
  };

  const handleTrackPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    setIsScrubbing(false);
    setHoverTimeMs(null);
    setHoverPct(null);
  };

  const handleTrackMouseLeave = () => {
    if (!isScrubbing) {
      setHoverTimeMs(null);
      setHoverPct(null);
    }
  };

  // Mobile press-and-hold precision scrub on red playhead marker (Fix 1.4)
  const handlePlayheadTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 0) return;
    const clientX = e.touches[0].clientX;
    playheadStartXRef.current = clientX;

    if (playheadTouchTimerRef.current) clearTimeout(playheadTouchTimerRef.current);
    playheadTouchTimerRef.current = window.setTimeout(() => {
      setIsPrecisionScrubbing(true);
      setIsScrubbing(true);
      const res = calcTrackTimeAndPct(clientX);
      if (res) {
        handleSeek(res.timeMs);
        setHoverTimeMs(res.timeMs);
        setHoverPct(res.pct);
      }
    }, 350);
  };

  const handlePlayheadTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 0) return;
    const clientX = e.touches[0].clientX;
    if (Math.abs(clientX - playheadStartXRef.current) > 4) {
      if (playheadTouchTimerRef.current) {
        clearTimeout(playheadTouchTimerRef.current);
        playheadTouchTimerRef.current = null;
      }
      setIsPrecisionScrubbing(true);
      setIsScrubbing(true);
    }

    if (isPrecisionScrubbing || isScrubbing) {
      const res = calcTrackTimeAndPct(clientX);
      if (res) {
        handleSeek(res.timeMs);
        setHoverTimeMs(res.timeMs);
        setHoverPct(res.pct);
      }
    }
  };

  const handlePlayheadTouchEnd = () => {
    if (playheadTouchTimerRef.current) {
      clearTimeout(playheadTouchTimerRef.current);
      playheadTouchTimerRef.current = null;
    }
    setIsPrecisionScrubbing(false);
    setIsScrubbing(false);
    setHoverTimeMs(null);
    setHoverPct(null);
  };

  // Window listeners during scrubbing
  useEffect(() => {
    if (!isScrubbing) return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      const res = calcTrackTimeAndPct(e.clientX);
      if (!res) return;
      handleSeek(res.timeMs);
      setHoverTimeMs(res.timeMs);
      setHoverPct(res.pct);
    };

    const handleWindowPointerUp = () => {
      setIsScrubbing(false);
      setHoverTimeMs(null);
      setHoverPct(null);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [isScrubbing, calcTrackTimeAndPct]);

  // Keyboard shortcut listener ('S' to split at playhead)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [splitAtPlayhead, togglePlayPause]);

  // AI Command Execution
  const handleSendCommand = async () => {
    if (!promptInput.trim() || isAiProcessing || !project) return;
    setIsAiProcessing(true);
    const query = promptInput;
    setPromptInput('');

    try {
      const command = await parseCommandWithFallback(
        query,
        currentProjectMs,
        project.totalProjectDurationMs,
        project,
        Boolean(bgMusic)
      );

      // Deterministic Safety Net for ADD_TRANSITION
      if (command.action === 'ADD_TRANSITION') {
        const payload = command.payload as any;
        payload.type = 'fade';

        if (payload.targetMs == null) {
          const lowerQuery = query.toLowerCase();
          // Match m:ss (e.g. 0:11, 0:11 sec, 1:05s, with or without at/@)
          const mssMatch = lowerQuery.match(/(?:at|@)?\s*\b(\d+):([0-5]\d(?:\.\d+)?)\s*(?:s|se|sec|secs|seconds)?\b/i);
          if (mssMatch) {
            const mins = parseInt(mssMatch[1], 10);
            const secs = parseFloat(mssMatch[2]);
            if (!isNaN(mins) && !isNaN(secs)) {
              payload.targetMs = Math.round((mins * 60 + secs) * 1000);
            }
          } else {
            // Match (?:at|@)\s*(\d+(?:\.\d+)?)\s*(?:s|se|sec|secs|seconds)?\b OR \b(\d+(?:\.\d+)?)\s*(?:s|se|sec|secs|seconds)\b
            const secMatch = lowerQuery.match(/(?:at|@)\s*(\d+(?:\.\d+)?)\s*(?:s|se|sec|secs|seconds)?\b/i) ||
                             lowerQuery.match(/\b(\d+(?:\.\d+)?)\s*(?:s|se|sec|secs|seconds)\b/i);
            if (secMatch) {
              const secs = parseFloat(secMatch[1]);
              if (!isNaN(secs)) {
                payload.targetMs = Math.round(secs * 1000);
              }
            }
          }
        }

        if (payload.targetMs == null && /\b(here|marker|playhead|current\s*position)\b/i.test(query)) {
          payload.usePlayhead = true;
        }
      }

      await applyAICommand(command, query, currentProjectMs);
    } catch (err: unknown) {
      console.warn('Command processing failed:', err);
      addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: query,
        timestamp: Date.now(),
        parsedCommand: {
          action: 'UNSUPPORTED_OPERATION',
          payload: { feature: 'command_execution', message: err instanceof Error ? err.message : 'Failed to process command' },
          explanation: 'Command execution encountered an error.'
        },
        status: 'WARNING',
        appliedMessage: err instanceof Error ? err.message : 'Could not execute command. Please try a different wording.'
      });
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Process and validate custom meme file (MIME, extension, size, duration)
  const processCustomMemeFile = async (file: File) => {
    setMemeUploadError(null);

    // Validate MIME and extension (MP4, WebM, and MOV only)
    const validMimes = ['video/mp4', 'video/webm', 'video/quicktime'];
    const validExts = ['.mp4', '.webm', '.mov'];
    const lowerName = file.name.toLowerCase();
    const hasValidExt = validExts.some(ext => lowerName.endsWith(ext));
    const hasValidMime = validMimes.includes(file.type);

    if (!hasValidExt && !hasValidMime) {
      setMemeUploadError('Unsupported file format. Only MP4, WebM, and MOV video clips are accepted.');
      return;
    }

    // Validate size (max 100 MB)
    if (file.size > 100 * 1024 * 1024) {
      setMemeUploadError('File exceeds 100 MB limit. Please select a clip up to 100 MB.');
      return;
    }

    try {
      const meme = await addUploadedMeme(file);
      // Validate duration (max 180s / 3 mins)
      if (meme.durationMs > 180500) {
        removeUploadedMeme(meme.id);
        setMemeUploadError(`Clip duration (${(meme.durationMs / 1000).toFixed(1)}s) exceeds 3-minute limit.`);
        return;
      }

      addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: `Upload custom clip ${meme.name}`,
        timestamp: Date.now(),
        parsedCommand: {
          action: 'INSERT_USER_CLIP',
          payload: { clipId: meme.id, atProjectMs: currentProjectMs },
          explanation: `Uploaded ${meme.name}`
        },
        status: 'SUCCESS',
        appliedMessage: `Uploaded "${meme.name}" (${(meme.durationMs / 1000).toFixed(1)}s). Ready to insert!`
      });

      // Auto-scroll newly uploaded clip into view
      setTimeout(() => {
        if (customClipsListRef.current) {
          customClipsListRef.current.scrollTop = customClipsListRef.current.scrollHeight;
        }
      }, 60);
    } catch {
      setMemeUploadError('Failed to read video metadata. Ensure it is a valid video file.');
    }
  };

  const handleCustomMemeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processCustomMemeFile(file);
    e.target.value = '';
  };

  // Dedicated + Add Clip handler for toolbar file input (Step 3.1)
  const handleAddClipFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      setWorkspaceBannerError('File exceeds 100 MB limit. Please select a clip up to 100 MB.');
      e.target.value = '';
      return;
    }

    const validExts = ['.mp4', '.webm', '.mov'];
    const hasValidExt = validExts.some(ext => file.name.toLowerCase().endsWith(ext));
    if (!hasValidExt && !file.type.startsWith('video/')) {
      setWorkspaceBannerError('Please select a valid .mp4, .webm, or .mov video file.');
      e.target.value = '';
      return;
    }

    try {
      const uploaded = await addUploadedMeme(file);
      if (uploaded.durationMs > 180500) {
        removeUploadedMeme(uploaded.id);
        setWorkspaceBannerError(`Clip duration (${(uploaded.durationMs / 1000).toFixed(1)}s) exceeds 3-minute limit.`);
        return;
      }
      await appendClipToEnd({
        id: uploaded.id,
        name: uploaded.name,
        url: uploaded.blobUrl,
        durationMs: uploaded.durationMs,
        isCustom: true
      });
    } catch {
      setWorkspaceBannerError('Failed to read video metadata for the uploaded clip.');
    } finally {
      e.target.value = '';
    }
  };

  // Dedicated + Add Music handler for toolbar and timeline music track
  const handleBgMusicFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 30 * 1024 * 1024) {
      setWorkspaceBannerError('Audio file exceeds 30 MB limit. Please select a track under 30 MB.');
      e.target.value = '';
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    const tempAudio = document.createElement('audio');
    tempAudio.preload = 'metadata';
    tempAudio.src = blobUrl;

    const finalize = (durationMs: number) => {
      setBgMusic({
        file,
        blobUrl,
        name: file.name,
        durationMs,
        volume: 0.35,
        isMuted: false
      });
      if (bgMusicInputRef.current) bgMusicInputRef.current.value = '';
    };

    tempAudio.onloadedmetadata = () => {
      const durationMs = isNaN(tempAudio.duration) || tempAudio.duration <= 0
        ? 60000
        : Math.round(tempAudio.duration * 1000);
      finalize(durationMs);
    };

    tempAudio.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      if (bgMusicInputRef.current) bgMusicInputRef.current.value = '';
      setWorkspaceBannerError('Could not decode audio file metadata. Please choose a valid MP3, WAV, or AAC audio file.');
      addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: `Add music: ${file.name}`,
        timestamp: Date.now(),
        parsedCommand: {
          action: 'UNSUPPORTED_OPERATION',
          payload: { feature: 'bg_music', message: 'Could not decode audio file metadata.' },
          explanation: 'Failed to read audio metadata.'
        },
        status: 'WARNING',
        appliedMessage: `Could not load "${file.name}" — audio format could not be decoded.`
      });
    };
  };

  if (!project) return null;

  const totalProjSecNum = Math.max(1, project.totalProjectDurationMs / 1000);
  const totalProjSec = totalProjSecNum.toFixed(1);
  const curProjSec = (currentProjectMs / 1000).toFixed(1);

  const filteredMemes = MEME_LIBRARY.filter((m) => {
    if (!memeSearch.trim()) return true;
    const q = memeSearch.toLowerCase();
    return m.title.toLowerCase().includes(q) || m.keywords.some((k) => k.toLowerCase().includes(q));
  });

  const rulerMajorStepSec = timelineZoom >= 3.5 ? 1 : timelineZoom >= 2 ? 2 : 5;
  const rulerMinorStepSec = rulerMajorStepSec === 1 ? 0.5 : 1;
  const totalDurationSec = project.totalProjectDurationMs / 1000;
  const majorTickCount = Math.floor(totalDurationSec / rulerMajorStepSec);
  const minorTickCount = Math.floor(totalDurationSec / rulerMinorStepSec);

  // Audio filter toggles
  const handleToggleVoiceEnhance = () => {
    setupWebAudio();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    toggleVoiceEnhance();
  };

  const handleToggleNoiseRemoval = () => {
    setupWebAudio();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    toggleNoiseRemoval();
  };

  // Silence Detection runner
  const handleDetectSilences = async () => {
    if (isDetectingSilences) return;
    setIsDetectingSilences(true);
    const cfg = SILENCE_PRESETS.Normal;
    try {
      const res = await detectSilencesOnly('Normal');
      addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: 'Detect pauses (Normal mode)',
        timestamp: Date.now(),
        parsedCommand: {
          action: 'REMOVE_SILENCE',
          payload: { minDurationMs: cfg.minSilenceMs, paddingPreMs: cfg.prePaddingMs, paddingPostMs: cfg.postPaddingMs },
          explanation: res.message
        },
        status: res.count > 0 ? 'SUCCESS' : 'WARNING',
        appliedMessage: res.message
      });
    } catch (err: unknown) {
      addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: 'Detect pauses (Normal mode)',
        timestamp: Date.now(),
        parsedCommand: {
          action: 'REMOVE_SILENCE',
          payload: { minDurationMs: cfg.minSilenceMs, paddingPreMs: cfg.prePaddingMs, paddingPostMs: cfg.postPaddingMs },
          explanation: 'Silence detection failed.'
        },
        status: 'WARNING',
        appliedMessage: err instanceof Error ? err.message : 'Could not analyze audio for pauses on this device.'
      });
    } finally {
      setIsDetectingSilences(false);
    }
  };

  // Sub-render: Transcript Section (used in desktop left sidebar & mobile transcript tab)
  const renderTranscriptSection = () => (
    <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
      <div className="space-y-3">
        {/* Quality & Mode Controls OR Single Loading Card */}
        {transcriptionStatus === 'downloading_model' || transcriptionStatus === 'transcribing' ? (
          <div className="p-3.5 rounded-xl bg-white dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] space-y-2.5 shadow-sm">
            <div className="flex items-center justify-between text-xs text-[#181715] dark:text-[#F4F2EC] font-medium">
              <span className="flex items-center space-x-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#D96B27] dark:text-[#E8632A]" />
                <span className="font-semibold">
                  {transcriptionStatus === 'downloading_model'
                    ? `Downloading Whisper Model... (${transcriptionDownloadPercent}%)`
                    : 'Transcribing Audio...'}
                </span>
              </span>
              <button
                type="button"
                onClick={cancelTranscription}
                className="text-xs text-[#66625B] dark:text-[#A39E95] hover:text-[#DC2626] dark:hover:text-[#F87171] px-2.5 py-1 rounded-md bg-[#F7F6F2] dark:bg-[#24221F] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A]/40 border border-[#E5E2DC] dark:border-[#2C2A27] transition-colors cursor-pointer font-medium"
              >
                Cancel
              </button>
            </div>
            {transcriptionStatus === 'downloading_model' ? (
              <div className="w-full bg-[#E5E2DC] dark:bg-[#2C2A27] rounded-full h-2 overflow-hidden">
                <div
                  className="bg-[#D96B27] dark:bg-[#E8632A] h-2 rounded-full transition-all duration-200"
                  style={{ width: `${transcriptionDownloadPercent}%` }}
                />
              </div>
            ) : (
              <div className="w-full bg-[#E5E2DC] dark:bg-[#2C2A27] rounded-full h-2 overflow-hidden">
                <div className="bg-[#D96B27] dark:bg-[#E8632A] h-2 rounded-full w-2/3 animate-pulse" />
              </div>
            )}
            <p className="text-[11px] text-[#8E8A82] dark:text-[#78736B]">
              First use downloads the model (~75 MB) once and caches it locally.
            </p>
          </div>
        ) : (
          <div className="p-2.5 rounded-xl bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] space-y-2">
            {/* Quality Selector */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#66625B] dark:text-[#A39E95] font-medium">Quality:</span>
              <select
                value={transcriptQuality}
                onChange={(e) => setTranscriptQuality(e.target.value as any)}
                disabled={transcriptMode === 'transcribe_hinglish'}
                className="bg-white dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC] text-[11px] rounded px-2 py-1 focus:outline-none focus:border-[#D96B27] dark:focus:border-[#E8632A] cursor-pointer disabled:opacity-50"
              >
                <option value="accurate">Accurate (Small, ~285 MB)</option>
                <option value="fast">Fast (Base, ~75 MB)</option>
              </select>
            </div>

            {/* Mode Selector */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#66625B] dark:text-[#A39E95] font-medium">Mode:</span>
              <select
                value={transcriptMode}
                onChange={(e) => setTranscriptMode(e.target.value as any)}
                className="bg-white dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC] text-[11px] rounded px-2 py-1 max-w-[175px] truncate focus:outline-none focus:border-[#D96B27] dark:focus:border-[#E8632A] cursor-pointer disabled:opacity-50"
              >
                <option value="transcribe_hinglish">Hinglish (Mixed Hindi + English)</option>
                <option value="translate_en">English (translated)</option>
                <option value="transcribe_en">English (as spoken)</option>
              </select>
            </div>

            <p className="text-[10px] text-[#8E8A82] dark:text-[#78736B]">
              First use downloads the model ({transcriptMode === 'transcribe_hinglish' ? 'about 72 MB' : transcriptQuality === 'accurate' ? 'about 285 MB' : 'about 75 MB'}), only once.
            </p>

            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                onClick={() => generateTranscript(transcriptQuality, transcriptMode)}
                className="flex-1 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white font-medium py-1.5 px-3 rounded-lg text-xs flex items-center justify-center space-x-1.5 shadow-sm transition-all cursor-pointer"
              >
                {project.transcript.length > 0 && !project.isDemoSample ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Regenerate</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generate Transcript</span>
                  </>
                )}
              </button>

              {project.transcript.length > 0 && (
                <button
                  type="button"
                  onClick={() => downloadTranscriptAsTxt(project.transcript, `${project.title.replace(/\.[^/.]+$/, '')}_transcript.txt`)}
                  title="Download transcript as .txt"
                  className="bg-white dark:bg-[#24221F] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27] text-[#66625B] dark:text-[#A39E95] p-1.5 rounded-lg border border-[#E5E2DC] dark:border-[#2C2A27] transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Fallback Notice if Small model fell back to Base */}
        {transcriptionFallbackNotice && (
          <div className="p-2.5 rounded-lg bg-[#FFFBEB] dark:bg-[#78350F]/30 border border-[#FCD34D] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A] text-[11px] flex items-start space-x-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 text-[#D97706] dark:text-[#FBBF24] mt-0.5" />
            <span>{transcriptionFallbackNotice}</span>
          </div>
        )}

        {/* Urdu Script Warning Banner */}
        {project.transcriptionMeta?.hasUrduWarning && (
          <div className="p-2.5 rounded-lg bg-[#FFFBEB] dark:bg-[#78350F]/30 border border-[#FCD34D] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A] text-[11px] flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#D97706] dark:text-[#FBBF24] mt-0.5" />
            <span>Output contains Urdu-script text. For a cleaner result use &apos;English (translated)&apos; mode.</span>
          </div>
        )}

        {/* Status Banner: Error */}
        {transcriptionStatus === 'error' && (
          <div className="p-3 rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A]/40 border border-[#FCA5A5] dark:border-[#991B1B] space-y-1.5">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#B91C1C] dark:text-[#FCA5A5]">
              <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] flex-shrink-0" />
              <span>Transcription Failed</span>
            </div>
            <p className="text-[11px] text-[#991B1B] dark:text-[#FCA5A5] leading-snug">{transcriptionError}</p>
            <button
              type="button"
              onClick={() => generateTranscript(transcriptQuality, transcriptMode)}
              className="text-[10px] text-[#DC2626] dark:text-[#F87171] hover:underline mt-1 font-medium cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Transcript Content List */}
        {project.transcript.length === 0 && transcriptionStatus === 'idle' ? (
          <div className="p-4 rounded-xl bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] text-center space-y-2">
            <p className="text-[#181715] dark:text-[#F4F2EC] text-xs font-medium">No transcript generated yet.</p>
            <p className="text-[11px] text-[#66625B] dark:text-[#A39E95] leading-relaxed">
              Click &quot;Generate Transcript&quot; above to transcribe using in-browser Whisper AI. First use downloads the model once.
            </p>
          </div>
        ) : project.transcript.length > 0 ? (
          <div className="space-y-2">
            {project.transcriptionMeta?.lowQualityWarning && (
              <div className="p-2.5 rounded-lg bg-[#FFFBEB] dark:bg-[#78350F]/30 border border-[#FCD34D] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A] text-[11px] flex items-start space-x-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-[#D97706] dark:text-[#FBBF24] mt-0.5" />
                <span>{project.transcriptionMeta.lowQualityWarning}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-[#66625B] dark:text-[#A39E95] pb-1 border-b border-[#E5E2DC] dark:border-[#2C2A27]">
              <span>Click to seek • Double-click to edit:</span>
              {addedClipTranscribing ? (
                <span className="text-[10px] bg-[#FFFBEB] dark:bg-[#78350F]/30 text-[#D97706] dark:text-[#FBBF24] border border-[#FCD34D] dark:border-[#B45309] px-1.5 py-0.5 rounded font-mono flex items-center space-x-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>Transcribing added clip...</span>
                </span>
              ) : project.isDemoSample ? (
                <span className="text-[10px] bg-[#FFFBEB] dark:bg-[#78350F]/30 text-[#92400E] dark:text-[#FDE68A] border border-[#FCD34D] dark:border-[#B45309] px-1.5 py-0.5 rounded font-mono">
                  Sample transcript
                </span>
              ) : (
                <span className="text-[10px] bg-[#F7F6F2] dark:bg-[#24221F] text-[#66625B] dark:text-[#A39E95] border border-[#E5E2DC] dark:border-[#2C2A27] px-1.5 py-0.5 rounded font-mono">
                  {project.transcriptionMeta?.modelName || (transcriptQuality === 'accurate' ? 'Whisper Small' : 'Whisper Base')} ({project.transcript.length} words)
                </span>
              )}
            </div>

            {/* Tap-Friendly "Edit Selected Word" Bar (Touch & Mobile Accessible) */}
            {selectedWordId && (() => {
              const selWord = project.transcript.find(w => w.id === selectedWordId);
              if (!selWord) return null;
              return (
                <div className="flex items-center justify-between p-2 rounded-lg bg-[#FAF9F5] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] text-xs">
                  <div className="flex items-center space-x-1.5 truncate">
                    <span className="text-[#66625B] dark:text-[#A39E95]">Selected:</span>
                    <span className="font-semibold text-[#181715] dark:text-[#F4F2EC]">&quot;{selWord.word}&quot;</span>
                  </div>
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingWordId(selWord.id);
                        setEditingWordText(selWord.word);
                      }}
                      className="px-2.5 py-1 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white rounded text-xs font-medium cursor-pointer shadow-xs"
                    >
                      Edit Word
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedWordId(null)}
                      className="p-1 text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="leading-relaxed space-x-1 font-sans text-xs">
              {mappedTranscriptWords.map(({ word: w, projMs }) => {
                const isDeleted = projMs === null;
                const isCurrent =
                  projMs !== null &&
                  currentProjectMs >= projMs &&
                  currentProjectMs < projMs + (w.sourceEndMs - w.sourceStartMs);

                if (editingWordId === w.id) {
                  return (
                    <input
                      key={w.id}
                      type="text"
                      autoFocus
                      value={editingWordText}
                      onChange={(e) => setEditingWordText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateTranscriptWord(w.id, editingWordText);
                          setEditingWordId(null);
                        } else if (e.key === 'Escape') {
                          setEditingWordId(null);
                        }
                      }}
                      onBlur={() => {
                        updateTranscriptWord(w.id, editingWordText);
                        setEditingWordId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-white dark:bg-[#24221F] text-[#181715] dark:text-[#F4F2EC] font-medium border border-[#D96B27] dark:border-[#E8632A] rounded px-1 py-0.5 text-xs outline-none w-20 inline-block shadow-sm"
                    />
                  );
                }

                return (
                  <span
                    key={w.id}
                    onClick={() => {
                      setSelectedWordId(w.id);
                      if (projMs !== null) {
                        handleSeek(projMs);
                      } else {
                        const activeItems = project.items.filter(
                          (it) => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME'
                        );
                        const nextActive = activeItems.find((it) => it.sourceStartMs >= w.sourceStartMs);
                        if (nextActive) {
                          handleSeek(nextActive.projectStartMs);
                        } else if (activeItems.length > 0) {
                          handleSeek(activeItems[0].projectStartMs);
                        }
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingWordId(w.id);
                      setEditingWordText(w.word);
                    }}
                    title={
                      isDeleted
                        ? 'Word cut from timeline. Click to seek to next active section. (Double-click to edit)'
                        : `${w.edited ? '[Edited] ' : ''}Source: ${(w.sourceStartMs / 1000).toFixed(1)}s (Double-click to edit)`
                    }
                    className={`inline-block px-1 py-0.5 rounded cursor-pointer transition-colors ${
                      isDeleted
                        ? 'line-through opacity-45 text-[#8A857C] dark:text-[#6B6760]'
                        : isCurrent
                        ? 'bg-[#FEF3C7] dark:bg-[#78350F]/50 text-[#92400E] dark:text-[#FDE68A] font-bold border border-[#F59E0B] dark:border-[#B45309]'
                        : selectedWordId === w.id
                        ? 'bg-[#FAF9F5] dark:bg-[#24221F] text-[#181715] dark:text-[#F4F2EC] ring-2 ring-[#D96B27] dark:ring-[#E8632A]'
                        : 'text-[#181715] dark:text-[#F4F2EC] hover:bg-[#F2EFEB] dark:hover:bg-[#24221F]'
                    } ${w.edited ? 'ring-1 ring-[#0D9488]/50 dark:ring-[#2DD4BF]/50 bg-[#F0FDFA] dark:bg-[#14B8A6]/15' : ''}`}
                  >
                    {w.word}
                    {w.edited && <span className="text-[9px] text-[#0F766E] dark:text-[#5EEAD4] ml-0.5 font-bold">*</span>}
                  </span>
                );
              })}
            </div>

            {/* Labels under the transcript */}
            <div className="pt-2.5 mt-2 border-t border-[#E5E2DC] dark:border-[#2C2A27] text-[11px] text-[#66625B] dark:text-[#A39E95] space-y-1">
              <div className="flex items-center justify-between text-[10px] text-[#66625B] dark:text-[#A39E95] font-mono tabular-nums">
                <span>
                  {project.transcriptionMeta?.modelName || (transcriptQuality === 'accurate' ? 'Whisper Small' : 'Whisper Base')} ({project.transcriptionMeta?.device || 'WASM'})
                </span>
                <span>
                  {project.transcriptionMeta?.durationMs ? `${(project.transcriptionMeta.durationMs / 1000).toFixed(1)}s` : ''}
                </span>
              </div>
              <div className="text-[10px] text-[#66625B] dark:text-[#A39E95]">
                Mode:{' '}
                {
                  (project.transcriptionMeta?.mode || transcriptMode) === 'transcribe_hinglish'
                    ? 'Hinglish (Mixed Hindi + English)'
                    : (project.transcriptionMeta?.mode || transcriptMode) === 'transcribe_en'
                    ? 'English (as spoken)'
                    : 'English (translated)'
                }
              </div>
              <p className="text-[10px] text-[#8E8A82] dark:text-[#78736B] italic">
                Auto-generated, may contain errors. Double-click a word to fix it.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  // Sub-render: Memes Section (used in desktop right sidebar & mobile clips tab)
  const renderMemesSection = () => (
    <div className="space-y-2 pt-1 border-t border-[#E5E2DC] dark:border-[#2C2A27]">
      {/* Section Header with Chevron Toggle & Replace Banner */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsMemeSectionOpen(!isMemeSectionOpen)}
          className="flex items-center space-x-1.5 hover:text-[#181715] dark:hover:text-[#F4F2EC] transition-colors group cursor-pointer text-[#66625B] dark:text-[#A39E95]"
        >
          <Film className="w-3.5 h-3.5 text-[#E11D48]" />
          <span className="text-[10px] uppercase font-bold tracking-wider text-[#66625B] dark:text-[#A39E95] group-hover:text-[#181715] dark:group-hover:text-[#F4F2EC]">
            Meme Reactions
          </span>
          <ChevronDown
            className={`w-3 h-3 text-[#66625B] dark:text-[#A39E95] group-hover:text-[#181715] dark:group-hover:text-[#F4F2EC] transition-transform duration-150 ${
              isMemeSectionOpen ? 'rotate-0' : '-rotate-90'
            }`}
          />
        </button>
        {replacingMemeId && (
          <button
            onClick={() => setReplacingMemeId(null)}
            className="text-[10px] text-[#92400E] dark:text-[#FDE68A] hover:text-[#78350F] font-medium flex items-center space-x-0.5 bg-[#FFFBEB] dark:bg-[#78350F]/30 px-1.5 py-0.5 rounded border border-[#FCD34D] dark:border-[#B45309] cursor-pointer"
          >
            <span>Cancel Replace</span>
            <X className="w-2.5 h-2.5 ml-0.5" />
          </button>
        )}
      </div>

      {isMemeSectionOpen && (
        <>
          {replacingMemeId && (
            <div className="p-1.5 rounded-lg bg-[#FFFBEB] dark:bg-[#78350F]/30 border border-[#FCD34D] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A] text-[10px]">
              Select any meme below to replace the chosen clip
            </div>
          )}

          {/* Segmented Two-Option Toggle */}
          <div className="flex rounded-lg bg-[#F7F6F2] dark:bg-[#1E1D1B] p-0.5 border border-[#E5E2DC] dark:border-[#2C2A27] text-[11px]">
            <button
              onClick={() => setMemeTab('library')}
              className={`flex-1 py-1 rounded-md font-medium transition-colors text-center cursor-pointer ${
                memeTab === 'library'
                  ? 'bg-white dark:bg-[#24221F] shadow-sm border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC]'
                  : 'text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
              }`}
            >
              Choose a Meme ({MEME_LIBRARY.length})
            </button>
            <button
              onClick={() => setMemeTab('custom')}
              className={`flex-1 py-1 rounded-md font-medium transition-colors text-center cursor-pointer ${
                memeTab === 'custom'
                  ? 'bg-white dark:bg-[#24221F] shadow-sm border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC]'
                  : 'text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
              }`}
            >
              Insert Your Own ({userUploadedClips.length})
            </button>
          </div>

          {/* Tab 1: Meme Library */}
          {memeTab === 'library' && (
            <div className="space-y-2">
              {/* Search Input */}
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-2 text-[#8E8A82] dark:text-[#78736B]" />
                <input
                  type="text"
                  value={memeSearch}
                  onChange={(e) => setMemeSearch(e.target.value)}
                  placeholder="Search memes (e.g. damn, rock, snoop)..."
                  className="w-full bg-[#F7F6F2] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] rounded-lg pl-7 pr-7 py-1 text-[11px] text-[#181715] dark:text-[#F4F2EC] placeholder-[#8E8A82] dark:placeholder-[#78736B] focus:outline-none focus:border-[#D96B27] dark:focus:border-[#E8632A]"
                />
                {memeSearch && (
                  <button
                    onClick={() => setMemeSearch('')}
                    className="absolute right-2 top-1.5 text-[#8E8A82] dark:text-[#78736B] hover:text-[#181715] dark:hover:text-[#F4F2EC] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Meme List */}
              <div className="max-h-[165px] overflow-y-auto space-y-1.5 pr-1">
                {filteredMemes.length === 0 ? (
                  <div className="text-[11px] text-[#8E8A82] dark:text-[#78736B] text-center py-4 italic">
                    No memes match &quot;{memeSearch}&quot;
                  </div>
                ) : (
                  filteredMemes.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#1E1D1B] hover:bg-[#F2EFEB] dark:hover:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] group transition-all"
                    >
                      <div className="flex items-center space-x-2 min-w-0 flex-1">
                        {/* Hover Video Preview */}
                        <div className="w-12 h-9 rounded bg-black overflow-hidden relative flex-shrink-0 border border-[#D8D4CC] dark:border-[#2C2A27]">
                          <video
                            src={m.url}
                            muted
                            loop
                            preload="metadata"
                            onMouseEnter={(e) => {
                              e.currentTarget.play().catch(() => {});
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.pause();
                              e.currentTarget.currentTime = 0;
                            }}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-0.5 right-0.5 bg-black/80 px-0.5 py-0.5 text-[7.5px] font-mono tabular-nums text-white rounded leading-none">
                            {(m.durationMs / 1000).toFixed(1)}s
                          </span>
                        </div>

                        <div className="min-w-0 flex-1 pr-1">
                          <div className="text-[11px] font-medium text-[#181715] dark:text-[#F4F2EC] truncate">
                            {m.title}
                          </div>
                          <div className="text-[9px] text-[#66625B] dark:text-[#A39E95] truncate">
                            {m.keywords.slice(0, 3).join(', ')}
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      {replacingMemeId ? (
                        <button
                          onClick={async () => {
                            await replaceMemeClip(replacingMemeId, {
                              id: m.id,
                              name: m.title,
                              url: m.url,
                              durationMs: m.durationMs,
                              isCustom: false
                            });
                            setReplacingMemeId(null);
                            addCommandLog({
                              id: `cmd_${Date.now()}`,
                              rawInput: `Replace meme with ${m.title}`,
                              timestamp: Date.now(),
                              parsedCommand: {
                                action: 'INSERT_LIBRARY_MEME',
                                payload: { memeId: m.id as any, atProjectMs: currentProjectMs },
                                explanation: `Replaced with ${m.title}`
                              },
                              status: 'SUCCESS',
                              appliedMessage: `Replaced with "${m.title}".`
                            });
                          }}
                          className="px-2 py-1 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white rounded text-[10px] font-semibold transition-colors flex-shrink-0 shadow-sm cursor-pointer"
                        >
                          Replace
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            await insertMemeAtProjectMs({
                              id: m.id,
                              name: m.title,
                              url: m.url,
                              durationMs: m.durationMs,
                              isCustom: false
                            }, currentProjectMs);
                            addCommandLog({
                              id: `cmd_${Date.now()}`,
                              rawInput: `Insert meme ${m.title}`,
                              timestamp: Date.now(),
                              parsedCommand: {
                                action: 'INSERT_LIBRARY_MEME',
                                payload: { memeId: m.id as any, atProjectMs: currentProjectMs },
                                explanation: `Inserted ${m.title}`
                              },
                              status: 'SUCCESS',
                              appliedMessage: `Inserted "${m.title}" at ${(currentProjectMs / 1000).toFixed(1)}s.`
                            });
                          }}
                          className="px-2 py-1 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white font-medium rounded text-[10px] flex items-center space-x-0.5 transition-colors flex-shrink-0 shadow-sm cursor-pointer"
                          title={`Insert at ${(currentProjectMs / 1000).toFixed(1)}s`}
                        >
                          <Plus className="w-2.5 h-2.5" />
                          <span>Insert</span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Custom User Clips */}
          {memeTab === 'custom' && (
            <div className="space-y-2">
              <div className="px-2 py-1.5 rounded-lg bg-[#F7F6F2] dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] text-[10px] text-[#66625B] dark:text-[#A39E95] flex items-center justify-between font-mono">
                <span>1. Upload MP4</span>
                <span className="text-[#8E8A82] dark:text-[#78736B]">→</span>
                <span>2. Move playhead</span>
                <span className="text-[#8E8A82] dark:text-[#78736B]">→</span>
                <span className="text-[#0F766E] dark:text-[#5EEAD4] font-semibold">3. Click Insert</span>
              </div>

              <label
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const droppedFile = e.dataTransfer.files?.[0];
                  if (droppedFile) processCustomMemeFile(droppedFile);
                }}
                className="border border-dashed border-[#E5E2DC] dark:border-[#2C2A27] hover:border-[#D96B27] dark:hover:border-[#E8632A] bg-[#FAF9F5] dark:bg-[#1E1D1B] hover:bg-white dark:hover:bg-[#24221F] rounded-lg py-2.5 px-3 flex items-center justify-center space-x-2 text-center cursor-pointer transition-colors group"
              >
                <Upload className="w-4 h-4 text-[#D96B27] dark:text-[#E8632A] group-hover:scale-110 transition-transform flex-shrink-0" />
                <div className="flex items-center space-x-1.5 text-xs min-w-0">
                  <span className="font-medium text-[#181715] dark:text-[#F4F2EC] truncate">Drop or browse .mp4, .webm, or .mov clip</span>
                  <span className="text-[10px] text-[#8E8A82] dark:text-[#78736B] flex-shrink-0">(Max 100 MB • 3 min)</span>
                </div>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={handleCustomMemeUpload}
                  className="hidden"
                />
              </label>

              {memeUploadError && (
                <div className="p-2 rounded-lg bg-[#FEF2F2] dark:bg-[#450A0A]/40 border border-[#FCA5A5] dark:border-[#991B1B] text-[#B91C1C] dark:text-[#FCA5A5] text-xs flex items-center justify-between space-x-1.5">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-[#EF4444]" />
                    <span className="leading-snug">{memeUploadError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMemeUploadError(null)}
                    className="text-[#B91C1C] dark:text-[#FCA5A5] hover:text-[#7F1D1D] p-0.5 flex-shrink-0 cursor-pointer"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div ref={customClipsListRef} className="max-h-[165px] overflow-y-auto space-y-1.5 pr-1">
                {userUploadedClips.length === 0 ? (
                  <div className="text-[10px] text-[#8E8A82] dark:text-[#78736B] italic text-center py-4 bg-[#F7F6F2] dark:bg-[#1E1D1B] rounded-lg border border-[#E5E2DC] dark:border-[#2C2A27] p-2">
                    No custom clips yet. Upload an .mp4 clip to insert it into your video!
                  </div>
                ) : (
                  userUploadedClips.map((clip) => (
                    <div
                      key={clip.id}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-[#FAF9F5] dark:bg-[#1E1D1B] hover:bg-[#F2EFEB] dark:hover:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] group transition-all"
                    >
                      <div className="flex items-center space-x-2 min-w-0 flex-1">
                        <div className="w-12 h-9 rounded bg-black overflow-hidden relative flex-shrink-0 border border-[#D8D4CC] dark:border-[#2C2A27]">
                          <video
                            src={clip.blobUrl}
                            muted
                            loop
                            preload="metadata"
                            onMouseEnter={(e) => {
                              e.currentTarget.play().catch(() => {});
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.pause();
                              e.currentTarget.currentTime = 0;
                            }}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-0.5 right-0.5 bg-black/80 px-0.5 py-0.5 text-[7.5px] font-mono tabular-nums text-white rounded leading-none">
                            {(clip.durationMs / 1000).toFixed(1)}s
                          </span>
                        </div>

                        <div className="min-w-0 flex-1 pr-1">
                          <div className="text-[11px] font-medium text-[#181715] dark:text-[#F4F2EC] truncate">
                            {clip.name}
                          </div>
                          <div className="text-[9px] text-[#66625B] dark:text-[#A39E95] font-mono tabular-nums">
                            {(clip.durationMs / 1000).toFixed(1)}s
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 flex-shrink-0">
                        {replacingMemeId ? (
                          <button
                            onClick={async () => {
                              await replaceMemeClip(replacingMemeId, {
                                id: clip.id,
                                name: clip.name,
                                url: clip.blobUrl,
                                durationMs: clip.durationMs,
                                isCustom: true
                              });
                              setReplacingMemeId(null);
                              addCommandLog({
                                id: `cmd_${Date.now()}`,
                                rawInput: `Replace meme with ${clip.name}`,
                                timestamp: Date.now(),
                                parsedCommand: {
                                  action: 'INSERT_USER_CLIP',
                                  payload: { clipId: clip.id, atProjectMs: currentProjectMs },
                                  explanation: `Replaced with custom clip ${clip.name}`
                                },
                                status: 'SUCCESS',
                                appliedMessage: `Replaced with custom clip "${clip.name}".`
                              });
                            }}
                            className="px-2 py-1 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white rounded text-[10px] font-semibold transition-colors shadow-sm cursor-pointer"
                          >
                            Replace
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={async () => {
                                await insertMemeAtProjectMs({
                                  id: clip.id,
                                  name: clip.name,
                                  url: clip.blobUrl,
                                  durationMs: clip.durationMs,
                                  isCustom: true
                                }, currentProjectMs);
                                addCommandLog({
                                  id: `cmd_${Date.now()}`,
                                  rawInput: `Insert custom clip ${clip.name}`,
                                  timestamp: Date.now(),
                                  parsedCommand: {
                                    action: 'INSERT_USER_CLIP',
                                    payload: { clipId: clip.id, atProjectMs: currentProjectMs },
                                    explanation: `Inserted ${clip.name}`
                                  },
                                  status: 'SUCCESS',
                                  appliedMessage: `Inserted "${clip.name}" at ${(currentProjectMs / 1000).toFixed(1)}s.`
                                });
                              }}
                              className="px-1.5 py-1 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white font-medium rounded text-[10px] flex items-center space-x-0.5 transition-colors shadow-sm cursor-pointer"
                              title={`Insert at ${(currentProjectMs / 1000).toFixed(1)}s (splits clip at playhead)`}
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>At Playhead</span>
                            </button>
                            <button
                              onClick={async () => {
                                await appendClipToEnd({
                                  id: clip.id,
                                  name: clip.name,
                                  url: clip.blobUrl,
                                  durationMs: clip.durationMs,
                                  isCustom: true
                                });
                              }}
                              className="px-1.5 py-1 bg-white dark:bg-[#24221F] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27] text-[#181715] dark:text-[#F4F2EC] border border-[#E5E2DC] dark:border-[#2C2A27] rounded text-[10px] font-medium transition-colors shadow-sm cursor-pointer"
                              title="Append to end of timeline"
                            >
                              <span>+ End</span>
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => removeUploadedMeme(clip.id)}
                          className="p-1 text-[#8E8A82] dark:text-[#78736B] hover:text-[#DC2626] dark:hover:text-[#F87171] transition-colors rounded hover:bg-[#F2EFEB] dark:hover:bg-[#24221F] cursor-pointer"
                          title="Delete custom clip"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  // Sub-render: AI Commands Section (used in mobile AI tab)
  const renderAiCommandsSection = () => (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col space-y-3 pt-2">
      {/* Quick Prompt Chips */}
      <div className="space-y-1.5 shrink-0">
        <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Quick Prompts</span>
        <div className="flex flex-wrap gap-1.5">
          {[
            'Remove silence',
            'Enhance voice',
            'Add fade transition',
            'Cut 0:10 to 0:15'
          ].map((chip) => (
            <button
              key={chip}
              onClick={() => setPromptInput(chip)}
              className="text-[11px] bg-[#F7F6F2] dark:bg-[#24221F] hover:bg-[#F2EFEB] dark:hover:bg-[#2E2B27] hover:text-[#181715] dark:hover:text-[#F4F2EC] text-[#66625B] dark:text-[#A39E95] px-2 py-1 rounded-md border border-[#E5E2DC] dark:border-[#2C2A27] transition-colors cursor-pointer"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Silence Detection Trigger Card */}
      <div className="p-2.5 rounded-xl bg-[#FFFBEB] dark:bg-[#78350F]/30 border border-[#FCD34D] dark:border-[#B45309] flex items-center justify-between shrink-0">
        <div>
          <span className="text-xs font-semibold text-[#92400E] dark:text-[#FDE68A] block">Awkward Pauses</span>
          <span className="text-[10px] text-[#B45309] dark:text-[#FCD34D]">Scans audio for speech gaps</span>
        </div>
        <button
          disabled={isDetectingSilences}
          onClick={handleDetectSilences}
          className="px-2.5 py-1 bg-[#D97706] hover:bg-[#B45309] text-white rounded-lg text-xs font-medium transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
        >
          {isDetectingSilences ? 'Scanning...' : 'Detect Silences'}
        </button>
      </div>

      {/* Execution Log */}
      <div className="flex-1 min-h-[130px] flex flex-col space-y-1.5 pt-1 border-t border-[#E5E2DC] dark:border-[#2C2A27]">
        <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider shrink-0">Execution Log</span>
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {commandLogs.length === 0 ? (
            <p className="text-[11px] text-[#8E8A82] dark:text-[#78736B] italic">No AI commands executed yet.</p>
          ) : (
            commandLogs.map((log) => {
              if (log.parsedCommand.action === 'ASSISTANT_ADVICE') {
                return (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg border text-[11px] space-y-1.5 shadow-sm bg-[#0F766E]/8 border-[#0F766E]/25 text-[#181715] dark:bg-[#14B8A6]/12 dark:border-[#2DD4BF]/30 dark:text-[#F4F2EC]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{log.rawInput}</span>
                      <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-[#0F766E]/15 text-[#0F766E] dark:bg-[#14B8A6]/20 dark:text-[#5EEAD4] flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" /> AI Assistant
                      </span>
                    </div>
                    <div className="text-[10px] leading-relaxed whitespace-pre-line break-words text-[#3F3C37] dark:text-[#D1CDC7]">
                      {log.appliedMessage}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={log.id}
                  className={`p-2 rounded-lg border text-[11px] space-y-1 shadow-sm ${
                    log.status === 'SUCCESS'
                      ? 'bg-[#F0FDFA] dark:bg-[#14B8A6]/15 border-[#99F6E4] dark:border-[#2DD4BF]/30 text-[#0F766E] dark:text-[#5EEAD4]'
                      : log.status === 'CLARIFICATION' || log.status === 'WARNING' || log.parsedCommand.action === 'UNSUPPORTED_OPERATION'
                      ? 'bg-[#FFFBEB] dark:bg-[#78350F]/30 border-[#FCD34D] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A]'
                      : 'bg-[#FEF2F2] dark:bg-[#450A0A]/40 border-[#FCA5A5] dark:border-[#991B1B] text-[#B91C1C] dark:text-[#FCA5A5]'
                  }`}
                >
                  <div className="font-semibold">{log.rawInput}</div>
                  <div className="text-[10px] opacity-80 whitespace-pre-line break-words">{log.appliedMessage}</div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Mobile-integrated AI Input */}
      <div className="shrink-0 pt-2 border-t border-[#E5E2DC] dark:border-[#2C2A27] safe-bottom">
        <div className="relative">
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendCommand()}
            placeholder='Try "Cut 0:05 to 0:10" or "Suggest BGM for a vlog"...'
            disabled={isAiProcessing}
            className="w-full bg-[#F7F6F2] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] rounded-lg pl-3 pr-9 py-2 text-xs text-[#181715] dark:text-[#F4F2EC] placeholder-[#8E8A82] dark:placeholder-[#78736B] focus:outline-none focus:border-[#D96B27] dark:focus:border-[#E8632A]"
          />
          <button
            onClick={handleSendCommand}
            disabled={isAiProcessing || !promptInput.trim()}
            className="absolute right-1.5 bottom-1.5 p-1.5 rounded-lg bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white disabled:opacity-40 transition-colors shadow-sm cursor-pointer"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );

  // Sub-render: Audio Section (used in mobile audio tab)
  const renderAudioSection = () => (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-3 text-xs">
      {/* Speaker Voice Enhancement Card */}
      <div className="p-3 rounded-xl bg-white dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className={`w-4 h-4 ${voiceEnhanceEnabled ? 'text-[#0F766E] dark:text-[#5EEAD4]' : 'text-[#8E8A82] dark:text-[#78736B]'}`} />
            <span className="font-semibold text-[#181715] dark:text-[#F4F2EC]">Speaker Voice Enhancement</span>
          </div>
          <button
            onClick={handleToggleVoiceEnhance}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
              voiceEnhanceEnabled
                ? 'bg-[#F0FDFA] dark:bg-[#14B8A6]/15 border-[#0D9488] dark:border-[#2DD4BF]/40 text-[#0F766E] dark:text-[#5EEAD4]'
                : 'bg-white dark:bg-[#24221F] border-[#E5E2DC] dark:border-[#2C2A27] text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
            }`}
          >
            {voiceEnhanceEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <p className="text-[11px] text-[#66625B] dark:text-[#A39E95]">
          100Hz HPF + 320Hz room-echo cut + 3.2kHz vocal clarity boost + anti-hiss shelf + light leveling.
        </p>
      </div>

      {/* Reduce Low Hum (Basic) Card */}
      <div className="p-3 rounded-xl bg-white dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Wand2 className={`w-4 h-4 ${noiseRemovalEnabled ? 'text-[#0F766E] dark:text-[#5EEAD4]' : 'text-[#8E8A82] dark:text-[#78736B]'}`} />
            <span className="font-semibold text-[#181715] dark:text-[#F4F2EC]">Reduce Low Hum (Basic)</span>
          </div>
          <button
            onClick={handleToggleNoiseRemoval}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
              noiseRemovalEnabled
                ? 'bg-[#F0FDFA] dark:bg-[#14B8A6]/15 border-[#0D9488] dark:border-[#2DD4BF]/40 text-[#0F766E] dark:text-[#5EEAD4]'
                : 'bg-white dark:bg-[#24221F] border-[#E5E2DC] dark:border-[#2C2A27] text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
            }`}
          >
            {noiseRemovalEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <p className="text-[11px] text-[#66625B] dark:text-[#A39E95]">
          Cascaded 180Hz HPF, 250Hz motor cut, 6.2kHz lowpass & adaptive noise gate for steady background hum.
        </p>
      </div>

      {/* Background Music Card */}
      <div className="p-3 rounded-xl bg-white dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Music className="w-4 h-4 text-[#0F766E] dark:text-[#5EEAD4]" />
            <span className="font-semibold text-[#181715] dark:text-[#F4F2EC]">Background Music</span>
          </div>
          {bgMusic && (
            <button
              onClick={() => removeBgMusic()}
              className="p-1 text-[#8E8A82] dark:text-[#78736B] hover:text-[#DC2626] dark:hover:text-[#F87171] transition-colors cursor-pointer"
              title="Remove track"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {bgMusic ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-[#181715] dark:text-[#F4F2EC] truncate" title={bgMusic.name}>
                {bgMusic.name}
              </span>
              <span className="text-[#66625B] dark:text-[#A39E95] font-mono shrink-0">
                ({(bgMusic.durationMs / 1000).toFixed(1)}s loop)
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => toggleBgMusicMute()}
                className="text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] p-1 cursor-pointer"
                title={bgMusic.isMuted || bgMusic.volume === 0 ? "Unmute" : "Mute"}
              >
                {bgMusic.isMuted || bgMusic.volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-[#DC2626]" />
                ) : (
                  <Volume2 className="w-4 h-4 text-[#0F766E] dark:text-[#5EEAD4]" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={bgMusic.isMuted ? 0 : bgMusic.volume}
                onChange={(e) => setBgMusicVolume(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-[#E5E2DC] dark:bg-[#2C2A27] accent-[#0F766E] rounded-lg cursor-pointer"
              />
              <span className="text-[11px] font-mono tabular-nums text-[#66625B] dark:text-[#A39E95] w-8 text-right">
                {bgMusic.isMuted ? '0%' : `${Math.round(bgMusic.volume * 100)}%`}
              </span>
            </div>

            <button
              onClick={() => bgMusicInputRef.current?.click()}
              className="w-full py-1.5 bg-[#F7F6F2] dark:bg-[#24221F] hover:bg-[#F2EFEB] dark:hover:bg-[#2E2B27] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC] rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              Replace Track (.mp3, .wav, .m4a)
            </button>
          </div>
        ) : (
          <button
            onClick={() => bgMusicInputRef.current?.click()}
            className="w-full py-3 border border-dashed border-[#E5E2DC] dark:border-[#2C2A27] hover:border-[#0F766E] bg-[#FAF9F5] dark:bg-[#1E1D1B] hover:bg-[#F0FDFA] dark:hover:bg-[#14B8A6]/10 rounded-xl flex items-center justify-center space-x-2 text-xs text-[#66625B] dark:text-[#A39E95] hover:text-[#0F766E] dark:hover:text-[#5EEAD4] transition-all group cursor-pointer"
          >
            <Music className="w-4 h-4 text-[#8E8A82] dark:text-[#78736B] group-hover:text-[#0F766E] dark:group-hover:text-[#5EEAD4] transition-colors" />
            <span>+ Add Background Music track (up to 30 MB)</span>
          </button>
        )}
      </div>

      {/* Playback Preview Speed Card */}
      <div className="p-3 rounded-xl bg-white dark:bg-[#1E1D1B] border border-[#E5E2DC] dark:border-[#2C2A27] shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#181715] dark:text-[#F4F2EC]">Preview Speed</span>
          <div className="flex items-center space-x-1.5">
            {([1, 2, 5] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPreviewSpeed(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors cursor-pointer ${
                  previewSpeed === s
                    ? 'bg-[#0F766E] text-white shadow-xs'
                    : 'bg-[#F7F6F2] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-[#8E8A82] dark:text-[#78736B]">
          Preview speed only — export keeps 1x speed
        </p>
      </div>
    </div>
  );

  return (
    <div className="h-[100dvh] w-full bg-[#F7F6F2] dark:bg-[#0E0E0D] text-[#181715] dark:text-[#F4F2EC] flex flex-col overflow-hidden select-none">
      {/* Top Header */}
      <header className="h-12 md:h-14 border-b border-[#E5E2DC] dark:border-[#2C2A27] bg-white dark:bg-[#171615] px-2.5 sm:px-3 md:px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center space-x-2.5 md:space-x-3 min-w-0">
          <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-[#D96B27] dark:bg-[#E8632A] text-white flex items-center justify-center font-bold text-xs md:text-sm shrink-0 shadow-sm">
            <Scissors className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs md:text-sm font-semibold tracking-wide text-[#181715] dark:text-[#F4F2EC] truncate max-w-[150px] sm:max-w-[240px] md:max-w-none">{project.title}</h2>
            <div className="flex items-center space-x-2 text-[10px] md:text-[11px] text-[#66625B] dark:text-[#A39E95] tabular-nums font-mono">
              <span>{curProjSec}s / {totalProjSec}s</span>
            </div>
          </div>
        </div>

        {/* Desktop Audio Filter Controls & Export */}
        <div className="hidden md:flex items-center space-x-2">
          {/* Tablet Quick Sidebar Toggles (768px - 1023px) */}
          <div className="hidden md:flex lg:hidden items-center space-x-1.5 mr-2">
            <button
              onClick={() => setIsLeftOpen(!isLeftOpen)}
              className={`px-2 py-1 rounded-md text-xs font-medium border flex items-center space-x-1 transition-colors ${
                isLeftOpen ? 'bg-[#F2EFEB] dark:bg-[#24221F] text-[#181715] dark:text-[#F4F2EC] border-[#D8D4CC] dark:border-[#383531]' : 'bg-white dark:bg-[#1E1D1B] text-[#66625B] dark:text-[#A39E95] border-[#E5E2DC] dark:border-[#2C2A27]'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-[#D96B27] dark:text-[#E8632A]" />
              <span>Transcript</span>
            </button>
            <button
              onClick={() => setIsRightOpen(!isRightOpen)}
              className={`px-2 py-1 rounded-md text-xs font-medium border flex items-center space-x-1 transition-colors ${
                isRightOpen ? 'bg-[#F2EFEB] dark:bg-[#24221F] text-[#181715] dark:text-[#F4F2EC] border-[#D8D4CC] dark:border-[#383531]' : 'bg-white dark:bg-[#1E1D1B] text-[#66625B] dark:text-[#A39E95] border-[#E5E2DC] dark:border-[#2C2A27]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#D96B27] dark:text-[#E8632A]" />
              <span>AI & Memes</span>
            </button>
          </div>

          {/* Speaker Voice Enhancement Toggle */}
          <button
            onClick={handleToggleVoiceEnhance}
            title="Speaker Voice Enhancement: 100Hz HPF + 320Hz room-echo cut + 3.2kHz vocal clarity boost + anti-hiss shelf + light leveling"
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1.5 border transition-all cursor-pointer ${
              voiceEnhanceEnabled
                ? 'bg-[#F0FDFA] dark:bg-[#14B8A6]/15 border-[#0D9488] dark:border-[#2DD4BF]/40 text-[#0F766E] dark:text-[#5EEAD4]'
                : 'bg-white dark:bg-[#1E1D1B] border-[#E5E2DC] dark:border-[#2C2A27] text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] hover:bg-[#F7F6F2] dark:hover:bg-[#262421]'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${voiceEnhanceEnabled ? 'text-[#0F766E] dark:text-[#5EEAD4]' : 'text-[#8E8A82] dark:text-[#78736B]'}`} />
            <span>Voice Enhance</span>
            <span className={`text-[10px] px-1 py-0.5 rounded font-mono tabular-nums font-bold ${voiceEnhanceEnabled ? 'bg-[#CCFBF1] dark:bg-[#14B8A6]/25 text-[#0F766E] dark:text-[#5EEAD4]' : 'bg-[#F2EFEB] dark:bg-[#24221F] text-[#8E8A82] dark:text-[#78736B]'}`}>
              {voiceEnhanceEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Reduce Low Hum (Basic) Toggle */}
          <button
            onClick={handleToggleNoiseRemoval}
            title="Reduce Low Hum (Basic): Cascaded 180Hz HPF, 250Hz motor cut, 6.2kHz lowpass & adaptive noise gate"
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1.5 border transition-all cursor-pointer ${
              noiseRemovalEnabled
                ? 'bg-[#F0FDFA] dark:bg-[#14B8A6]/15 border-[#0D9488] dark:border-[#2DD4BF]/40 text-[#0F766E] dark:text-[#5EEAD4]'
                : 'bg-white dark:bg-[#1E1D1B] border-[#E5E2DC] dark:border-[#2C2A27] text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] hover:bg-[#F7F6F2] dark:hover:bg-[#262421]'
            }`}
          >
            <Wand2 className={`w-3.5 h-3.5 ${noiseRemovalEnabled ? 'text-[#0F766E] dark:text-[#5EEAD4]' : 'text-[#8E8A82] dark:text-[#78736B]'}`} />
            <span>Reduce Low Hum (Basic)</span>
            <span className={`text-[10px] px-1 py-0.5 rounded font-mono tabular-nums font-bold ${noiseRemovalEnabled ? 'bg-[#CCFBF1] dark:bg-[#14B8A6]/25 text-[#0F766E] dark:text-[#5EEAD4]' : 'bg-[#F2EFEB] dark:bg-[#24221F] text-[#8E8A82] dark:text-[#78736B]'}`}>
              {noiseRemovalEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          <div className="h-4 w-[1px] bg-[#E5E2DC] dark:bg-[#2C2A27] mx-1" />

          <ThemeToggle compact />

          <button
            onClick={() => setScreen('EXPORT')}
            className="flex items-center space-x-1.5 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white font-medium px-4 py-1.5 rounded-lg text-xs transition-colors shadow-sm active:scale-95 cursor-pointer"
          >
            <span>Export Video</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Mobile Top Controls: Theme Toggle & Export Button */}
        <div className="flex md:hidden items-center space-x-2">
          <ThemeToggle compact />
          <button
            onClick={() => setScreen('EXPORT')}
            className="flex items-center space-x-1 bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white font-medium px-3 py-1 rounded-md text-xs transition-colors shadow-sm active:scale-95 cursor-pointer"
          >
            <span>Export</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden relative">
        {/* Left Collapsible Panel: Transcript (Desktop) */}
        <div
          className={`hidden md:flex flex-col border-r border-[#E5E2DC] dark:border-[#2C2A27] bg-white dark:bg-[#171615] transition-all duration-200 z-10 ${
            isLeftOpen ? 'w-72 lg:w-80' : 'w-10'
          }`}
        >
          <div className="h-10 shrink-0 border-b border-[#E5E2DC] dark:border-[#2C2A27] flex items-center justify-between px-3">
            {isLeftOpen ? (
              <span className="text-xs font-semibold text-[#181715] dark:text-[#F4F2EC] tracking-wide">
                Transcript
              </span>
            ) : null}
            <button
              onClick={() => setIsLeftOpen(!isLeftOpen)}
              className="text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] p-1 cursor-pointer"
            >
              {isLeftOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>

          {isLeftOpen ? (
            renderTranscriptSection()
          ) : (
            <button
              onClick={() => setIsLeftOpen(true)}
              className="flex-1 flex flex-col items-center justify-start pt-6 gap-2 text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] hover:bg-[#F7F6F2] dark:hover:bg-[#1E1D1B] transition cursor-pointer select-none"
              title="Open Transcript panel"
            >
              <FileText className="w-4 h-4 text-[#D96B27] dark:text-[#E8632A]" />
              <span className="text-[11px] font-semibold [writing-mode:vertical-lr] tracking-wider uppercase">
                Transcript
              </span>
            </button>
          )}
        </div>

        {/* Center: Dual-Video Preview Player (Desktop & Mobile) */}
        <div className="flex flex-col md:flex-1 items-center justify-start md:justify-center p-1 sm:p-2 md:p-4 bg-[#F7F6F2] dark:bg-[#0E0E0D] overflow-y-auto md:overflow-hidden shrink-0 md:shrink w-full">
          {/* Inline Workspace Error Banner */}
          {workspaceBannerError && (
            <div className="w-full max-w-3xl mb-2 px-3 py-2 rounded-xl bg-[#FEF2F2] dark:bg-[#450A0A]/40 border border-[#FCA5A5] dark:border-[#991B1B] text-[#991B1B] dark:text-[#FCA5A5] text-xs flex items-center justify-between gap-2 shadow-sm animate-in fade-in">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#EF4444]" />
                <span className="truncate">{workspaceBannerError}</span>
              </div>
              <button
                type="button"
                onClick={() => setWorkspaceBannerError(null)}
                className="text-[#991B1B] dark:text-[#FCA5A5] hover:text-[#7F1D1D] p-0.5 rounded transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Silence Alert Banner if pauses present */}
          {project.items.some(it => it.status === 'SUGGESTED_SILENCE_CUT') && (() => {
            const silenceItems = project.items.filter(it => it.status === 'SUGGESTED_SILENCE_CUT');
            const totalSilences = silenceItems.length;
            const selectedSilences = silenceItems.filter(it => it.meta?.silenceSelected !== false).length;

            return (
              <div className="w-full max-w-3xl mb-2 bg-[#FFFBEB] dark:bg-[#78350F]/30 border border-[#FCD34D] dark:border-[#B45309] rounded-xl px-3.5 py-2 flex flex-wrap sm:flex-nowrap items-center justify-between text-xs gap-2 shadow-sm">
                <div className="flex items-center space-x-2 text-[#92400E] dark:text-[#FDE68A] min-w-0">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0 text-[#D97706] dark:text-[#FBBF24]" />
                  <span className="truncate sm:whitespace-normal">
                    <strong>Awkward Pauses Detected:</strong> Review amber intervals on timeline or click to clean up:
                  </span>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0 ml-auto">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearAllSilences();
                    }}
                    className="bg-white dark:bg-[#1E1D1B] hover:bg-[#F7F6F2] dark:hover:bg-[#262421] text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] border border-[#E5E2DC] dark:border-[#2C2A27] px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  >
                    Cancel / Clear
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      applySelectedSilenceCuts();
                    }}
                    disabled={selectedSilences === 0}
                    className="bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-3 py-1 rounded-lg text-xs transition-colors shadow-sm cursor-pointer"
                  >
                    Apply Cuts ({selectedSilences}/{totalSilences})
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Dual-Video Canvas Frame */}
          <div className="relative w-full max-w-3xl h-[23dvh] sm:h-[25dvh] min-h-[140px] max-h-[200px] md:h-auto md:aspect-video bg-[#0B0B0A] dark:bg-[#070706] rounded-xl overflow-hidden border border-[#D8D4CC] dark:border-[#2E2C28] flex items-center justify-center shadow-sm">
            {/* Playhead-driven Frame-accurate Transition Stage (Spec 1) */}
            <div
              ref={transitionStageRef}
              className="w-full h-full absolute inset-0 overflow-hidden flex items-center justify-center will-change-transform"
              style={{ opacity: 1, clipPath: 'none', transform: 'none' }}
            >
              {/* Main Video Element */}
              <video
                ref={mainVideoRef}
                src={project.sourceVideoUrl}
                playsInline
                className={`w-full h-full object-contain absolute inset-0 transition-opacity duration-75 ${
                  activeMemePlaying
                    ? 'opacity-0 pointer-events-none z-0'
                    : 'opacity-100 z-10'
                }`}
              />

              {/* Stacked Meme Video Element (Spec 3) */}
              <video
                ref={memeVideoRef}
                playsInline
                onLoadedData={handleSecondaryReady}
                onSeeked={handleSecondaryReady}
                onCanPlay={handleSecondaryReady}
                className={`w-full h-full object-contain absolute inset-0 transition-opacity duration-75 ${
                  activeMemePlaying && isSecondaryReady
                    ? 'opacity-100 z-10'
                    : 'opacity-0 pointer-events-none z-0'
                }`}
              />

              {/* Background Music Audio Element (Looping, Live Synced) */}
              <audio
                ref={bgMusicRef}
                src={bgMusic?.blobUrl || undefined}
                loop
                preload="auto"
                className="hidden"
              />
            </div>

            {/* Click to play overlay */}
            <div
              onClick={togglePlayPause}
              className="absolute inset-0 cursor-pointer flex items-center justify-center group z-30"
            >
              {!isPlaying && (
                <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-[#D96B27] dark:bg-[#E8632A] text-white flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-all">
                  <Play className="w-7 h-7 md:w-8 md:h-8 fill-white translate-x-0.5" />
                </div>
              )}
            </div>
          </div>

          {/* Player Controls Bar */}
          <div className="w-full max-w-3xl flex items-center justify-between mt-1 md:mt-3 px-1 md:px-2">
            <div className="flex items-center space-x-2 md:space-x-3">
              <button
                onClick={togglePlayPause}
                className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-lg bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white flex items-center justify-center shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white translate-x-0.5" />}
              </button>

              <button
                onClick={() => handleSeek(0)}
                className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] transition-colors cursor-pointer"
                title="Restart"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <div className="text-[11px] md:text-xs font-mono tabular-nums text-[#181715] dark:text-[#F4F2EC]">
                <span className="font-bold text-[#181715] dark:text-[#F4F2EC]">{curProjSec}s</span>
                <span className="text-[#8E8A82] dark:text-[#78736B]"> / </span>
                <span className="text-[#66625B] dark:text-[#A39E95]">{totalProjSec}s</span>
              </div>
            </div>

            {/* Editing quick tools */}
            <div className="flex items-center space-x-1.5 md:space-x-2">
              <button
                onClick={splitAtPlayhead}
                className="px-2.5 py-1.5 min-h-[36px] bg-white dark:bg-[#1E1D1B] hover:bg-[#F7F6F2] dark:hover:bg-[#262421] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC] rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors shadow-sm cursor-pointer"
                title="Split at playhead position (S)"
              >
                <Scissors className="w-3.5 h-3.5 text-[#D96B27] dark:text-[#E8632A]" />
                <span className="hidden sm:inline">Split (S)</span>
                <span className="sm:hidden">Split</span>
              </button>

              <button
                onClick={deleteSelected}
                disabled={!selectedItemId}
                className="px-2.5 py-1.5 min-h-[36px] bg-[#FEF2F2] dark:bg-[#450A0A]/40 hover:bg-[#FEE2E2] dark:hover:bg-[#5E0F0F]/50 border border-[#FCA5A5] dark:border-[#991B1B] text-[#DC2626] dark:text-[#FCA5A5] rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm cursor-pointer"
                title="Delete selected clip"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </button>

              <div className="h-4 w-[1px] bg-[#E5E2DC] dark:bg-[#2C2A27] mx-0.5 md:mx-1" />

              <button
                onClick={undo}
                disabled={undoStack.length === 0}
                className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] disabled:opacity-30 transition-colors cursor-pointer"
                title="Undo"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={redo}
                disabled={redoStack.length === 0}
                className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] disabled:opacity-30 transition-colors cursor-pointer"
                title="Redo"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Collapsible Panel: AI Command Hub (Desktop) */}
        <div
          className={`hidden md:flex flex-col border-l border-[#E5E2DC] dark:border-[#2C2A27] bg-white dark:bg-[#171615] h-full min-h-0 overflow-hidden transition-all duration-200 z-10 ${
            isRightOpen ? 'w-72 lg:w-80' : 'w-10'
          }`}
        >
          <div className="h-10 shrink-0 border-b border-[#E5E2DC] dark:border-[#2C2A27] flex items-center justify-between px-3">
            <button
              onClick={() => setIsRightOpen(!isRightOpen)}
              className="text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] p-1 cursor-pointer"
            >
              {isRightOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            {isRightOpen && (
              <span className="text-xs font-semibold text-[#181715] dark:text-[#F4F2EC] flex items-center space-x-1">
                <Sparkles className="w-3.5 h-3.5 text-[#D96B27] dark:text-[#E8632A]" />
                <span>AI Command Hub</span>
              </span>
            )}
          </div>

          {isRightOpen ? (
            <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
              {/* Scrollable Middle Body */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-3 py-2 flex flex-col">
                {/* Quick Prompt Chips */}
                <div className="space-y-1.5 shrink-0">
                  <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider">Quick Prompts</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Remove silence',
                      'Enhance voice',
                      'Add fade transition',
                      'Cut 0:10 to 0:15'
                    ].map((chip) => (
                      <button
                        key={chip}
                        onClick={() => setPromptInput(chip)}
                        className="text-[11px] bg-[#F7F6F2] dark:bg-[#24221F] hover:bg-[#F2EFEB] dark:hover:bg-[#2E2B27] hover:text-[#181715] dark:hover:text-[#F4F2EC] text-[#66625B] dark:text-[#A39E95] px-2 py-1 rounded-md border border-[#E5E2DC] dark:border-[#2C2A27] transition-colors cursor-pointer"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Meme Reactions Section (strictly bounded so it never pushes log away) */}
                <div className="shrink-0 max-h-[145px] overflow-y-auto">
                  {renderMemesSection()}
                </div>

                {/* Command Execution Log */}
                <div className="flex-1 min-h-[115px] flex flex-col space-y-1.5 pt-1 border-t border-[#E5E2DC] dark:border-[#2C2A27] bg-[#FAF9F6] dark:bg-[#1E1D1B] px-3 py-2 rounded-lg">
                  <span className="text-[10px] uppercase font-bold text-[#66625B] dark:text-[#A39E95] tracking-wider shrink-0">Execution Log</span>
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                    {commandLogs.length === 0 ? (
                      <p className="text-[11px] text-[#8E8A82] dark:text-[#78736B] italic">Commands and cut confirmations appear here.</p>
                    ) : (
                      commandLogs.map((log) => {
                        if (log.parsedCommand.action === 'ASSISTANT_ADVICE') {
                          return (
                            <div
                              key={log.id}
                              className="p-2.5 rounded-lg border text-[11px] space-y-1.5 shadow-sm bg-[#0F766E]/8 border-[#0F766E]/25 text-[#181715] dark:bg-[#14B8A6]/12 dark:border-[#2DD4BF]/30 dark:text-[#F4F2EC]"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold">{log.rawInput}</span>
                                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-[#0F766E]/15 text-[#0F766E] dark:bg-[#14B8A6]/20 dark:text-[#5EEAD4] flex items-center gap-1">
                                  <Sparkles className="w-2.5 h-2.5" /> AI Assistant
                                </span>
                              </div>
                              <div className="text-[10px] leading-relaxed whitespace-pre-line break-words text-[#3F3C37] dark:text-[#D1CDC7]">
                                {log.appliedMessage}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={log.id}
                            className={`p-2 rounded-lg border text-[11px] space-y-1 shadow-sm ${
                              log.status === 'SUCCESS'
                                ? 'bg-[#F0FDFA] dark:bg-[#14B8A6]/15 border-[#99F6E4] dark:border-[#2DD4BF]/30 text-[#0F766E] dark:text-[#5EEAD4]'
                                : log.status === 'CLARIFICATION' || log.status === 'WARNING' || log.parsedCommand.action === 'UNSUPPORTED_OPERATION'
                                ? 'bg-[#FFFBEB] dark:bg-[#78350F]/30 border-[#FCD34D] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A]'
                                : 'bg-[#FEF2F2] dark:bg-[#450A0A]/40 border-[#FCA5A5] dark:border-[#991B1B] text-[#B91C1C] dark:text-[#FCA5A5]'
                            }`}
                          >
                            <div className="font-semibold">{log.rawInput}</div>
                            <div className="text-[10px] opacity-80 whitespace-pre-line break-words">{log.appliedMessage}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Permanently Pinned AI Command Input Bar (Footer) */}
              <div className="shrink-0 border-t border-[#E5E2DC] dark:border-[#2C2A27] bg-white dark:bg-[#171615] p-2.5">
                <div className="relative">
                  <input
                    type="text"
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCommand()}
                    placeholder='Try "Cut 0:05 to 0:10" or "Suggest BGM for a vlog"...'
                    disabled={isAiProcessing}
                    className="w-full bg-[#F7F6F2] dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] rounded-lg pl-3 pr-9 py-2 text-xs text-[#181715] dark:text-[#F4F2EC] placeholder-[#8E8A82] dark:placeholder-[#78736B] focus:outline-none focus:border-[#D96B27] dark:focus:border-[#E8632A]"
                  />
                  <button
                    onClick={handleSendCommand}
                    disabled={isAiProcessing || !promptInput.trim()}
                    className="absolute right-1.5 bottom-1.5 p-1.5 rounded-lg bg-[#D96B27] dark:bg-[#E8632A] hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] text-white disabled:opacity-40 transition-colors shadow-sm cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsRightOpen(true)}
              className="flex-1 flex flex-col items-center justify-start pt-6 gap-2 text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] hover:bg-[#F7F6F2] dark:hover:bg-[#1E1D1B] transition cursor-pointer select-none"
              title="Open AI & Memes panel"
            >
              <Sparkles className="w-4 h-4 text-[#D96B27] dark:text-[#E8632A]" />
              <span className="text-[11px] font-semibold [writing-mode:vertical-lr] tracking-wider uppercase">
                AI & Memes
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Timeline Section (Spec 1 & Spec 2) */}
      <footer className="min-h-[168px] sm:h-[185px] md:h-52 border-t border-[#E5E2DC] dark:border-[#2C2A27] bg-white dark:bg-[#171615] flex flex-col p-1.5 md:p-3 z-20 shrink-0 mt-1 md:mt-0">
        {/* Timeline Toolbar */}
        <div className="flex flex-wrap items-center justify-between pb-1 md:pb-2 text-xs gap-1 md:gap-2">
          <div className="flex items-center space-x-2 md:space-x-3 overflow-x-auto no-scrollbar">
            {/* Playback Speed Controls */}
            <div className="flex items-center space-x-1 md:space-x-1.5">
              <span className="text-[#66625B] dark:text-[#A39E95] text-[11px] font-medium hidden sm:inline">Speed:</span>
              {([1, 2, 5] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPreviewSpeed(s)}
                  className={`px-1.5 md:px-2 py-0.5 rounded text-[11px] font-mono tabular-nums font-medium transition-colors cursor-pointer ${
                    previewSpeed === s
                      ? 'bg-[#0F766E] text-white shadow-sm'
                      : 'bg-white dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#66625B] dark:text-[#A39E95] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27]'
                  }`}
                >
                  {s}x
                </button>
              ))}
              <span className="text-[10px] text-[#8E8A82] dark:text-[#78736B] hidden lg:inline">Preview speed only. Export keeps normal speed.</span>
            </div>

            {/* Timeline Zoom Controls */}
            <div className="flex items-center space-x-1 md:space-x-1.5 pl-2 md:pl-3 border-l border-[#E5E2DC] dark:border-[#2C2A27]">
              <span className="text-[#66625B] dark:text-[#A39E95] text-[11px] font-medium hidden sm:inline">Zoom:</span>
              <button
                onClick={zoomOut}
                disabled={timelineZoom <= 1}
                className="w-5 h-5 flex items-center justify-center rounded bg-white dark:bg-[#24221F] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC] text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Zoom Out Timeline (-)"
              >
                -
              </button>
              <span className="text-[11px] font-mono tabular-nums text-[#181715] dark:text-[#F4F2EC] w-6 md:w-7 text-center">{timelineZoom}x</span>
              <button
                onClick={zoomIn}
                disabled={timelineZoom >= 5}
                className="w-5 h-5 flex items-center justify-center rounded bg-white dark:bg-[#24221F] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27] border border-[#E5E2DC] dark:border-[#2C2A27] text-[#181715] dark:text-[#F4F2EC] text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Zoom In Timeline (+)"
              >
                +
              </button>
            </div>

            {/* Silence Detection Button */}
            <div className="hidden sm:flex items-center space-x-1.5 pl-2 md:pl-3 border-l border-[#E5E2DC] dark:border-[#2C2A27]">
              <button
                disabled={isDetectingSilences}
                onClick={handleDetectSilences}
                className="px-2 py-0.5 bg-[#FFFBEB] dark:bg-[#78350F]/30 hover:bg-[#FEF3C7] dark:hover:bg-[#78350F]/50 border border-[#FCD34D] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A] rounded text-[11px] font-medium transition-colors flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer"
                title="Scans audio for awkward silences"
              >
                <span>{isDetectingSilences ? 'Detecting...' : 'Detect Silences'}</span>
              </button>
            </div>

            {/* Add Clip & Add Music buttons */}
            <div className="flex items-center space-x-1 md:space-x-1.5 pl-2 md:pl-3 border-l border-[#E5E2DC] dark:border-[#2C2A27]">
              <button
                onClick={() => addClipInputRef.current?.click()}
                className="px-2 py-0.5 bg-white dark:bg-[#24221F] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27] text-[#181715] dark:text-[#F4F2EC] border border-[#E5E2DC] dark:border-[#2C2A27] rounded text-[11px] font-medium transition-colors flex items-center space-x-1 shadow-sm cursor-pointer"
                title="Add an extra video clip to the end of the timeline (up to 3 min / 100 MB)"
              >
                <Plus className="w-3 h-3 text-[#D96B27] dark:text-[#E8632A]" />
                <span className="hidden sm:inline">Add Clip</span>
                <span className="sm:hidden">Clip</span>
              </button>
              <input
                ref={addClipInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={handleAddClipFileInput}
                className="hidden"
              />
              <button
                onClick={() => bgMusicInputRef.current?.click()}
                className="px-2 py-0.5 bg-white dark:bg-[#24221F] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27] text-[#0F766E] dark:text-[#5EEAD4] border border-[#E5E2DC] dark:border-[#2C2A27] rounded text-[11px] font-medium transition-colors flex items-center space-x-1 shadow-sm cursor-pointer"
                title="Add background music track (.mp3, .wav, .m4a, .aac, .ogg up to 30 MB)"
              >
                <Music className="w-3 h-3 text-[#0F766E] dark:text-[#5EEAD4]" />
                <span className="hidden sm:inline">+ Add Music</span>
                <span className="sm:hidden">+ Music</span>
              </button>
              <input
                ref={bgMusicInputRef}
                type="file"
                accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/m4a,audio/x-m4a,audio/aac,audio/ogg"
                onChange={handleBgMusicFileInput}
                className="hidden"
              />
            </div>

            {/* Thumbnail Generation Progress */}
            {thumbnailProgress && !thumbnailProgress.done && (
              <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-[#F0FDFA] dark:bg-[#14B8A6]/15 border border-[#99F6E4] dark:border-[#2DD4BF]/40 text-[#0F766E] dark:text-[#5EEAD4] text-[10px] animate-pulse">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0F766E] dark:bg-[#5EEAD4] animate-ping" />
                <span>Generating frames {thumbnailProgress.current}/{thumbnailProgress.total}</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="hidden lg:flex items-center space-x-4 text-[11px] text-[#66625B] dark:text-[#A39E95]">
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#3A3833] dark:bg-[#2A2825] border border-[#45423C] dark:border-[#383531] inline-block" />
              <span>Active Clip</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B] inline-block" />
              <span>Awkward Silence</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#FB7185] inline-block" />
              <span>Meme Insert</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#0F766E] dark:bg-[#5EEAD4] inline-block" />
              <span>Music</span>
            </div>
          </div>
        </div>

        {/* Timeline Track Area (Horizontally Scrollable) */}
        <div
          ref={timelineContainerRef}
          className="flex-1 min-h-[125px] bg-[#F7F6F2] dark:bg-[#141312] rounded-xl border border-[#E5E2DC] dark:border-[#2C2A27] relative overflow-x-auto overflow-y-visible md:overflow-y-hidden p-1.5 md:p-2"
        >
          {/* Inner scalable track container */}
          <div
            ref={trackContainerRef}
            style={{ width: `${timelineZoom * 100}%`, minWidth: '100%', touchAction: isPrecisionScrubbing ? 'none' : 'pan-x' }}
            onPointerDown={handleTrackPointerDown}
            onPointerMove={handleTrackPointerMove}
            onPointerUp={handleTrackPointerUp}
            onPointerCancel={handleTrackPointerCancel}
            onMouseLeave={handleTrackMouseLeave}
            className="relative h-full flex flex-col justify-between cursor-pointer select-none pt-0 pb-1"
          >
            {/* Floating Scrub / Hover Time Readout */}
            {(isScrubbing || hoverPct !== null) && !isPrecisionScrubbing && (
              <div
                style={{
                  left: `${isScrubbing ? (project.totalProjectDurationMs > 0 ? (currentProjectMs / project.totalProjectDurationMs) * 100 : 0) : (hoverPct ?? 0)}%`
                }}
                className="absolute top-0 transform -translate-x-1/2 z-40 pointer-events-none flex flex-col items-center"
              >
                <div className="bg-[#181715] dark:bg-[#070706] border border-[#D96B27] dark:border-[#E8632A] text-white font-mono tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap">
                  {formatReadout(isScrubbing ? currentProjectMs : (hoverTimeMs ?? currentProjectMs))}
                </div>
                <div className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-[#D96B27] dark:border-t-[#E8632A]" />
              </div>
            )}

            {/* Dedicated Time Ruler Row (h-6) */}
            <div className="w-full h-6 border-b border-[#E5E2DC] dark:border-[#2C2A27] relative font-mono tabular-nums text-[9px] text-[#8E8A82] dark:text-[#78736B] select-none pointer-events-none shrink-0 mb-1">
              {/* Minor Ticks */}
              {Array.from({ length: minorTickCount + 1 }).map((_, i) => {
                const tickSec = i * rulerMinorStepSec;
                const tickMs = tickSec * 1000;
                if (tickMs > project.totalProjectDurationMs) return null;
                const leftPct = (tickMs / project.totalProjectDurationMs) * 100;
                return (
                  <div
                    key={`minor_${i}`}
                    style={{ left: `${leftPct}%` }}
                    className="absolute bottom-0 h-1.5 w-[1px] bg-[#E5E2DC] dark:bg-[#2C2A27] transform -translate-x-1/2"
                  />
                );
              })}

              {/* Major Ticks with labels (00:02, 00:04, 00:06...) */}
              {Array.from({ length: majorTickCount + 1 }).map((_, i) => {
                const tickSec = i * rulerMajorStepSec;
                const tickMs = tickSec * 1000;
                if (tickMs > project.totalProjectDurationMs) return null;
                const leftPct = (tickMs / project.totalProjectDurationMs) * 100;
                const mm = Math.floor(tickSec / 60).toString().padStart(2, '0');
                const ss = Math.floor(tickSec % 60).toString().padStart(2, '0');
                return (
                  <div
                    key={`major_${i}`}
                    style={{ left: `${leftPct}%` }}
                    className="absolute top-0 bottom-0 flex flex-col items-center transform -translate-x-1/2"
                  >
                    <span className="leading-none text-[8.5px] text-[#8E8A82] dark:text-[#78736B] font-mono tabular-nums">{mm}:{ss}</span>
                    <div className="h-2 w-[1px] bg-[#D8D4CC] dark:bg-[#383531] mt-auto" />
                  </div>
                );
              })}
            </div>

            {/* Red Playhead Line & Precision Touch Handle */}
            {(() => {
              const playheadPct = project.totalProjectDurationMs > 0 ? (currentProjectMs / project.totalProjectDurationMs) * 100 : 0;
              return (
                <div
                  style={{
                    left: `${playheadPct}%`
                  }}
                  className="absolute inset-y-0 w-[2px] bg-[#EF4444] z-30 pointer-events-none"
                >
                  {/* Transparent 44px (w-11) Touch Hitbox Handle with centered marker cap */}
                  <div
                    onTouchStart={handlePlayheadTouchStart}
                    onTouchMove={handlePlayheadTouchMove}
                    onTouchEnd={handlePlayheadTouchEnd}
                    onTouchCancel={handlePlayheadTouchEnd}
                    className="absolute -top-1 left-1/2 -translate-x-1/2 w-11 h-8 bg-transparent flex flex-col items-center justify-start pointer-events-auto touch-none cursor-ew-resize select-none"
                  >
                    {/* Floating raised timestamp badge above thumb shown ONLY while actively scrubbing */}
                    {isScrubbing && (
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-[#181715] dark:bg-[#070706] border border-[#EF4444] text-[#EF4444] dark:text-[#FCA5A5] font-mono text-[11px] font-bold shadow-xl whitespace-nowrap pointer-events-none flex flex-col items-center z-50">
                        <span>{formatReadout(currentProjectMs)}</span>
                        <div className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-[#EF4444]" />
                      </div>
                    )}
                    {/* Clean compact 12px x 14px red inverted pentagon cap centered directly on the 2px hairline */}
                    <div
                      className={`w-3 h-3.5 bg-[#EF4444] shadow-md transition-transform ${isPrecisionScrubbing ? 'scale-125' : ''}`}
                      style={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 60%, 50% 100%, 0% 60%)' }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Timeline Items Track */}
            <div className="w-full h-14 md:h-16 flex items-center gap-0 flex-nowrap relative mt-0.5 overflow-visible">
              {project.items.map((item) => {
                const isSelected = selectedItemId === item.id;

                if (item.status === 'DELETED') {
                  return null;
                }

                const durPct = project.totalProjectDurationMs > 0
                  ? (item.durationMs / project.totalProjectDurationMs) * 100
                  : 0;

                const isSilence = item.status === 'SUGGESTED_SILENCE_CUT';
                const isSilenceSelected = isSilence && item.meta?.silenceSelected !== false;
                const isAddedVideoClip = !isSilence && (
                  (item.kind === 'MEME_CLIP' && (!!item.meta?.isAddedClip || (item.id.startsWith('clip_') && !item.meta?.memeCategory?.startsWith('meme_')))) ||
                  (item.kind === 'SOURCE_CLIP' && item.blobUrl !== project.sourceVideoUrl)
                );
                const isMeme = item.kind === 'MEME_CLIP' && !isAddedVideoClip;
                const isDraggable = item.status === 'ACTIVE';
                const clipThumbs = clipFilmstrips[item.blobUrl] || (item.kind === 'SOURCE_CLIP' ? thumbnails : null);
                const hasClipThumbnails = !!clipThumbs && Object.keys(clipThumbs).length > 0;
                const isNarrow = item.durationMs < 2000 || durPct < 6;
                const tileCount = Math.max(1, Math.ceil((item.durationMs / 1000) * (timelineZoom >= 2 ? timelineZoom : 1.5)));

                // Active item touch reorder helpers
                const nonDeletedItems = project.items.filter(it => it.status !== 'DELETED');
                const curActiveIdx = nonDeletedItems.findIndex(it => it.id === item.id);
                const prevActiveItem = curActiveIdx > 0 ? nonDeletedItems[curActiveIdx - 1] : null;
                const nextActiveItem = curActiveIdx >= 0 && curActiveIdx < nonDeletedItems.length - 1 ? nonDeletedItems[curActiveIdx + 1] : null;

                return (
                  <div
                    key={item.id}
                    draggable={isDraggable}
                    onDragStart={(e) => {
                      if (!isDraggable) return;
                      setDraggedItemId(item.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', item.id);
                    }}
                    onDragOver={(e) => {
                      if (!draggedItemId || draggedItemId === item.id || !isDraggable) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const rect = e.currentTarget.getBoundingClientRect();
                      const mouseX = e.clientX - rect.left;
                      const position: 'before' | 'after' = mouseX < rect.width / 2 ? 'before' : 'after';
                      if (!dropTarget || dropTarget.id !== item.id || dropTarget.position !== position) {
                        setDropTarget({ id: item.id, position });
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!draggedItemId || draggedItemId === item.id || !dropTarget || dropTarget.id !== item.id) {
                        setDraggedItemId(null);
                        setDropTarget(null);
                        return;
                      }
                      reorderTimelineItem(draggedItemId, item.id, dropTarget.position);
                      setDraggedItemId(null);
                      setDropTarget(null);
                    }}
                    onDragEnd={() => {
                      setDraggedItemId(null);
                      setDropTarget(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItemId(item.id);
                    }}
                    style={{ width: `${durPct}%`, minWidth: isSilence ? '44px' : undefined }}
                    title={`${item.title} (${(item.durationMs / 1000).toFixed(1)}s)${isDraggable ? ' • Drag to reorder' : ''}`}
                    className={`h-14 md:h-16 rounded-lg px-2 py-1 flex flex-col justify-between transition-all relative select-none cursor-pointer box-border overflow-visible flex-shrink-0 ${
                      draggedItemId === item.id ? 'opacity-50' : 'opacity-100'
                    } ${
                      isSelected
                        ? 'ring-2 ring-[#D96B27] dark:ring-[#E8632A] border-transparent shadow-md'
                        : 'border border-[#E5E2DC] dark:border-[#2C2A27]'
                    } ${
                      isSilence
                        ? isSilenceSelected
                          ? 'bg-[#FEF3C7] dark:bg-[#78350F]/40 border border-[#F59E0B] dark:border-[#B45309] text-[#92400E] dark:text-[#FDE68A] hover:bg-[#FDE68A] dark:hover:bg-[#78350F]/60'
                          : 'border-dashed border-[#D8D4CC] dark:border-[#383531] bg-[#F2EFEB] dark:bg-[#1E1D1B] text-[#8E8A82] dark:text-[#78736B] hover:bg-[#E5E2DC] dark:hover:bg-[#262421]'
                        : isMeme
                        ? replacingMemeId === item.id
                          ? 'bg-[#FFF1F2] dark:bg-[#4C0519]/40 text-[#BE123C] dark:text-[#FDA4AF] ring-2 ring-[#D96B27] dark:ring-[#E8632A] animate-pulse shadow-lg border border-[#FDA4AF] dark:border-[#9F1239]'
                          : 'bg-[#FFF1F2] dark:bg-[#4C0519]/40 border border-[#FDA4AF] dark:border-[#9F1239] text-[#BE123C] dark:text-[#FDA4AF] hover:bg-[#FFE4E6] dark:hover:bg-[#4C0519]/60'
                        : 'bg-[#252422] dark:bg-[#1B1A18] text-[#F7F6F2] border border-[#3D3A35] dark:border-[#2E2C28] hover:border-[#524E47] dark:hover:border-[#423F3A]'
                    }`}
                  >
                    {/* Touch Reorder Buttons on Selected Active Clip */}
                    {isSelected && isDraggable && nonDeletedItems.length >= 2 && (
                      <div
                        className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center bg-[#181715] dark:bg-[#070706] text-white rounded shadow-md z-40 px-1 py-0.5 gap-1 border border-[#3A3833] dark:border-[#2E2C28]"
                        data-no-scrub="true"
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={!prevActiveItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (prevActiveItem) reorderTimelineItem(item.id, prevActiveItem.id, 'before');
                          }}
                          className="text-[10px] font-bold hover:text-[#D96B27] dark:hover:text-[#E8632A] disabled:opacity-25 px-1 cursor-pointer"
                          title="Move clip left"
                        >
                          ←
                        </button>
                        <span className="text-[8px] text-[#8E8A82] dark:text-[#78736B]">|</span>
                        <button
                          type="button"
                          disabled={!nextActiveItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (nextActiveItem) reorderTimelineItem(item.id, nextActiveItem.id, 'after');
                          }}
                          className="text-[10px] font-bold hover:text-[#D96B27] dark:hover:text-[#E8632A] disabled:opacity-25 px-1 cursor-pointer"
                          title="Move clip right"
                        >
                          →
                        </button>
                      </div>
                    )}

                    {/* Amber Drop Indicator Lines */}
                    {dropTarget?.id === item.id && dropTarget.position === 'before' && (
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#D96B27] dark:bg-[#E8632A] z-40 shadow-[0_0_8px_rgba(217,107,39,0.9)] pointer-events-none rounded-l" />
                    )}
                    {dropTarget?.id === item.id && dropTarget.position === 'after' && (
                      <div className="absolute right-0 top-0 bottom-0 w-[3px] bg-[#D96B27] dark:bg-[#E8632A] z-40 shadow-[0_0_8px_rgba(217,107,39,0.9)] pointer-events-none rounded-r" />
                    )}

                    {/* Meme Thumbnail Frame */}
                    {isMeme && (
                      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-lg opacity-80">
                        <video
                          src={`${item.blobUrl}#t=0.3`}
                          preload="metadata"
                          muted
                          playsInline
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/75 pointer-events-none" />
                      </div>
                    )}

                    {/* Filmstrip Frame Thumbnails */}
                    {hasClipThumbnails && !isSilence && !isMeme && (
                      <div className="absolute inset-0 flex flex-row overflow-hidden pointer-events-none opacity-85 rounded-lg">
                        {Array.from({ length: tileCount }).map((_, tileIdx) => {
                          const tileSourceMs = item.sourceStartMs + (tileIdx * 1000);
                          const nearestMs = Math.round(tileSourceMs / 1000) * 1000;
                          const frameUrl = (clipThumbs && (clipThumbs[nearestMs] || clipThumbs[0])) || '';
                          return (
                            <div
                              key={tileIdx}
                              className="w-14 shrink-0 h-full bg-cover bg-center border-r border-black/25"
                              style={{
                                backgroundImage: frameUrl ? `url(${frameUrl})` : undefined,
                                backgroundColor: frameUrl ? undefined : '#22211E',
                                imageRendering: 'auto'
                              }}
                            />
                          );
                        })}
                        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/70 pointer-events-none" />
                      </div>
                    )}

                    <div className="relative z-10 flex items-center justify-between">
                      <div className="flex items-center min-w-0 mr-1 overflow-hidden">
                        {isDraggable && (
                          <span
                            className="cursor-grab active:cursor-grabbing text-[#8E8A82] dark:text-[#78736B] hover:text-white mr-1 flex-shrink-0"
                            title="Grab and drag to move clip before or after other clips"
                          >
                            <GripVertical className="w-3 h-3" />
                          </span>
                        )}
                        <span className="text-[10px] md:text-[11px] font-semibold truncate drop-shadow-md">
                          {isMeme
                            ? isNarrow ? '🎬' : `🎬 ${item.title}`
                            : isSilence
                            ? isSilenceSelected ? item.title : `${item.title} (Keep)`
                            : isNarrow
                            ? ''
                            : item.title}
                        </span>
                      </div>

                      {isSilence && (
                        <div
                          className="flex items-center space-x-1"
                          data-no-scrub="true"
                          draggable={false}
                          onDragStart={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => toggleSilenceSelected(item.id)}
                            className={`p-1 rounded transition-colors cursor-pointer ${
                              isSilenceSelected
                                ? 'bg-[#D96B27] dark:bg-[#E8632A] text-white hover:bg-[#C25E1F] dark:hover:bg-[#F2743D]'
                                : 'bg-white dark:bg-[#24221F] text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC] border border-[#E5E2DC] dark:border-[#2C2A27]'
                            }`}
                            title={isSilenceSelected ? 'Checked for cut (click to uncheck and keep pause)' : 'Unchecked (click to check for cut)'}
                          >
                            {isSilenceSelected ? (
                              <Check className="w-3 h-3 stroke-[2.5]" />
                            ) : (
                              <span className="w-3 h-3 flex items-center justify-center text-[10px] font-bold leading-none">○</span>
                            )}
                          </button>
                          <button
                            onClick={() => keepSilencePause(item.id)}
                            className="p-1 bg-white dark:bg-[#24221F] hover:bg-[#F7F6F2] dark:hover:bg-[#2E2B27] text-[#66625B] dark:text-[#A39E95] border border-[#E5E2DC] dark:border-[#2C2A27] rounded cursor-pointer"
                            title="Remove from suggestions (Keep Pause)"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {isMeme && (isSelected || !isNarrow) && (
                        <div
                          className={`items-center space-x-1 ${!isSelected ? 'hidden sm:flex' : 'flex'}`}
                          data-no-scrub="true"
                          draggable={false}
                          onDragStart={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setReplacingMemeId(replacingMemeId === item.id ? null : item.id);
                              setIsRightOpen(true);
                              setIsMemeSectionOpen(true);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors cursor-pointer ${
                              replacingMemeId === item.id
                                ? 'bg-[#D96B27] dark:bg-[#E8632A] text-white font-bold shadow'
                                : 'bg-white dark:bg-[#24221F] hover:bg-[#FFF1F2] dark:hover:bg-[#4C0519]/50 text-[#BE123C] dark:text-[#FDA4AF] border border-[#FDA4AF] dark:border-[#9F1239]'
                            }`}
                            title="Replace this meme with another from library or upload"
                          >
                            {replacingMemeId === item.id ? 'Cancel' : 'Replace'}
                          </button>
                          <button
                            onClick={() => removeMemeClip(item.id)}
                            className="p-1 bg-white dark:bg-[#24221F] hover:bg-[#FEF2F2] dark:hover:bg-[#450A0A]/40 text-[#BE123C] dark:text-[#FDA4AF] hover:text-[#DC2626] dark:hover:text-[#F87171] rounded border border-[#FDA4AF] dark:border-[#9F1239] transition-colors cursor-pointer"
                            title="Remove this meme and restore continuous video"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="relative z-10 flex items-center justify-between text-[10px] text-[#A19E97] dark:text-[#78736B] font-mono tabular-nums drop-shadow-sm">
                      <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                      {item.transitionOut && item.transitionOut.type !== 'none' && (
                        <span className="bg-black/60 px-1 rounded uppercase text-[9px] text-white">
                          {item.transitionOut.type}
                        </span>
                      )}
                    </div>

                    {/* Transition Picker Diamond / Badge (Step 3.3) */}
                    <div
                      data-no-scrub="true"
                      draggable={false}
                      onDragStart={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextType: TransitionType = item.transitionOut?.type === 'fade' ? 'none' : 'fade';
                        setTransition(item.id, nextType);
                      }}
                      className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 rounded-full flex items-center justify-center text-[8px] z-30 shadow cursor-pointer transition-all ${
                        item.transitionOut && item.transitionOut.type !== 'none'
                          ? 'bg-[#D96B27] dark:bg-[#E8632A] border border-white dark:border-[#171615] text-white hover:bg-[#C25E1F] dark:hover:bg-[#F2743D] scale-110'
                          : 'bg-white dark:bg-[#24221F] border border-[#E5E2DC] dark:border-[#2C2A27] hover:border-[#D96B27] dark:hover:border-[#E8632A] text-[#66625B] dark:text-[#A39E95] hover:text-[#D96B27] dark:hover:text-[#E8632A]'
                      }`}
                      title="Toggle Fade transition (included in MP4 export)"
                    >
                      {item.transitionOut && item.transitionOut.type !== 'none' && (
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 px-1 py-0.5 rounded bg-[#D96B27] dark:bg-[#E8632A] text-white font-bold text-[8px] uppercase tracking-wider shadow whitespace-nowrap pointer-events-none">
                          {item.transitionOut.type}
                        </span>
                      )}
                      <span>⧖</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Background Music Track (Synced directly below video track) */}
            <div
              data-no-scrub="true"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full h-8 mt-1.5 flex items-center shrink-0"
            >
              {bgMusic ? (
                <div className="w-full h-full bg-[#0F766E]/15 border border-[#0F766E]/40 text-[#0F766E] dark:text-[#2DD4BF] rounded-md px-2 flex items-center justify-between text-xs transition-all shadow-sm">
                  <div className="flex items-center space-x-1.5 min-w-0 mr-2">
                    <Music className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium truncate text-[11px] max-w-[110px] sm:max-w-[200px]" title={bgMusic.name}>
                      {bgMusic.name}
                    </span>
                    {/* Subtle animated waveform bars */}
                    <div className="flex items-center space-x-0.5 opacity-60 shrink-0">
                      <div className="w-0.5 h-2 bg-current rounded-full animate-pulse" />
                      <div className="w-0.5 h-3.5 bg-current rounded-full" />
                      <div className="w-0.5 h-2.5 bg-current rounded-full" />
                      <div className="w-0.5 h-4 bg-current rounded-full animate-pulse" />
                      <div className="w-0.5 h-1.5 bg-current rounded-full" />
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
                    {/* Volume Slider & Percent */}
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => toggleBgMusicMute()}
                        className="p-0.5 hover:opacity-80 transition-opacity cursor-pointer"
                        title={bgMusic.isMuted || bgMusic.volume === 0 ? "Unmute music" : "Mute music"}
                      >
                        {bgMusic.isMuted || bgMusic.volume === 0 ? (
                          <VolumeX className="w-3 h-3 text-[#DC2626]" />
                        ) : (
                          <Volume2 className="w-3 h-3" />
                        )}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={bgMusic.isMuted ? 0 : bgMusic.volume}
                        onChange={(e) => setBgMusicVolume(parseFloat(e.target.value))}
                        className="w-10 sm:w-14 h-1 bg-[#0F766E]/30 accent-[#0F766E] dark:accent-[#2DD4BF] rounded-lg cursor-pointer"
                        title={`Music Volume: ${Math.round(bgMusic.volume * 100)}%`}
                      />
                      <span className="text-[10px] font-mono tabular-nums w-5 sm:w-6 text-right">
                        {bgMusic.isMuted ? '0%' : `${Math.round(bgMusic.volume * 100)}%`}
                      </span>
                    </div>

                    {/* Quick remove button */}
                    <button
                      onClick={() => removeBgMusic()}
                      className="p-1 text-[#8E8A82] dark:text-[#78736B] hover:text-[#DC2626] dark:hover:text-[#F87171] transition-colors cursor-pointer"
                      title="Remove background music track"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => bgMusicInputRef.current?.click()}
                  className="w-full h-full border border-dashed border-[#E5E2DC] dark:border-[#2C2A27] hover:border-[#0F766E] bg-white dark:bg-[#171615] hover:bg-[#F0FDFA] dark:hover:bg-[#14B8A6]/10 rounded-md px-3 flex items-center justify-center space-x-1.5 text-[11px] text-[#66625B] dark:text-[#A39E95] hover:text-[#0F766E] dark:hover:text-[#5EEAD4] transition-all group cursor-pointer"
                  title="Click to add a background music track (.mp3, .wav, .m4a, .aac, .ogg)"
                >
                  <Music className="w-3 h-3 text-[#8E8A82] dark:text-[#78736B] group-hover:text-[#0F766E] dark:group-hover:text-[#5EEAD4] transition-colors" />
                  <span className="hidden sm:inline">+ Add Background Music track (.mp3, .wav, .m4a, up to 30 MB)</span>
                  <span className="sm:hidden">♪ Add background music</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>

      {/* Mobile 4-Tab Tool Drawer */}
      <div className="flex md:hidden flex-1 min-h-0 flex-col bg-white dark:bg-[#171615] border-t border-[#E5E2DC] dark:border-[#2C2A27]">
        {/* Drawer Tabs Header */}
        <div className="flex items-center border-b border-[#E5E2DC] dark:border-[#2C2A27] bg-[#FAF9F5] dark:bg-[#1E1D1B] h-9 text-xs font-medium shrink-0">
          <button
            onClick={() => setMobileDrawerTab('ai')}
            className={`flex-1 h-full py-1 flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
              mobileDrawerTab === 'ai'
                ? 'border-[#D96B27] dark:border-[#E8632A] text-[#D96B27] dark:text-[#E8632A] font-semibold bg-white dark:bg-[#171615]'
                : 'border-transparent text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI & Cuts</span>
          </button>
          <button
            onClick={() => setMobileDrawerTab('clips')}
            className={`flex-1 h-full py-1 flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
              mobileDrawerTab === 'clips'
                ? 'border-[#D96B27] dark:border-[#E8632A] text-[#D96B27] dark:text-[#E8632A] font-semibold bg-white dark:bg-[#171615]'
                : 'border-transparent text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Clips & Memes</span>
          </button>
          <button
            onClick={() => setMobileDrawerTab('audio')}
            className={`flex-1 h-full py-1 flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
              mobileDrawerTab === 'audio'
                ? 'border-[#0F766E] dark:border-[#2DD4BF] text-[#0F766E] dark:text-[#5EEAD4] font-semibold bg-white dark:bg-[#171615]'
                : 'border-transparent text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>Audio</span>
          </button>
          <button
            onClick={() => setMobileDrawerTab('transcript')}
            className={`flex-1 h-full py-1 flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
              mobileDrawerTab === 'transcript'
                ? 'border-[#D96B27] dark:border-[#E8632A] text-[#D96B27] dark:text-[#E8632A] font-semibold bg-white dark:bg-[#171615]'
                : 'border-transparent text-[#66625B] dark:text-[#A39E95] hover:text-[#181715] dark:hover:text-[#F4F2EC]'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Transcript</span>
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col">
          {mobileDrawerTab === 'ai' && renderAiCommandsSection()}
          {mobileDrawerTab === 'clips' && renderMemesSection()}
          {mobileDrawerTab === 'audio' && renderAudioSection()}
          {mobileDrawerTab === 'transcript' && renderTranscriptSection()}
        </div>
      </div>
    </div>
  );
};
