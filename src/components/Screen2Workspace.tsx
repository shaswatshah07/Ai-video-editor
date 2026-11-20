import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Scissors, Trash2,
  Sparkles, Send, Upload, ChevronRight, ChevronLeft, ChevronDown, ArrowRight,
  Bookmark, Check, X, Wand2, ShieldAlert, Download,
  Loader2, AlertCircle, RefreshCw, Search, Plus, Film, GripVertical,
  Music, Volume2, VolumeX
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { mapProjectToSource, mapSourceToProjectMs } from '../utils/timelineMath';
import { parseCommandWithFallback } from '../utils/commandParser';
import { TransitionType, TimelineItem } from '../types/edl';
import { SilenceSensitivity, SILENCE_PRESETS } from '../utils/silenceDetector';
import { downloadTranscriptAsTxt } from '../utils/transcriptParser';
import { generateDenoisedAudio } from '../utils/audioDenoiser';
import { MEME_LIBRARY } from '../utils/memeLibrary';

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
    (it) => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME'
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

export const Screen2Workspace: React.FC = () => {
  const {
    project,
    currentProjectMs,
    isPlaying,
    previewSpeed,
    timelineZoom,
    silenceSensitivity,
    thumbnails,
    clipFilmstrips,
    thumbnailProgress,
    selectedItemId,
    commandLogs,
    voiceEnhanceEnabled,
    noiseRemovalEnabled,
    denoisedAudioUrl,
    denoisedAudioBlob,
    isDenoising,
    denoiseProgress,
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
    setSilenceSensitivity,
    setTranscriptQuality,
    setTranscriptMode,
    updateTranscriptWord,
    generateTranscript,
    setSelectedItemId,
    splitAtPlayhead,
    deleteSelected,
    acceptSilenceCut,
    keepSilencePause,
    detectSilencesOnly,
    setTransition,
    toggleVoiceEnhance,
    toggleNoiseRemoval,
    setDenoisedAudio,
    setIsDenoising,
    setDenoiseProgress,
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

  // Web Audio Context & Node Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const rawSourceAttachedRef = useRef<boolean>(false);
  const denoisedSourceAttachedRef = useRef<boolean>(false);
  const denoisedAudioRef = useRef<HTMLAudioElement | null>(null);

  // Crossfade gain nodes
  const rawGainRef = useRef<GainNode | null>(null);
  const denoisedGainRef = useRef<GainNode | null>(null);

  // Speaker Voice Enhancement stage refs (Stronger Spec)
  const veHighPassRef = useRef<BiquadFilterNode | null>(null);
  const veWarmthCutRef = useRef<BiquadFilterNode | null>(null);
  const vePresenceBoostRef = useRef<BiquadFilterNode | null>(null);
  const veHighShelfRef = useRef<BiquadFilterNode | null>(null);
  const veCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const veMakeupGainRef = useRef<GainNode | null>(null);

  // UI state
  const [promptInput, setPromptInput] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [leftTab, setLeftTab] = useState<'transcript' | 'chapters'>('transcript');
  const [isLeftOpen, setIsLeftOpen] = useState<boolean>(true);
  const [isRightOpen, setIsRightOpen] = useState<boolean>(true);
  const [activeMemePlaying, setActiveMemePlaying] = useState<boolean>(false);
  const [isSecondaryReady, setIsSecondaryReady] = useState<boolean>(false);
  const loadedSecondaryUrlRef = useRef<string | null>(null);

  const handleSecondaryReady = useCallback(() => {
    if (memeVideoRef.current && loadedSecondaryUrlRef.current) {
      const currentSrc = memeVideoRef.current.currentSrc || memeVideoRef.current.src || '';
      const target = loadedSecondaryUrlRef.current;
      if (!currentSrc || currentSrc === target || currentSrc.endsWith(target) || currentSrc.includes(target) || target.includes(currentSrc)) {
        setIsSecondaryReady(true);
      }
    }
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

  // Timeline scrubbing & hover state (Item 2)
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  // Editable transcript word state
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editingWordText, setEditingWordText] = useState<string>('');

  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const trackContainerRef = useRef<HTMLDivElement | null>(null);

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

  const mappedTranscriptWords = useMemo(() => {
    if (!project?.transcript) return [];
    const mapped = project.transcript.map((w) => ({
      word: w,
      projMs: getWordProjectMs(w, project.items)
    }));
    return mapped.sort((a, b) => {
      if (a.projMs === null && b.projMs === null) return 0;
      if (a.projMs === null) return 1;
      if (b.projMs === null) return -1;
      return a.projMs - b.projMs;
    });
  }, [project?.transcript, project?.items, getWordProjectMs]);

  // Connect denoised <audio> element to Web Audio gain node
  const connectDenoisedSource = useCallback(() => {
    const ctx = audioContextRef.current;
    const audioEl = denoisedAudioRef.current;
    if (!ctx || !audioEl || denoisedSourceAttachedRef.current || !denoisedGainRef.current) return;
    try {
      const dSource = ctx.createMediaElementSource(audioEl);
      dSource.connect(denoisedGainRef.current);
      denoisedSourceAttachedRef.current = true;
    } catch {
      // Element might already be connected
    }
  }, []);

  // Setup Web Audio Node Chain on user gesture or mount
  const setupWebAudio = useCallback(() => {
    if (!mainVideoRef.current) return;

    try {
      if (!audioContextRef.current) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new AudioCtxClass();
      }
      const ctx = audioContextRef.current;

      // 1. Build Voice Enhancement Chain once if not yet initialized
      if (!veHighPassRef.current) {
        // High-pass filter at 90 Hz (removes rumble, transparent at 10 Hz when OFF)
        const veHighPass = ctx.createBiquadFilter();
        veHighPass.type = 'highpass';
        veHighPass.frequency.value = voiceEnhanceEnabled ? 90 : 10;
        veHighPass.Q.value = 0.7071;
        veHighPassRef.current = veHighPass;

        // Room-echo / boxiness cut: peaking filter at 280 Hz, Q = 1.2, -2.5 dB (0 dB when OFF)
        const veWarmthCut = ctx.createBiquadFilter();
        veWarmthCut.type = 'peaking';
        veWarmthCut.frequency.value = 280;
        veWarmthCut.Q.value = 1.2;
        veWarmthCut.gain.value = voiceEnhanceEnabled ? -2.5 : 0;
        veWarmthCutRef.current = veWarmthCut;

        // Natural vocal clarity: peaking filter at 2500 Hz, Q = 0.9, +2.8 dB (0 dB when OFF)
        const vePresenceBoost = ctx.createBiquadFilter();
        vePresenceBoost.type = 'peaking';
        vePresenceBoost.frequency.value = 2500;
        vePresenceBoost.Q.value = 0.9;
        vePresenceBoost.gain.value = voiceEnhanceEnabled ? 2.8 : 0;
        vePresenceBoostRef.current = vePresenceBoost;

        // Anti-hiss gentle roll-off: high-shelf at 6500 Hz, -1.5 dB (0 dB when OFF)
        const veHighShelf = ctx.createBiquadFilter();
        veHighShelf.type = 'highshelf';
        veHighShelf.frequency.value = 6500;
        veHighShelf.gain.value = voiceEnhanceEnabled ? -1.5 : 0;
        veHighShelfRef.current = veHighShelf;

        // Gentle Dynamics Compressor (ratio 2.5:1, threshold -14, knee 20, attack 0.01, release 0.2)
        const veCompressor = ctx.createDynamicsCompressor();
        veCompressor.threshold.value = voiceEnhanceEnabled ? -14 : 0;
        veCompressor.knee.value = 20;
        veCompressor.ratio.value = voiceEnhanceEnabled ? 2.5 : 1;
        veCompressor.attack.value = 0.01;
        veCompressor.release.value = 0.2;
        veCompressorRef.current = veCompressor;

        // Makeup Gain: 1.15 when ON, 1.0 when OFF
        const veMakeupGain = ctx.createGain();
        veMakeupGain.gain.value = voiceEnhanceEnabled ? 1.15 : 1.0;
        veMakeupGainRef.current = veMakeupGain;

        // Chain connections:
        // veHighPass -> veWarmthCut -> vePresenceBoost -> veHighShelf -> veCompressor -> veMakeupGain -> destination
        veHighPass.connect(veWarmthCut);
        veWarmthCut.connect(vePresenceBoost);
        vePresenceBoost.connect(veHighShelf);
        veHighShelf.connect(veCompressor);
        veCompressor.connect(veMakeupGain);
        veMakeupGain.connect(ctx.destination);
      }

      // 2. Build Raw & Denoised crossfade gain nodes
      if (!rawGainRef.current && veHighPassRef.current) {
        const rawGain = ctx.createGain();
        const shouldUseDenoised = noiseRemovalEnabled && !!denoisedAudioUrl;
        rawGain.gain.value = shouldUseDenoised ? 0.0 : 1.0;
        rawGain.connect(veHighPassRef.current);
        rawGainRef.current = rawGain;
      }

      if (!denoisedGainRef.current && veHighPassRef.current) {
        const denoisedGain = ctx.createGain();
        const shouldUseDenoised = noiseRemovalEnabled && !!denoisedAudioUrl;
        denoisedGain.gain.value = shouldUseDenoised ? 1.0 : 0.0;
        denoisedGain.connect(veHighPassRef.current);
        denoisedGainRef.current = denoisedGain;
      }

      // 3. Attach main video source
      if (!rawSourceAttachedRef.current && mainVideoRef.current && rawGainRef.current) {
        const rawSource = ctx.createMediaElementSource(mainVideoRef.current);
        rawSource.connect(rawGainRef.current);
        rawSourceAttachedRef.current = true;
      }

      // 4. Attach denoised audio source if ready
      connectDenoisedSource();
    } catch {
      // Audio element might already be connected or blocked
    }
  }, [voiceEnhanceEnabled, noiseRemovalEnabled, denoisedAudioUrl, connectDenoisedSource]);

  // Dynamically update audio node parameters when store toggles
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;

    // Crossfade between Raw and Denoised audio
    const shouldUseDenoised = noiseRemovalEnabled && !!denoisedAudioUrl;
    if (rawGainRef.current) {
      rawGainRef.current.gain.setTargetAtTime(shouldUseDenoised ? 0.0 : 1.0, now, 0.01);
    }
    if (denoisedGainRef.current) {
      denoisedGainRef.current.gain.setTargetAtTime(shouldUseDenoised ? 1.0 : 0.0, now, 0.01);
    }
    // When noiseRemovalEnabled is false, immediately pause denoised audio
    if (!shouldUseDenoised && denoisedAudioRef.current && !denoisedAudioRef.current.paused) {
      denoisedAudioRef.current.pause();
    }

    // Speaker Voice Enhancement Stage (Clean, Natural Broadcast Vocal Shaping)
    if (veHighPassRef.current) {
      veHighPassRef.current.frequency.setTargetAtTime(voiceEnhanceEnabled ? 90 : 10, now, 0.015);
    }
    if (veWarmthCutRef.current) {
      veWarmthCutRef.current.frequency.setTargetAtTime(280, now, 0.015);
      veWarmthCutRef.current.gain.setTargetAtTime(voiceEnhanceEnabled ? -2.5 : 0, now, 0.015);
    }
    if (vePresenceBoostRef.current) {
      vePresenceBoostRef.current.frequency.setTargetAtTime(2500, now, 0.015);
      vePresenceBoostRef.current.gain.setTargetAtTime(voiceEnhanceEnabled ? 2.8 : 0, now, 0.015);
    }
    if (veHighShelfRef.current) {
      veHighShelfRef.current.frequency.setTargetAtTime(6500, now, 0.015);
      veHighShelfRef.current.gain.setTargetAtTime(voiceEnhanceEnabled ? -1.5 : 0, now, 0.015);
    }
    if (veCompressorRef.current) {
      veCompressorRef.current.ratio.setTargetAtTime(voiceEnhanceEnabled ? 2.5 : 1, now, 0.015);
      veCompressorRef.current.threshold.setTargetAtTime(voiceEnhanceEnabled ? -14 : 0, now, 0.015);
      veCompressorRef.current.knee.setTargetAtTime(20, now, 0.015);
      veCompressorRef.current.attack.setTargetAtTime(0.01, now, 0.015);
      veCompressorRef.current.release.setTargetAtTime(0.2, now, 0.015);
    }
    if (veMakeupGainRef.current) {
      veMakeupGainRef.current.gain.setTargetAtTime(voiceEnhanceEnabled ? 1.15 : 1.0, now, 0.015);
    }
  }, [voiceEnhanceEnabled, noiseRemovalEnabled, denoisedAudioUrl]);

  // Generate denoised audio when noiseRemovalEnabled is turned on and not yet cached
  useEffect(() => {
    if (noiseRemovalEnabled && !denoisedAudioBlob && !isDenoising && project?.sourceVideoUrl) {
      setIsDenoising(true);
      setDenoiseProgress('Profiling audio noise...');
      generateDenoisedAudio(project.sourceVideoUrl, (stage, ratio) => {
        setDenoiseProgress(`${stage} (${Math.round(ratio * 100)}%)`);
      }).then(({ blob, url }) => {
        setDenoisedAudio(blob, url);
      }).catch((err) => {
        console.error('Audio denoising failed:', err);
        setIsDenoising(false);
        setDenoiseProgress('');
      });
    }
  }, [noiseRemovalEnabled, denoisedAudioBlob, isDenoising, project?.sourceVideoUrl, setIsDenoising, setDenoiseProgress, setDenoisedAudio]);

  // When denoisedAudioUrl becomes available, attach its audio element to Web Audio
  useEffect(() => {
    if (denoisedAudioUrl && denoisedAudioRef.current) {
      connectDenoisedSource();
    }
  }, [denoisedAudioUrl, connectDenoisedSource]);

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
    if (denoisedAudioRef.current) {
      denoisedAudioRef.current.playbackRate = speed;
      denoisedAudioRef.current.preservesPitch = true;
    }
    if (bgMusicRef.current) {
      bgMusicRef.current.playbackRate = speed;
      bgMusicRef.current.preservesPitch = true;
    }
  }, []);

  useEffect(() => {
    applyPlaybackSpeed(previewSpeed);
  }, [previewSpeed, applyPlaybackSpeed]);

  // Main Virtual Playback Engine RAF Loop (Spec 3)
  useEffect(() => {
    if (!project) return;

    const loop = (timestamp: number) => {
      if (isPlaying) {
        if (lastTickTimeRef.current === null) {
          lastTickTimeRef.current = timestamp;
        }
        const deltaSeconds = Math.min(0.1, (timestamp - lastTickTimeRef.current) / 1000);
        lastTickTimeRef.current = timestamp;

        const deltaMs = deltaSeconds * 1000 * previewSpeed;
        const nextProjectMs = currentProjectMs + deltaMs;

        const activeItems = project.items.filter(it => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME');
        const totalDuration = project.totalProjectDurationMs;

        if (nextProjectMs >= totalDuration) {
          setIsPlaying(false);
          setCurrentProjectMs(totalDuration);
          lastTickTimeRef.current = null;
          if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
          return;
        }

        // High-speed cut-skipping: check if mainVideoRef.currentTime entered or crossed a DELETED segment
        if (mainVideoRef.current && !mainVideoRef.current.paused) {
          const curSrcMs = Math.round(mainVideoRef.current.currentTime * 1000);
          const inDeleted = project.items.find(
            it => it.status === 'DELETED' && curSrcMs >= it.sourceStartMs && curSrcMs < it.sourceEndMs
          );
          if (inDeleted) {
            const nextActiveAfter = project.items.find(
              it => (it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME') && it.sourceStartMs >= inDeleted.sourceEndMs
            );
            if (nextActiveAfter && lastSeekTargetRef.current !== nextActiveAfter.sourceStartMs) {
              lastSeekTargetRef.current = nextActiveAfter.sourceStartMs;
              mainVideoRef.current.currentTime = nextActiveAfter.sourceStartMs / 1000;
              if (denoisedAudioRef.current) {
                denoisedAudioRef.current.currentTime = nextActiveAfter.sourceStartMs / 1000;
              }
              setCurrentProjectMs(nextActiveAfter.projectStartMs);
              rafIdRef.current = requestAnimationFrame(loop);
              return;
            }
          }
        }

        const { item, sourceMs } = mapProjectToSource(nextProjectMs, project.items);

        if (!item) {
          // If in a gap or deleted region, jump forward to next active clip
          const nextActive = activeItems.find(it => it.projectStartMs > nextProjectMs);
          if (nextActive) {
            setCurrentProjectMs(nextActive.projectStartMs);
            if (mainVideoRef.current) {
              mainVideoRef.current.currentTime = nextActive.sourceStartMs / 1000;
              lastSeekTargetRef.current = nextActive.sourceStartMs;
            }
            if (denoisedAudioRef.current) {
              denoisedAudioRef.current.currentTime = nextActive.sourceStartMs / 1000;
            }
          } else {
            setIsPlaying(false);
            lastTickTimeRef.current = null;
            if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
          }
          rafIdRef.current = requestAnimationFrame(loop);
          return;
        }

        // Check if playing a MEME clip
        if (item.kind === 'MEME_CLIP') {
          if (!activeMemePlaying) {
            setActiveMemePlaying(true);
          }
          if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
          if (denoisedAudioRef.current && !denoisedAudioRef.current.paused) denoisedAudioRef.current.pause();

          if (memeVideoRef.current) {
            if (memeVideoRef.current.playbackRate !== previewSpeed) {
              memeVideoRef.current.playbackRate = previewSpeed;
              memeVideoRef.current.preservesPitch = true;
            }
            if (activeMemeIdRef.current !== item.id || loadedSecondaryUrlRef.current !== item.blobUrl) {
              activeMemeIdRef.current = item.id;
              loadedSecondaryUrlRef.current = item.blobUrl;
              setIsSecondaryReady(false);
              memeVideoRef.current.src = item.blobUrl;
              memeVideoRef.current.playbackRate = previewSpeed;
              memeVideoRef.current.preservesPitch = true;
              memeVideoRef.current.currentTime = (sourceMs - item.sourceStartMs) / 1000;
              memeVideoRef.current.play().catch(() => {});
            } else if (memeVideoRef.current.paused) {
              memeVideoRef.current.play().catch(() => {});
            }
          }
        } else {
          // SOURCE_CLIP
          if (activeMemePlaying) {
            setActiveMemePlaying(false);
          }
          if (memeVideoRef.current && !memeVideoRef.current.paused) {
            memeVideoRef.current.pause();
          }
          activeMemeIdRef.current = null;
          loadedSecondaryUrlRef.current = null;
          if (isSecondaryReady) {
            setIsSecondaryReady(false);
          }

          if (mainVideoRef.current) {
            const targetSec = sourceMs / 1000;
            const driftSec = Math.abs(mainVideoRef.current.currentTime - targetSec);

            // Sync main video if drifting > 150ms or crossing cut boundaries
            if (driftSec > 0.15 && lastSeekTargetRef.current !== sourceMs) {
              lastSeekTargetRef.current = sourceMs;
              mainVideoRef.current.currentTime = targetSec;
            }

            if (mainVideoRef.current.playbackRate !== previewSpeed) {
              mainVideoRef.current.playbackRate = previewSpeed;
              mainVideoRef.current.preservesPitch = true;
            }

            if (mainVideoRef.current.paused) {
              mainVideoRef.current.play().catch(() => {});
            }

            // Sync denoised audio element in lockstep with main video only when noise removal is active
            if (denoisedAudioRef.current) {
              if (noiseRemovalEnabled && denoisedAudioUrl) {
                const dDriftSec = Math.abs(denoisedAudioRef.current.currentTime - targetSec);
                if (dDriftSec > 0.03) {
                  denoisedAudioRef.current.currentTime = targetSec;
                }
                if (denoisedAudioRef.current.playbackRate !== previewSpeed) {
                  denoisedAudioRef.current.playbackRate = previewSpeed;
                  denoisedAudioRef.current.preservesPitch = true;
                }
                if (denoisedAudioRef.current.paused && isPlaying && !mainVideoRef.current.paused) {
                  denoisedAudioRef.current.play().catch(() => {});
                }
              } else if (!denoisedAudioRef.current.paused) {
                denoisedAudioRef.current.pause();
              }
            }
          }
        }

        // Frame-accurate playhead-driven transition update
        updateTransitionFrame(nextProjectMs, project.items);

        // Sync Background Music (Looping live preview)
        if (bgMusic && !bgMusic.isMuted && bgMusic.volume > 0 && bgMusicRef.current) {
          const musicDurSec = Math.max(0.1, bgMusic.durationMs / 1000);
          const targetMusicSec = (nextProjectMs / 1000) % musicDurSec;
          const musicDrift = Math.abs(bgMusicRef.current.currentTime - targetMusicSec);
          if (musicDrift > 0.15) {
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

        setCurrentProjectMs(nextProjectMs);
      } else {
        // Paused: halt both video players, denoised audio player, and bg music player
        lastTickTimeRef.current = null;
        if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
        if (memeVideoRef.current && !memeVideoRef.current.paused) memeVideoRef.current.pause();
        if (denoisedAudioRef.current && !denoisedAudioRef.current.paused) denoisedAudioRef.current.pause();
        if (bgMusicRef.current && !bgMusicRef.current.paused) bgMusicRef.current.pause();
        if (project) {
          updateTransitionFrame(currentProjectMs, project.items);
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying, currentProjectMs, project, previewSpeed, denoisedAudioUrl, bgMusic, setCurrentProjectMs, setIsPlaying, updateTransitionFrame]);

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
    if (!isPlaying && project && currentProjectMs >= project.totalProjectDurationMs) {
      setCurrentProjectMs(0);
    }
    setIsPlaying(!isPlaying);
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
    setCurrentProjectMs(clamped);

    if (project) {
      const { item, sourceMs } = mapProjectToSource(clamped, project.items);
      if (item && item.kind === 'SOURCE_CLIP') {
        setActiveMemePlaying(false);
        setIsSecondaryReady(false);
        activeMemeIdRef.current = null;
        loadedSecondaryUrlRef.current = null;
        if (memeVideoRef.current && !memeVideoRef.current.paused) {
          memeVideoRef.current.pause();
        }
        const sec = sourceMs / 1000;
        if (mainVideoRef.current) {
          mainVideoRef.current.currentTime = sec;
          lastSeekTargetRef.current = sourceMs;
        }
        if (denoisedAudioRef.current) {
          denoisedAudioRef.current.currentTime = sec;
        }
      } else if (item && item.kind === 'MEME_CLIP') {
        setActiveMemePlaying(true);
        if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
        if (denoisedAudioRef.current && !denoisedAudioRef.current.paused) denoisedAudioRef.current.pause();
        if (memeVideoRef.current) {
          if (activeMemeIdRef.current !== item.id || loadedSecondaryUrlRef.current !== item.blobUrl) {
            activeMemeIdRef.current = item.id;
            loadedSecondaryUrlRef.current = item.blobUrl;
            setIsSecondaryReady(false);
            memeVideoRef.current.src = item.blobUrl;
          }
          const memeSec = Math.max(0, clamped - item.projectStartMs) / 1000;
          memeVideoRef.current.currentTime = memeSec;
        }
      }

      // Sync background music loop position on seek
      if (bgMusic && bgMusicRef.current) {
        const musicDurSec = Math.max(0.1, bgMusic.durationMs / 1000);
        bgMusicRef.current.currentTime = (clamped / 1000) % musicDurSec;
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

  const handleTrackMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const res = calcTrackTimeAndPct(e.clientX);
    if (!res) return;
    setIsScrubbing(true);
    handleSeek(res.timeMs);
    setHoverTimeMs(res.timeMs);
    setHoverPct(res.pct);
  };

  const handleTrackMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const res = calcTrackTimeAndPct(e.clientX);
    if (!res) return;
    setHoverTimeMs(res.timeMs);
    setHoverPct(res.pct);
    if (isScrubbing) {
      handleSeek(res.timeMs);
    }
  };

  const handleTrackMouseLeave = () => {
    if (!isScrubbing) {
      setHoverTimeMs(null);
      setHoverPct(null);
    }
  };

  // Window listeners during scrubbing
  useEffect(() => {
    if (!isScrubbing) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const res = calcTrackTimeAndPct(e.clientX);
      if (!res) return;
      handleSeek(res.timeMs);
      setHoverTimeMs(res.timeMs);
      setHoverPct(res.pct);
    };

    const handleWindowMouseUp = () => {
      setIsScrubbing(false);
      setHoverTimeMs(null);
      setHoverPct(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
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
        project
      );
      await applyAICommand(command, query);
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Upload Custom Meme with 100 MB and 180s (3 min) validation (Step 1.2)
  const handleCustomMemeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMemeUploadError(null);

    // Validate size (max 100 MB)
    if (file.size > 100 * 1024 * 1024) {
      setMemeUploadError('File exceeds 100 MB limit. Please select a clip up to 100 MB.');
      e.target.value = '';
      return;
    }

    // Validate extension / MIME
    const validExts = ['.mp4', '.webm', '.mov'];
    const hasValidExt = validExts.some(ext => file.name.toLowerCase().endsWith(ext));
    if (!hasValidExt && !file.type.startsWith('video/')) {
      setMemeUploadError('Please select a valid .mp4, .webm, or .mov video file.');
      e.target.value = '';
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
    } catch {
      setMemeUploadError('Failed to read video metadata. Ensure it is a valid video file.');
    } finally {
      e.target.value = '';
    }
  };

  // Dedicated + Add Clip handler for toolbar file input (Step 3.1)
  const handleAddClipFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      alert('File exceeds 100 MB limit. Please select a clip up to 100 MB.');
      e.target.value = '';
      return;
    }

    const validExts = ['.mp4', '.webm', '.mov'];
    const hasValidExt = validExts.some(ext => file.name.toLowerCase().endsWith(ext));
    if (!hasValidExt && !file.type.startsWith('video/')) {
      alert('Please select a valid .mp4, .webm, or .mov video file.');
      e.target.value = '';
      return;
    }

    try {
      const uploaded = await addUploadedMeme(file);
      if (uploaded.durationMs > 180500) {
        removeUploadedMeme(uploaded.id);
        alert(`Clip duration (${(uploaded.durationMs / 1000).toFixed(1)}s) exceeds 3-minute limit.`);
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
      alert('Failed to read video metadata for the uploaded clip.');
    } finally {
      e.target.value = '';
    }
  };

  // Dedicated + Add Music handler for toolbar and timeline music track
  const handleBgMusicFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 30 * 1024 * 1024) {
      alert('Audio file exceeds 30 MB limit. Please select a track under 30 MB.');
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
      finalize(60000);
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

  // InShot-style Adaptive Time Ruler (Item 2)
  // Scaling tick density with timelineZoom:
  // Zoom >= 3.5x: Major ticks every 1s (00:01, 00:02...) with 0.5s minor ticks
  // Zoom >= 2x: Major ticks every 2s (00:02, 00:04...) with 1s minor ticks
  // Zoom < 2x: Major ticks every 5s (00:05, 00:10...) with 1s minor ticks
  const rulerMajorStepSec = timelineZoom >= 3.5 ? 1 : timelineZoom >= 2 ? 2 : 5;
  const rulerMinorStepSec = rulerMajorStepSec === 1 ? 0.5 : 1;
  const totalDurationSec = project.totalProjectDurationMs / 1000;
  const majorTickCount = Math.floor(totalDurationSec / rulerMajorStepSec);
  const minorTickCount = Math.floor(totalDurationSec / rulerMinorStepSec);

  return (
    <div className="h-screen w-screen bg-[#0E0E0D] text-[#F4F2EE] flex flex-col overflow-hidden select-none">
      {/* Top Header */}
      <header className="h-14 border-b border-[#2C2B28] bg-[#161614] px-4 flex items-center justify-between z-20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-[#1F1E1C] border border-[#2C2B28] text-[#E8872A] flex items-center justify-center font-bold text-sm">
            AI
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-[#F4F2EE]">{project.title}</h2>
            <div className="flex items-center space-x-2 text-[11px] text-[#A19E97] tabular-nums">
              <span>{curProjSec}s / {totalProjSec}s</span>
              <span>•</span>
              <span className="text-[#E8872A]">Virtual InShot Playback</span>
            </div>
          </div>
        </div>

        {/* Audio Filter Controls */}
        <div className="flex items-center space-x-2">
          {/* Speaker Voice Enhancement Toggle */}
          <button
            onClick={() => {
              setupWebAudio();
              if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume();
              }
              toggleVoiceEnhance();
            }}
            title="Speaker Voice Enhancement: 90Hz HPF + 280Hz room-echo cut + 2.5kHz vocal clarity boost + anti-hiss roll-off + gentle leveling"
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1.5 border transition-all ${
              voiceEnhanceEnabled
                ? 'bg-[#14B8A6]/15 border-[#2DD4BF]/50 text-[#5EEAD4]'
                : 'bg-[#23221F] border-[#35332F] text-[#8A8780] hover:text-[#E6E3DC]'
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${voiceEnhanceEnabled ? 'text-[#5EEAD4]' : 'text-[#8A8780]'}`} />
            <span>Voice Enhance</span>
            <span className={`text-[10px] px-1 py-0.2 rounded font-mono tabular-nums font-bold ${voiceEnhanceEnabled ? 'bg-[#14B8A6]/25 text-[#5EEAD4]' : 'bg-[#1F1E1C] text-[#8A8780]'}`}>
              {voiceEnhanceEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Background Noise Removal Toggle */}
          <button
            onClick={() => {
              setupWebAudio();
              if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume();
              }
              toggleNoiseRemoval();
            }}
            title={isDenoising ? `Background Noise Removal: ${denoiseProgress || 'Cleaning audio...'}` : "Background Noise Removal: Adaptive STFT Wiener Spectral Denoiser removing ceiling fan noise and room hiss"}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1.5 border transition-all ${
              noiseRemovalEnabled
                ? 'bg-[#14B8A6]/15 border-[#2DD4BF]/50 text-[#5EEAD4]'
                : 'bg-[#23221F] border-[#35332F] text-[#8A8780] hover:text-[#E6E3DC]'
            }`}
          >
            {isDenoising ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#5EEAD4]" />
            ) : (
              <Wand2 className={`w-3.5 h-3.5 ${noiseRemovalEnabled ? 'text-[#5EEAD4]' : 'text-[#8A8780]'}`} />
            )}
            <span>Noise Removal</span>
            <span className={`text-[10px] px-1 py-0.2 rounded font-mono tabular-nums font-bold ${noiseRemovalEnabled ? 'bg-[#14B8A6]/25 text-[#5EEAD4]' : 'bg-[#1F1E1C] text-[#8A8780]'}`}>
              {isDenoising ? 'CLEANING...' : noiseRemovalEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          <div className="h-4 w-[1px] bg-[#2C2B28] mx-1" />

          <button
            onClick={() => setScreen('EXPORT')}
            className="flex items-center space-x-1.5 bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] font-semibold px-4 py-1.5 rounded-lg text-xs transition-colors shadow-none active:scale-95"
          >
            <span>Export Video</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Collapsible Panel: Transcript & Chapters */}
        <div
          className={`border-r border-[#2C2B28] bg-[#161614] flex flex-col transition-all duration-200 z-10 ${
            isLeftOpen ? 'w-80' : 'w-10'
          }`}
        >
          <div className="h-10 border-b border-[#2C2B28] flex items-center justify-between px-3">
            {isLeftOpen ? (
              <div className="flex items-center space-x-2 text-xs">
                <button
                  onClick={() => setLeftTab('transcript')}
                  className={`font-medium pb-0.5 border-b-2 transition-all ${
                    leftTab === 'transcript' ? 'border-[#E8872A] text-[#F4F2EE]' : 'border-transparent text-[#A19E97] hover:text-[#F4F2EE]'
                  }`}
                >
                  Transcript
                </button>
                <button
                  onClick={() => setLeftTab('chapters')}
                  className={`font-medium pb-0.5 border-b-2 transition-all ${
                    leftTab === 'chapters' ? 'border-[#E8872A] text-[#F4F2EE]' : 'border-transparent text-[#A19E97] hover:text-[#F4F2EE]'
                  }`}
                >
                  Chapters
                </button>
              </div>
            ) : null}
            <button
              onClick={() => setIsLeftOpen(!isLeftOpen)}
              className="text-[#A19E97] hover:text-[#F4F2EE] p-1"
            >
              {isLeftOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>

          {isLeftOpen && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              {leftTab === 'transcript' ? (
                <div className="space-y-3">
                  {/* Quality & Mode Controls Bar */}
                  <div className="p-2.5 rounded-lg bg-[#1F1E1C] border border-[#2C2B28] space-y-2">
                    {/* Quality Selector */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#A19E97] font-medium">Quality:</span>
                      <select
                        value={transcriptQuality}
                        onChange={(e) => setTranscriptQuality(e.target.value as any)}
                        disabled={transcriptionStatus === 'downloading_model' || transcriptionStatus === 'transcribing' || transcriptMode === 'transcribe_hinglish'}
                        className="bg-[#161614] border border-[#2C2B28] text-[#F4F2EE] text-[11px] rounded px-2 py-1 focus:outline-none focus:border-[#E8872A] cursor-pointer disabled:opacity-50"
                      >
                        <option value="accurate">Accurate (Small, ~285 MB)</option>
                        <option value="fast">Fast (Base, ~75 MB)</option>
                      </select>
                    </div>

                    {/* Mode Selector */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#A19E97] font-medium">Mode:</span>
                      <select
                        value={transcriptMode}
                        onChange={(e) => setTranscriptMode(e.target.value as any)}
                        disabled={transcriptionStatus === 'downloading_model' || transcriptionStatus === 'transcribing'}
                        className="bg-[#161614] border border-[#2C2B28] text-[#F4F2EE] text-[11px] rounded px-2 py-1 max-w-[175px] truncate focus:outline-none focus:border-[#E8872A] cursor-pointer"
                      >
                        <option value="transcribe_hinglish">Hinglish (Hindi + English)</option>
                        <option value="translate_en">English (translated)</option>
                        <option value="transcribe_en">English (as spoken)</option>
                      </select>
                    </div>

                    <p className="text-[10px] text-[#6E6B64]">
                      First use downloads the model ({transcriptMode === 'transcribe_hinglish' ? 'about 72 MB' : transcriptQuality === 'accurate' ? 'about 285 MB' : 'about 75 MB'}), only once.
                    </p>

                    <div className="flex items-center space-x-2 pt-1">
                      <button
                        type="button"
                        onClick={() => generateTranscript(transcriptQuality, transcriptMode)}
                        disabled={transcriptionStatus === 'downloading_model' || transcriptionStatus === 'transcribing'}
                        className="flex-1 bg-[#E8872A] hover:bg-[#F59A3D] disabled:opacity-50 text-[#11100E] font-semibold py-1.5 px-3 rounded-lg text-xs flex items-center justify-center space-x-1.5 shadow-none transition-all"
                      >
                        {transcriptionStatus === 'downloading_model' ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#11100E]" />
                            <span>Loading model... {transcriptionDownloadPercent}%</span>
                          </>
                        ) : transcriptionStatus === 'transcribing' ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#11100E]" />
                            <span>Transcribing...</span>
                          </>
                        ) : project.transcript.length > 0 && !project.isDemoSample ? (
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
                          className="bg-[#23221F] hover:bg-[#2E2C28] text-[#E6E3DC] p-1.5 rounded-lg border border-[#35332F] transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Fallback Notice if Small model fell back to Base */}
                  {transcriptionFallbackNotice && (
                    <div className="p-2.5 rounded-lg bg-[#D97706]/15 border border-[#F59E0B]/50 text-[#FCD34D] text-[11px] flex items-start space-x-2">
                      <ShieldAlert className="w-4 h-4 flex-shrink-0 text-[#F59E0B] mt-0.5" />
                      <span>{transcriptionFallbackNotice}</span>
                    </div>
                  )}

                  {/* Urdu Script Warning Banner (Requirement 5) */}
                  {project.transcriptionMeta?.hasUrduWarning && (
                    <div className="p-2.5 rounded-lg bg-[#D97706]/15 border border-[#F59E0B]/50 text-[#FCD34D] text-[11px] flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 text-[#F59E0B] mt-0.5" />
                      <span>Output contains Urdu-script text. For a cleaner result use &apos;English (translated)&apos; mode.</span>
                    </div>
                  )}

                  {/* Status Banner: Downloading Model */}
                  {transcriptionStatus === 'downloading_model' && (
                    <div className="p-3 rounded-lg bg-[#1F1E1C] border border-[#2C2B28] space-y-2">
                      <div className="flex items-center justify-between text-xs text-[#F4F2EE] font-medium">
                        <span className="flex items-center space-x-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E8872A]" />
                          <span>Downloading Whisper Model</span>
                        </span>
                        <span className="tabular-nums font-mono">{transcriptionDownloadPercent}%</span>
                      </div>
                      <div className="w-full bg-[#161614] rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-[#E8872A] h-1.5 rounded-full transition-all duration-200"
                          style={{ width: `${transcriptionDownloadPercent}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[#A19E97]">
                        First use downloads the model ({transcriptMode === 'transcribe_hinglish' ? 'about 72 MB' : transcriptQuality === 'accurate' ? 'about 285 MB' : 'about 75 MB'}), only once.
                      </p>
                    </div>
                  )}

                  {/* Status Banner: Transcribing */}
                  {transcriptionStatus === 'transcribing' && (
                    <div className="p-3 rounded-lg bg-[#1F1E1C] border border-[#2C2B28] flex items-center space-x-2.5">
                      <Loader2 className="w-4 h-4 animate-spin text-[#E8872A] flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-[#F4F2EE]">Transcribing speech...</p>
                        <p className="text-[10px] text-[#A19E97]">Running Whisper AI in background Web Worker</p>
                      </div>
                    </div>
                  )}

                  {/* Status Banner: Error */}
                  {transcriptionStatus === 'error' && (
                    <div className="p-3 rounded-lg bg-[#DC2626]/12 border border-[#EF4444]/40 space-y-1.5">
                      <div className="flex items-center space-x-1.5 text-xs font-semibold text-[#F87171]">
                        <AlertCircle className="w-3.5 h-3.5 text-[#F87171] flex-shrink-0" />
                        <span>Transcription Failed</span>
                      </div>
                      <p className="text-[11px] text-[#FCA5A5] leading-snug">{transcriptionError}</p>
                      <button
                        type="button"
                        onClick={() => generateTranscript(transcriptQuality, transcriptMode)}
                        className="text-[10px] text-[#F87171] hover:underline mt-1 font-medium"
                      >
                        Try Again
                      </button>
                    </div>
                  )}

                  {/* Transcript Content List */}
                  {project.transcript.length === 0 && transcriptionStatus === 'idle' ? (
                    <div className="p-4 rounded-xl bg-[#1F1E1C] border border-[#2C2B28] text-center space-y-2">
                      <p className="text-[#F4F2EE] text-xs">No transcript generated yet.</p>
                      <p className="text-[11px] text-[#6E6B64] leading-relaxed">
                        Click &quot;Generate Transcript&quot; above to transcribe using in-browser Whisper AI. First use downloads the model once.
                      </p>
                    </div>
                  ) : project.transcript.length > 0 ? (
                    <div className="space-y-2">
                      {project.transcriptionMeta?.lowQualityWarning && (
                        <div className="p-2.5 rounded-lg bg-[#D97706]/15 border border-[#F59E0B]/50 text-[#FCD34D] text-[11px] flex items-start space-x-2">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-[#F59E0B] mt-0.5" />
                          <span>{project.transcriptionMeta.lowQualityWarning}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-[#A19E97] pb-1 border-b border-[#2C2B28]">
                        <span>Click to seek • Double-click to edit:</span>
                        {addedClipTranscribing ? (
                          <span className="text-[10px] bg-[#1F1E1C] text-[#E8872A] border border-[#E8872A]/40 px-1.5 py-0.5 rounded font-mono flex items-center space-x-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>Transcribing added clip...</span>
                          </span>
                        ) : project.isDemoSample ? (
                          <span className="text-[10px] bg-[#1F1E1C] text-[#FCD34D] border border-[#2C2B28] px-1.5 py-0.2 rounded font-mono">
                            Sample transcript
                          </span>
                        ) : (
                          <span className="text-[10px] bg-[#1F1E1C] text-[#A19E97] border border-[#2C2B28] px-1.5 py-0.2 rounded font-mono">
                            {project.transcriptionMeta?.modelName || (transcriptQuality === 'accurate' ? 'Whisper Small' : 'Whisper Base')} ({project.transcript.length} words)
                          </span>
                        )}
                      </div>

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
                                className="bg-[#0E0E0D] text-[#F4F2EE] font-medium border border-[#E8872A] rounded px-1 py-0.5 text-xs outline-none w-20 inline-block shadow-none"
                              />
                            );
                          }

                          return (
                            <span
                              key={w.id}
                              onClick={() => {
                                if (projMs !== null) {
                                  handleSeek(projMs);
                                } else {
                                  // Jump to next active moment
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
                                  ? 'Word was cut. Click to seek to next active video. (Double-click to edit)'
                                  : `${w.edited ? '[Edited] ' : ''}Source: ${(w.sourceStartMs / 1000).toFixed(1)}s (Double-click to edit)`
                              }
                              className={`inline-block px-1 py-0.5 rounded cursor-pointer transition-colors ${
                                isDeleted
                                  ? 'line-through text-[#6E6B64] bg-[#161614]/50 hover:text-[#A19E97]'
                                  : isCurrent
                                  ? 'bg-[#E8872A]/20 text-[#E8872A] font-bold border border-[#E8872A]/50'
                                  : 'text-[#E6E3DC] hover:bg-[#292825] hover:text-[#F4F2EE]'
                              } ${w.edited ? 'ring-1 ring-[#5EEAD4]/50 bg-[#14B8A6]/10' : ''}`}
                            >
                              {w.word}
                              {w.edited && <span className="text-[9px] text-[#5EEAD4] ml-0.5 font-bold">*</span>}
                            </span>
                          );
                        })}
                      </div>

                      {/* Labels under the transcript (Requirement 7) */}
                      <div className="pt-2.5 mt-2 border-t border-[#2C2B28] text-[11px] text-[#A19E97] space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-[#A19E97] font-mono tabular-nums">
                          <span>
                            {project.transcriptionMeta?.modelName || (transcriptQuality === 'accurate' ? 'Whisper Small' : 'Whisper Base')} ({project.transcriptionMeta?.device || 'WASM'})
                          </span>
                          <span>
                            {project.transcriptionMeta?.durationMs ? `${(project.transcriptionMeta.durationMs / 1000).toFixed(1)}s` : ''}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#A19E97]">
                          Mode:{' '}
                          {
                            (project.transcriptionMeta?.mode || transcriptMode) === 'transcribe_hinglish'
                              ? 'Hinglish (Hindi + English)'
                              : (project.transcriptionMeta?.mode || transcriptMode) === 'transcribe_en'
                              ? 'English (as spoken)'
                              : 'English (translated)'
                          }
                        </div>
                        <p className="text-[10px] text-[#6E6B64] italic">
                          Auto-generated, may contain errors. Double-click a word to fix it.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-[#A19E97] pb-1 border-b border-[#2C2B28]">
                    <span className="font-medium text-[#F4F2EE]">Chapters (Auto-generated, approximate)</span>
                    <span className="text-[10px] text-[#6E6B64] tabular-nums">{project.chapters.length} markers</span>
                  </div>

                  {project.chapters.length === 0 ? (
                    <div className="p-4 rounded-xl bg-[#1F1E1C] border border-[#2C2B28] text-center space-y-2">
                      <Bookmark className="w-5 h-5 text-[#6E6B64] mx-auto" />
                      <p className="text-[#F4F2EE] text-xs">No chapters yet.</p>
                      <p className="text-[11px] text-[#6E6B64] leading-relaxed">
                        Generate a transcript to automatically build chapter timestamps from natural speech pauses and 20s intervals.
                      </p>
                    </div>
                  ) : (
                    project.chapters.map((ch) => {
                      const projMs = mapSourceToProjectMs(ch.sourceMs, project.items);
                      return (
                        <div
                          key={ch.id}
                          onClick={() => {
                            if (projMs !== null) {
                              handleSeek(projMs);
                            } else {
                              const activeItems = project.items.filter(
                                (it) => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME'
                              );
                              const nextActive = activeItems.find((it) => it.sourceStartMs >= ch.sourceMs);
                              if (nextActive) handleSeek(nextActive.projectStartMs);
                            }
                          }}
                          className="p-2 rounded-lg bg-[#1F1E1C] hover:bg-[#292825] border border-[#2C2B28] cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <div className="flex items-center space-x-2 truncate mr-2">
                            <Bookmark className="w-3.5 h-3.5 text-[#E8872A] flex-shrink-0" />
                            <span className="font-medium text-[#F4F2EE] truncate">{ch.title}</span>
                          </div>
                          <span className="text-[10px] text-[#A19E97] font-mono tabular-nums flex-shrink-0">
                            {projMs !== null ? `${(projMs / 1000).toFixed(1)}s` : 'Cut'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Center: Dual-Video Preview Player (Spec 3) */}
        <div className="flex-1 flex flex-col bg-[#0E0E0D] items-center justify-center p-4 relative overflow-hidden">
          {/* Silence Alert Banner if pauses present */}
          {project.items.some(it => it.status === 'SUGGESTED_SILENCE_CUT') && (
            <div className="absolute top-4 left-6 right-6 bg-[#D97706]/15 border border-[#F59E0B]/50 rounded-xl px-4 py-2 flex items-center justify-between text-xs z-20 backdrop-blur">
              <div className="flex items-center space-x-2 text-[#FCD34D]">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 text-[#F59E0B]" />
                <span>
                  <strong>Awkward Pauses Detected:</strong> Review amber intervals on timeline or click to clean up <span className="text-[#A19E97] font-normal text-[11px]">(Experimental — review before accepting; best on low-noise audio)</span>:
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => applyAICommand({
                    action: 'REMOVE_SILENCE',
                    payload: { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 },
                    explanation: 'Removing all detected silence intervals.'
                  })}
                  className="bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] font-semibold px-3 py-1 rounded-lg text-xs transition-colors shadow-none"
                >
                  Accept All Cuts
                </button>
              </div>
            </div>
          )}

          {/* Dual-Video Canvas Frame */}
          <div className="relative w-full max-w-3xl aspect-video bg-black rounded-xl overflow-hidden border border-[#2C2B28] flex items-center justify-center">
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
                className={`w-full h-full object-contain absolute inset-0 ${
                  activeMemePlaying
                    ? 'hidden invisible opacity-0 pointer-events-none z-0'
                    : 'z-10 opacity-100'
                }`}
              />

              {/* Stacked Meme Video Element (Spec 3) */}
              <video
                ref={memeVideoRef}
                playsInline
                onLoadedData={handleSecondaryReady}
                onSeeked={handleSecondaryReady}
                onCanPlay={handleSecondaryReady}
                className={`w-full h-full object-contain absolute inset-0 ${
                  activeMemePlaying
                    ? `z-10 ${isSecondaryReady ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
                    : 'hidden invisible opacity-0 pointer-events-none z-0'
                }`}
              />

              {/* Denoised Audio Element for Spectral Noise Removal */}
              <audio
                ref={denoisedAudioRef}
                src={denoisedAudioUrl || undefined}
                preload="auto"
                playsInline
                className="hidden"
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
                <div className="w-16 h-16 rounded-full bg-[#E8872A] text-[#11100E] flex items-center justify-center shadow-lg transform group-hover:scale-105 transition-all">
                  <Play className="w-8 h-8 fill-[#11100E] translate-x-0.5" />
                </div>
              )}
            </div>
          </div>

          {/* Player Controls Bar */}
          <div className="w-full max-w-3xl flex items-center justify-between mt-3 px-2">
            <div className="flex items-center space-x-3">
              <button
                onClick={togglePlayPause}
                className="w-9 h-9 rounded-lg bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] flex items-center justify-center shadow-none transition-all active:scale-95"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-[#11100E]" /> : <Play className="w-4 h-4 fill-[#11100E] translate-x-0.5" />}
              </button>

              <button
                onClick={() => handleSeek(0)}
                className="p-2 text-[#A19E97] hover:text-[#F4F2EE] transition-colors"
                title="Restart"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <div className="text-xs font-mono tabular-nums text-[#F4F2EE]">
                <span className="font-bold text-[#F4F2EE]">{curProjSec}s</span>
                <span className="text-[#6E6B64]"> / </span>
                <span className="text-[#A19E97]">{totalProjSec}s</span>
              </div>
            </div>

            {/* Editing quick tools */}
            <div className="flex items-center space-x-2">
              <button
                onClick={splitAtPlayhead}
                className="px-3 py-1.5 bg-[#23221F] hover:bg-[#2E2C28] border border-[#35332F] text-[#E6E3DC] rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                title="Split at playhead position"
              >
                <Scissors className="w-3.5 h-3.5 text-[#E8872A]" />
                <span>Split (S)</span>
              </button>

              <button
                onClick={deleteSelected}
                disabled={!selectedItemId}
                className="px-3 py-1.5 bg-[#DC2626]/12 hover:bg-[#DC2626]/20 border border-[#EF4444]/40 text-[#F87171] rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Delete selected clip"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>

              <div className="h-4 w-[1px] bg-[#2C2B28] mx-1" />

              <button
                onClick={undo}
                disabled={undoStack.length === 0}
                className="p-1.5 text-[#A19E97] hover:text-[#F4F2EE] disabled:opacity-30 transition-colors"
                title="Undo"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={redo}
                disabled={redoStack.length === 0}
                className="p-1.5 text-[#A19E97] hover:text-[#F4F2EE] disabled:opacity-30 transition-colors"
                title="Redo"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Collapsible Panel: AI Command Hub */}
        <div
          className={`border-l border-[#2C2B28] bg-[#161614] flex flex-col h-full min-h-0 overflow-hidden transition-all duration-200 z-10 ${
            isRightOpen ? 'w-80' : 'w-10'
          }`}
        >
          <div className="h-10 shrink-0 border-b border-[#2C2B28] flex items-center justify-between px-3">
            <button
              onClick={() => setIsRightOpen(!isRightOpen)}
              className="text-[#A19E97] hover:text-[#F4F2EE] p-1"
            >
              {isRightOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            {isRightOpen && (
              <span className="text-xs font-semibold text-[#F4F2EE] flex items-center space-x-1">
                <Sparkles className="w-3.5 h-3.5 text-[#E8872A]" />
                <span>AI Command Hub</span>
              </span>
            )}
          </div>

          {isRightOpen && (
            <>
              {/* Scrollable Middle Body */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-3 py-2">
                {/* Quick Prompt Chips */}
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-[#A19E97] tracking-wider">Quick Prompts</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Remove silence',
                      'Insert fail meme at 0:05',
                      'Enhance voice',
                      'Add fade transition',
                      'Cut 0:10 to 0:15'
                    ].map((chip) => (
                      <button
                        key={chip}
                        onClick={() => setPromptInput(chip)}
                        className="text-[11px] bg-[#1F1E1C] hover:bg-[#292825] hover:text-[#F4F2EE] text-[#A19E97] px-2 py-1 rounded-md border border-[#2C2B28] transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Meme Reactions Section (Two-Option: Library vs Custom Upload) */}
                <div className="space-y-2 pt-1 border-t border-[#2C2B28]">
                  {/* Section Header with Chevron Toggle & Replace Banner */}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setIsMemeSectionOpen(!isMemeSectionOpen)}
                      className="flex items-center space-x-1.5 hover:text-[#F4F2EE] transition-colors group cursor-pointer"
                    >
                      <Film className="w-3.5 h-3.5 text-[#FDA4AF]" />
                      <span className="text-[10px] uppercase font-bold text-[#A19E97] group-hover:text-[#F4F2EE] tracking-wider">
                        Meme Reactions
                      </span>
                      <ChevronDown
                        className={`w-3 h-3 text-[#A19E97] group-hover:text-[#F4F2EE] transition-transform duration-150 ${
                          isMemeSectionOpen ? 'rotate-0' : '-rotate-90'
                        }`}
                      />
                    </button>
                    {replacingMemeId && (
                      <button
                        onClick={() => setReplacingMemeId(null)}
                        className="text-[10px] text-[#FCD34D] hover:text-white font-medium flex items-center space-x-0.5 bg-[#D97706]/30 px-1.5 py-0.5 rounded border border-[#F59E0B]/50"
                      >
                        <span>Cancel Replace</span>
                        <X className="w-2.5 h-2.5 ml-0.5" />
                      </button>
                    )}
                  </div>

                  {isMemeSectionOpen && (
                    <>
                      {replacingMemeId && (
                        <div className="p-1.5 rounded bg-[#D97706]/15 border border-[#F59E0B]/50 text-[#FCD34D] text-[10px]">
                          Select any meme below to replace the chosen clip
                        </div>
                      )}

                      {/* Segmented Two-Option Toggle */}
                      <div className="flex rounded-lg bg-[#1F1E1C] p-0.5 border border-[#2C2B28] text-[11px]">
                        <button
                          onClick={() => setMemeTab('library')}
                          className={`flex-1 py-1 rounded-md font-medium transition-colors text-center ${
                            memeTab === 'library'
                              ? 'bg-[#14B8A6]/15 border border-[#2DD4BF]/50 text-[#5EEAD4]'
                              : 'text-[#8A8780] hover:text-[#E6E3DC]'
                          }`}
                        >
                          Choose a Meme ({MEME_LIBRARY.length})
                        </button>
                        <button
                          onClick={() => setMemeTab('custom')}
                          className={`flex-1 py-1 rounded-md font-medium transition-colors text-center ${
                            memeTab === 'custom'
                              ? 'bg-[#14B8A6]/15 border border-[#2DD4BF]/50 text-[#5EEAD4]'
                              : 'text-[#8A8780] hover:text-[#E6E3DC]'
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
                            <Search className="w-3 h-3 absolute left-2 top-2 text-[#6E6B64]" />
                            <input
                              type="text"
                              value={memeSearch}
                              onChange={(e) => setMemeSearch(e.target.value)}
                              placeholder="Search memes (e.g. damn, rock, snoop)..."
                              className="w-full bg-[#1F1E1C] border border-[#2C2B28] rounded-lg pl-7 pr-7 py-1 text-[11px] text-[#F4F2EE] placeholder-[#6E6B64] focus:outline-none focus:border-[#E8872A]"
                            />
                            {memeSearch && (
                              <button
                                onClick={() => setMemeSearch('')}
                                className="absolute right-2 top-1.5 text-[#6E6B64] hover:text-[#F4F2EE]"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {/* Meme List */}
                          <div className="max-h-[190px] overflow-y-auto space-y-1.5 pr-1">
                            {filteredMemes.length === 0 ? (
                              <div className="text-[11px] text-[#6E6B64] text-center py-4 italic">
                                No memes match "{memeSearch}"
                              </div>
                            ) : (
                              filteredMemes.map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center justify-between p-1.5 rounded-lg bg-[#1F1E1C] hover:bg-[#292825] border border-[#2C2B28] group transition-all"
                                >
                                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                                    {/* Hover Video Preview */}
                                    <div className="w-12 h-9 rounded bg-black overflow-hidden relative flex-shrink-0 border border-[#2C2B28] group-hover:border-[#45423C]">
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
                                      <span className="absolute bottom-0.5 right-0.5 bg-black/80 px-0.5 py-0.2 text-[7.5px] font-mono tabular-nums text-[#A19E97] rounded leading-none">
                                        {(m.durationMs / 1000).toFixed(1)}s
                                      </span>
                                    </div>

                                    <div className="min-w-0 flex-1 pr-1">
                                      <div className="text-[11px] font-medium text-[#F4F2EE] truncate">
                                        {m.title}
                                      </div>
                                      <div className="text-[9px] text-[#6E6B64] truncate">
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
                                      className="px-2 py-1 bg-[#D97706] hover:bg-[#B45309] text-white rounded text-[10px] font-semibold transition-colors flex-shrink-0"
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
                                      className="px-2 py-1 bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] font-semibold rounded text-[10px] flex items-center space-x-0.5 transition-colors flex-shrink-0"
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
                          {/* 1-Line Helper Step Strip (Step 3.2) */}
                          <div className="px-2 py-1.5 rounded-lg bg-[#1F1E1C] border border-[#2C2B28] text-[10px] text-[#A19E97] flex items-center justify-between font-mono">
                            <span>1. Upload MP4</span>
                            <span className="text-[#6E6B64]">→</span>
                            <span>2. Move red playhead</span>
                            <span className="text-[#6E6B64]">→</span>
                            <span className="text-[#5EEAD4]">3. Click Insert</span>
                          </div>

                          {/* Upload Box */}
                          <label className="border border-dashed border-[#2C2B28] hover:border-[#45423C] bg-[#1F1E1C] hover:bg-[#292825] rounded-lg p-3 flex flex-col items-center justify-center text-center cursor-pointer transition-colors group">
                            <Upload className="w-4 h-4 text-[#E8872A] group-hover:scale-110 transition-transform mb-1" />
                            <span className="text-[11px] font-medium text-[#F4F2EE]">
                              Upload custom .mp4 / .webm clip
                            </span>
                            <span className="text-[9px] text-[#6E6B64] mt-0.5">
                              Max 100 MB • Up to 3 minutes
                            </span>
                            <input
                              type="file"
                              accept="video/mp4,video/webm,video/quicktime"
                              onChange={handleCustomMemeUpload}
                              className="hidden"
                            />
                          </label>

                          {memeUploadError && (
                            <div className="p-1.5 rounded bg-[#DC2626]/12 border border-[#EF4444]/40 text-[#F87171] text-[10px] flex items-center space-x-1">
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              <span>{memeUploadError}</span>
                            </div>
                          )}

                          {/* Uploaded clips list */}
                          <div className="max-h-[190px] overflow-y-auto space-y-1.5 pr-1">
                            {userUploadedClips.length === 0 ? (
                              <div className="text-[10px] text-[#6E6B64] italic text-center py-4 bg-[#1F1E1C] rounded-lg border border-[#2C2B28] p-2">
                                No custom clips yet. Upload an .mp4 clip to insert it into your video!
                              </div>
                            ) : (
                              userUploadedClips.map((clip) => (
                                <div
                                  key={clip.id}
                                  className="flex items-center justify-between p-1.5 rounded-lg bg-[#1F1E1C] hover:bg-[#292825] border border-[#2C2B28] group transition-all"
                                >
                                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                                    {/* Hover Video Preview */}
                                    <div className="w-12 h-9 rounded bg-black overflow-hidden relative flex-shrink-0 border border-[#2C2B28] group-hover:border-[#45423C]">
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
                                      <span className="absolute bottom-0.5 right-0.5 bg-black/80 px-0.5 py-0.2 text-[7.5px] font-mono tabular-nums text-[#A19E97] rounded leading-none">
                                        {(clip.durationMs / 1000).toFixed(1)}s
                                      </span>
                                    </div>

                                    <div className="min-w-0 flex-1 pr-1">
                                      <div className="text-[11px] font-medium text-[#F4F2EE] truncate">
                                        {clip.name}
                                      </div>
                                      <div className="text-[9px] text-[#A19E97] font-mono tabular-nums">
                                        {(clip.durationMs / 1000).toFixed(1)}s
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center space-x-1 flex-shrink-0">
                                    {/* Action Buttons (Step 3.2: Insert at Playhead + Add to End) */}
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
                                        className="px-2 py-1 bg-[#D97706] hover:bg-[#B45309] text-white rounded text-[10px] font-semibold transition-colors"
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
                                          className="px-1.5 py-1 bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] font-semibold rounded text-[10px] flex items-center space-x-0.5 transition-colors"
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
                                          className="px-1.5 py-1 bg-[#23221F] hover:bg-[#2E2C28] text-[#E6E3DC] hover:text-[#F4F2EE] border border-[#35332F] rounded text-[10px] font-medium transition-colors"
                                          title="Append to end of timeline"
                                        >
                                          <span>+ End</span>
                                        </button>
                                      </>
                                    )}

                                    {/* Delete clip button */}
                                    <button
                                      onClick={() => removeUploadedMeme(clip.id)}
                                      className="p-1 text-[#6E6B64] hover:text-[#F87171] transition-colors rounded hover:bg-[#2C2B28]"
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

                {/* Command Execution Log */}
                <div className="space-y-1.5 pt-1 border-t border-[#2C2B28]">
                  <span className="text-[10px] uppercase font-bold text-[#A19E97] tracking-wider">Execution Log</span>
                  <div className="max-h-[110px] overflow-y-auto space-y-1.5 pr-1">
                    {commandLogs.length === 0 ? (
                      <p className="text-[11px] text-[#6E6B64] italic">No AI commands executed yet.</p>
                    ) : (
                      commandLogs.map((log) => (
                        <div
                          key={log.id}
                          className={`p-2 rounded-lg border text-[11px] space-y-1 ${
                            log.status === 'SUCCESS'
                              ? 'bg-[#14B8A6]/10 border-[#2DD4BF]/30 text-[#5EEAD4]'
                              : log.status === 'CLARIFICATION'
                              ? 'bg-[#D97706]/10 border-[#F59E0B]/30 text-[#FCD34D]'
                              : 'bg-[#DC2626]/10 border-[#EF4444]/30 text-[#F87171]'
                          }`}
                        >
                          <div className="font-semibold">{log.rawInput}</div>
                          <div className="text-[#A19E97] text-[10px]">{log.appliedMessage}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Permanently Pinned AI Command Input Bar (Footer) */}
              <div className="shrink-0 border-t border-[#2C2B28] bg-[#161614] p-3">
                <div className="relative">
                  <input
                    type="text"
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCommand()}
                    placeholder='e.g. "Cut from 0:10 to 0:25"'
                    disabled={isAiProcessing}
                    className="w-full bg-[#1F1E1C] border border-[#2C2B28] rounded-lg pl-3 pr-9 py-2 text-xs text-[#F4F2EE] placeholder-[#6E6B64] focus:outline-none focus:border-[#E8872A]"
                  />
                  <button
                    onClick={handleSendCommand}
                    disabled={isAiProcessing || !promptInput.trim()}
                    className="absolute right-1.5 bottom-1.5 p-1.5 rounded-lg bg-[#E8872A] hover:bg-[#F59A3D] text-[#11100E] disabled:opacity-40 transition-colors"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Timeline Section (Spec 1 & Spec 2) */}
      <footer className="h-56 border-t border-[#2C2B28] bg-[#161614] flex flex-col p-3 z-20">
        {/* Timeline Toolbar */}
        <div className="flex flex-wrap items-center justify-between pb-2 text-xs gap-2">
          <div className="flex items-center space-x-3">
            {/* Playback Speed Controls (Item 1) */}
            <div className="flex items-center space-x-1.5">
              <span className="text-[#A19E97] text-[11px] font-medium">Speed:</span>
              {([1, 2, 5] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPreviewSpeed(s)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono tabular-nums font-medium transition-colors ${
                    previewSpeed === s
                      ? 'bg-[#14B8A6]/15 border border-[#2DD4BF]/50 text-[#5EEAD4]'
                      : 'bg-[#23221F] border border-[#35332F] text-[#8A8780] hover:text-[#E6E3DC]'
                  }`}
                >
                  {s}x
                </button>
              ))}
              <span className="text-[10px] text-[#6E6B64] hidden sm:inline">Preview speed only. Export keeps normal speed.</span>
              {previewSpeed === 5 && (
                <span className="text-[10px] text-[#FCD34D] ml-1">
                  (Audio may be muted or distorted at 5x by browser)
                </span>
              )}
            </div>

            {/* Timeline Zoom Controls (Item 1B) */}
            <div className="flex items-center space-x-1.5 pl-3 border-l border-[#2C2B28]">
              <span className="text-[#A19E97] text-[11px] font-medium">Zoom:</span>
              <button
                onClick={zoomOut}
                disabled={timelineZoom <= 1}
                className="w-5 h-5 flex items-center justify-center rounded bg-[#23221F] hover:bg-[#2E2C28] border border-[#35332F] text-[#E6E3DC] text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                title="Zoom Out Timeline (-)"
              >
                -
              </button>
              <span className="text-[11px] font-mono tabular-nums text-[#F4F2EE] w-7 text-center">{timelineZoom}x</span>
              <button
                onClick={zoomIn}
                disabled={timelineZoom >= 5}
                className="w-5 h-5 flex items-center justify-center rounded bg-[#23221F] hover:bg-[#2E2C28] border border-[#35332F] text-[#E6E3DC] text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                title="Zoom In Timeline (+)"
              >
                +
              </button>
            </div>

            {/* Silence Detection Sensitivity (Item 2) */}
            <div className="flex items-center space-x-1.5 pl-3 border-l border-[#2C2B28]">
              <span className="text-[#A19E97] text-[11px] font-medium">Sensitivity:</span>
              <select
                value={silenceSensitivity === 'Tight' ? 'Sensitive' : silenceSensitivity === 'Gentle' ? 'Strict' : silenceSensitivity}
                onChange={(e) => setSilenceSensitivity(e.target.value as SilenceSensitivity)}
                className="bg-[#1F1E1C] text-[#F4F2EE] border border-[#2C2B28] rounded px-1.5 py-0.5 text-[11px]"
                title="Sensitive: >=350ms (base drop 5.0dB) | Normal: >=500ms (base drop 7.0dB) | Strict: >=900ms (base drop 9.5dB)"
              >
                <option value="Sensitive">Sensitive (350ms)</option>
                <option value="Normal">Normal (500ms)</option>
                <option value="Strict">Strict (900ms)</option>
              </select>
              <button
                onClick={async () => {
                  const effectiveSens = silenceSensitivity === 'Tight' ? 'Sensitive' : silenceSensitivity === 'Gentle' ? 'Strict' : silenceSensitivity;
                  const res = await detectSilencesOnly(effectiveSens);
                  const cfg = SILENCE_PRESETS[effectiveSens] || SILENCE_PRESETS.Normal;
                  addCommandLog({
                    id: `cmd_${Date.now()}`,
                    rawInput: `Detect pauses (${effectiveSens} mode)`,
                    timestamp: Date.now(),
                    parsedCommand: {
                      action: 'REMOVE_SILENCE',
                      payload: { minDurationMs: cfg.minSilenceMs, paddingPreMs: cfg.prePaddingMs, paddingPostMs: cfg.postPaddingMs },
                      explanation: res.message
                    },
                    status: res.count > 0 ? 'SUCCESS' : 'WARNING',
                    appliedMessage: res.message
                  });
                }}
                className="px-2 py-0.5 bg-[#D97706]/20 hover:bg-[#D97706]/35 border border-[#F59E0B]/60 text-[#FCD34D] rounded text-[11px] font-medium transition-colors flex items-center space-x-1.5"
                title="Experimental: works best on quiet/low-noise recordings. For noisy audio, use Split (S) or Cut commands."
              >
                <span>Detect Silences</span>
                <span className="bg-[#D97706]/15 border border-[#F59E0B]/40 text-[#FCD34D] text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium">
                  Experimental
                </span>
              </button>
              <button
                onClick={() => addClipInputRef.current?.click()}
                className="px-2 py-0.5 bg-[#23221F] hover:bg-[#2E2C28] text-[#E6E3DC] hover:text-[#F4F2EE] border border-[#35332F] rounded text-[11px] font-medium transition-colors flex items-center space-x-1"
                title="Add an extra video clip to the end of the timeline (up to 3 min / 100 MB)"
              >
                <Plus className="w-3 h-3 text-[#E8872A]" />
                <span>+ Add Clip</span>
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
                className="px-2 py-0.5 bg-[#23221F] hover:bg-[#2E2C28] text-[#E6E3DC] hover:text-[#F4F2EE] border border-[#35332F] rounded text-[11px] font-medium transition-colors flex items-center space-x-1"
                title="Add background music track (.mp3, .wav, .m4a, .aac, .ogg up to 30 MB)"
              >
                <Music className="w-3 h-3 text-[#2DD4BF]" />
                <span>+ Add Music</span>
              </button>
              <input
                ref={bgMusicInputRef}
                type="file"
                accept="audio/mp3,audio/mpeg,audio/wav,audio/x-wav,audio/m4a,audio/x-m4a,audio/aac,audio/ogg"
                onChange={handleBgMusicFileInput}
                className="hidden"
              />
            </div>

            {/* Thumbnail Generation Progress (Item 1) */}
            {thumbnailProgress && !thumbnailProgress.done && (
              <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-[#1F1E1C] border border-[#2C2B28] text-[#5EEAD4] text-[10px] animate-pulse">
                <div className="w-1.5 h-1.5 rounded-full bg-[#5EEAD4] animate-ping" />
                <span>Generating frames {thumbnailProgress.current}/{thumbnailProgress.total}</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center space-x-4 text-[11px] text-[#A19E97]">
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#3A3833] border border-[#45423C] inline-block" />
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
              <span className="w-2.5 h-2.5 rounded-sm bg-[#2DD4BF] inline-block" />
              <span>Music</span>
            </div>
          </div>
        </div>

        {/* Timeline Track Area (Horizontally Scrollable) */}
        <div
          ref={timelineContainerRef}
          className="flex-1 bg-[#0E0E0D] rounded-xl border border-[#2C2B28] relative overflow-x-auto overflow-y-hidden p-2"
        >
          {/* Inner scalable track container */}
          <div
            ref={trackContainerRef}
            style={{ width: `${timelineZoom * 100}%`, minWidth: '100%' }}
            onMouseDown={handleTrackMouseDown}
            onMouseMove={handleTrackMouseMove}
            onMouseLeave={handleTrackMouseLeave}
            className="relative h-full flex flex-col justify-between cursor-pointer select-none pt-6 pb-1"
          >
            {/* Floating Scrub / Hover Time Readout (Item 2) */}
            {(isScrubbing || hoverPct !== null) && (
              <div
                style={{
                  left: `${isScrubbing ? (project.totalProjectDurationMs > 0 ? (currentProjectMs / project.totalProjectDurationMs) * 100 : 0) : (hoverPct ?? 0)}%`
                }}
                className="absolute top-0 transform -translate-x-1/2 z-40 pointer-events-none flex flex-col items-center"
              >
                <div className="bg-[#1F1E1C] border border-[#E8872A] text-[#E8872A] font-mono tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap">
                  {formatReadout(isScrubbing ? currentProjectMs : (hoverTimeMs ?? currentProjectMs))}
                </div>
                <div className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-[#E8872A]" />
              </div>
            )}

            {/* Thin Time Ruler Row (Item 2) */}
            <div className="w-full h-5 border-b border-[#2C2B28] relative font-mono tabular-nums text-[9px] text-[#6E6B64] select-none pointer-events-none">
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
                    className="absolute bottom-0 h-1.5 w-[1px] bg-[#2C2B28] transform -translate-x-1/2"
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
                    <span className="leading-none text-[8.5px] text-[#6E6B64] font-mono tabular-nums">{mm}:{ss}</span>
                    <div className="h-2 w-[1px] bg-[#35332F] mt-auto" />
                  </div>
                );
              })}
            </div>

            {/* Red Playhead Line */}
            <div
              style={{
                left: `${project.totalProjectDurationMs > 0 ? (currentProjectMs / project.totalProjectDurationMs) * 100 : 0}%`
              }}
              className="absolute top-6 bottom-0 w-[2px] bg-[#EF4444] z-30 pointer-events-none"
            >
              <div className="w-3 h-3 bg-[#EF4444] transform -translate-x-1/2 -translate-y-1 rotate-45 rounded-sm shadow-md" />
              <div className="absolute top-0 transform -translate-x-1/2 -translate-y-4 px-1 rounded bg-[#EF4444] text-white font-mono tabular-nums text-[8px] font-bold shadow pointer-events-none whitespace-nowrap">
                {formatReadout(currentProjectMs)}
              </div>
            </div>

            {/* Timeline Items Track */}
            <div className="w-full h-12 flex items-center space-x-1 relative mt-1">
              {project.items.map((item) => {
                const isSelected = selectedItemId === item.id;

                if (item.status === 'DELETED') {
                  return null;
                }

                const durPct = project.totalProjectDurationMs > 0
                  ? Math.max(1, (item.durationMs / project.totalProjectDurationMs) * 100)
                  : 10;

                const isSilence = item.status === 'SUGGESTED_SILENCE_CUT';
                const isAddedVideoClip = !isSilence && (
                  (item.kind === 'MEME_CLIP' && (!!item.meta?.isAddedClip || (item.id.startsWith('clip_') && !item.meta?.memeCategory?.startsWith('meme_')))) ||
                  (item.kind === 'SOURCE_CLIP' && item.blobUrl !== project.sourceVideoUrl)
                );
                const isMeme = item.kind === 'MEME_CLIP' && !isAddedVideoClip;
                const isDraggable = item.status === 'ACTIVE';
                const clipThumbs = clipFilmstrips[item.blobUrl] || (item.kind === 'SOURCE_CLIP' ? thumbnails : null);
                const hasClipThumbnails = !!clipThumbs && Object.keys(clipThumbs).length > 0;
                const isNarrow = item.durationMs < 2000;
                const isHighZoom = timelineZoom >= 3;
                const frameIntervalMs = isHighZoom ? 500 : 1000;
                const tileCount = Math.max(1, Math.round(item.durationMs / frameIntervalMs));

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
                    style={{ width: `${durPct}%`, minWidth: '38px' }}
                    title={`${item.title} (${(item.durationMs / 1000).toFixed(1)}s)${isDraggable ? ' • Drag to reorder' : ''}`}
                    className={`h-11 rounded-lg px-2 py-1 flex flex-col justify-between transition-all relative select-none cursor-pointer ${
                      draggedItemId === item.id ? 'opacity-50' : 'opacity-100'
                    } ${
                      isSelected
                        ? 'ring-2 ring-[#E8872A] border-transparent shadow-md'
                        : 'border border-[#2C2B28]'
                    } ${
                      isSilence
                        ? 'bg-[#D97706]/25 border border-[#F59E0B]/70 text-[#FCD34D] hover:bg-[#D97706]/35'
                        : isMeme
                        ? replacingMemeId === item.id
                          ? 'bg-[#E11D48]/35 text-[#FDA4AF] ring-2 ring-[#E8872A] animate-pulse shadow-lg border border-[#FB7185]/80'
                          : 'bg-[#E11D48]/20 border border-[#FB7185]/60 text-[#FDA4AF] hover:bg-[#E11D48]/30'
                        : 'bg-[#22211E] text-[#F4F2EE] border border-[#3A3833] hover:border-[#45423C]'
                    }`}
                  >
                    {/* Amber Drop Indicator Lines (Step 2.4) */}
                    {dropTarget?.id === item.id && dropTarget.position === 'before' && (
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#E8872A] z-40 shadow-[0_0_8px_rgba(232,135,42,0.9)] pointer-events-none rounded-l" />
                    )}
                    {dropTarget?.id === item.id && dropTarget.position === 'after' && (
                      <div className="absolute right-0 top-0 bottom-0 w-[3px] bg-[#E8872A] z-40 shadow-[0_0_8px_rgba(232,135,42,0.9)] pointer-events-none rounded-r" />
                    )}

                    {/* Filmstrip Frame Thumbnails (Item 1) */}
                    {hasClipThumbnails && !isSilence && !isMeme && (
                      <div className="absolute inset-0 flex flex-row overflow-hidden pointer-events-none opacity-85 rounded-lg">
                        {Array.from({ length: tileCount }).map((_, tileIdx) => {
                          const tileSourceMs = item.sourceStartMs + (tileIdx * item.durationMs) / tileCount;
                          const nearestMs = Math.round(tileSourceMs / 500) * 500;
                          const frameUrl = (clipThumbs && (clipThumbs[nearestMs] || clipThumbs[Math.floor(tileSourceMs / 1000) * 1000] || clipThumbs[0])) || '';
                          return (
                            <div
                              key={tileIdx}
                              className="flex-1 h-full bg-cover bg-center border-r border-black/25"
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
                            className="cursor-grab active:cursor-grabbing text-[#8A8780] hover:text-[#F4F2EE] mr-1 flex-shrink-0"
                            title="Grab and drag to move clip before or after other clips"
                          >
                            <GripVertical className="w-3 h-3" />
                          </span>
                        )}
                        <span className="text-[11px] font-semibold truncate drop-shadow-md">
                          {isMeme
                            ? `🎬 ${item.title}`
                            : isNarrow && !isSilence
                            ? ''
                            : item.title}
                        </span>
                      </div>

                      {isSilence && (
                        <div
                          className="flex items-center space-x-1"
                          draggable={false}
                          onDragStart={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => acceptSilenceCut(item.id)}
                            className="p-1 bg-[#DC2626]/80 hover:bg-[#DC2626] rounded text-white"
                            title="Accept Silence Cut"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => keepSilencePause(item.id)}
                            className="p-1 bg-[#23221F] hover:bg-[#2E2C28] text-[#E6E3DC] border border-[#35332F] rounded"
                            title="Keep Pause"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {isMeme && (
                        <div
                          className="flex items-center space-x-1"
                          draggable={false}
                          onDragStart={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setReplacingMemeId(replacingMemeId === item.id ? null : item.id);
                              setIsRightOpen(true);
                              setIsMemeSectionOpen(true);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                              replacingMemeId === item.id
                                ? 'bg-[#E8872A] text-[#11100E] font-bold shadow'
                                : 'bg-[#1F1E1C] hover:bg-[#292825] text-[#FDA4AF] border border-[#FB7185]/40'
                            }`}
                            title="Replace this meme with another from library or upload"
                          >
                            {replacingMemeId === item.id ? 'Cancel' : 'Replace'}
                          </button>
                          <button
                            onClick={() => removeMemeClip(item.id)}
                            className="p-1 bg-[#1F1E1C] hover:bg-[#DC2626]/80 text-[#FDA4AF] hover:text-white rounded border border-[#FB7185]/40 transition-colors"
                            title="Remove this meme and restore continuous video"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="relative z-10 flex items-center justify-between text-[10px] text-[#A19E97] font-mono tabular-nums drop-shadow-sm">
                      <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                      {item.transitionOut && item.transitionOut.type !== 'none' && (
                        <span className="bg-black/60 px-1 rounded uppercase text-[9px] text-[#A19E97]">
                          {item.transitionOut.type}
                        </span>
                      )}
                    </div>

                    {/* Transition Picker Diamond / Badge (Step 3.3) */}
                    <div
                      draggable={false}
                      onDragStart={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const types: TransitionType[] = ['none', 'fade', 'dissolve', 'wipeleft', 'slideup'];
                        const curIdx = types.indexOf(item.transitionOut?.type || 'none');
                        const nextType = types[(curIdx + 1) % types.length];
                        setTransition(item.id, nextType);
                      }}
                      className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 rounded-full flex items-center justify-center text-[8px] z-20 shadow cursor-pointer transition-all ${
                        item.transitionOut && item.transitionOut.type !== 'none'
                          ? 'bg-[#29180B] border border-[#E8872A] text-[#E8872A] hover:bg-[#3D2310] scale-110'
                          : 'bg-[#1F1E1C] border border-[#35332F] hover:border-[#E8872A] text-[#A19E97] hover:text-[#E8872A]'
                      }`}
                      title={`Click to toggle clip transition (Fade / None) - Current: ${item.transitionOut?.type || 'none'}`}
                    >
                      {item.transitionOut && item.transitionOut.type !== 'none' && (
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 px-1 py-0.2 rounded bg-[#E8872A] text-[#11100E] font-bold text-[8px] uppercase tracking-wider shadow whitespace-nowrap pointer-events-none">
                          {item.transitionOut.type}
                        </span>
                      )}
                      <span>⧖</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Background Music Track (Slim Track Bar) */}
            <div className="w-full h-8 mt-2 flex items-center">
              {bgMusic ? (
                <div className="w-full h-full bg-[#14B8A6]/10 border border-[#2DD4BF]/35 rounded-lg px-2.5 flex items-center justify-between text-xs transition-all">
                  <div className="flex items-center space-x-2 min-w-0 mr-3">
                    <Music className="w-3.5 h-3.5 text-[#2DD4BF] shrink-0" />
                    <span className="font-medium text-[#2DD4BF] truncate text-[11px]" title={bgMusic.name}>
                      {bgMusic.name}
                    </span>
                    <span className="text-[10px] text-[#A19E97] font-mono shrink-0">
                      ({(bgMusic.durationMs / 1000).toFixed(1)}s loop)
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    {/* Volume Slider */}
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => toggleBgMusicMute()}
                        className="text-[#A19E97] hover:text-[#F4F2EE] transition-colors p-0.5"
                        title={bgMusic.isMuted || bgMusic.volume === 0 ? "Unmute music" : "Mute music"}
                      >
                        {bgMusic.isMuted || bgMusic.volume === 0 ? (
                          <VolumeX className="w-3.5 h-3.5 text-[#EF4444]" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-[#2DD4BF]" />
                        )}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={bgMusic.isMuted ? 0 : bgMusic.volume}
                        onChange={(e) => setBgMusicVolume(parseFloat(e.target.value))}
                        className="w-16 h-1 bg-[#2C2B28] accent-[#2DD4BF] rounded-lg cursor-pointer"
                        title={`Music Volume: ${Math.round(bgMusic.volume * 100)}%`}
                      />
                      <span className="text-[10px] font-mono tabular-nums text-[#A19E97] w-7">
                        {bgMusic.isMuted ? '0%' : `${Math.round(bgMusic.volume * 100)}%`}
                      </span>
                    </div>

                    {/* Replace Button */}
                    <button
                      onClick={() => bgMusicInputRef.current?.click()}
                      className="px-2 py-0.5 bg-[#1F1E1C] hover:bg-[#2A2825] border border-[#35332F] text-[#E6E3DC] rounded text-[10px] font-medium transition-colors"
                      title="Replace music track"
                    >
                      Replace
                    </button>

                    {/* Remove Button */}
                    <button
                      onClick={() => removeBgMusic()}
                      className="p-1 text-[#A19E97] hover:text-[#EF4444] transition-colors"
                      title="Remove background music track"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => bgMusicInputRef.current?.click()}
                  className="w-full h-full border border-dashed border-[#2C2B28] hover:border-[#2DD4BF]/50 bg-[#161614]/50 hover:bg-[#14B8A6]/5 rounded-lg px-3 flex items-center justify-center space-x-2 text-[11px] text-[#8A8780] hover:text-[#2DD4BF] transition-all group"
                  title="Click to add a background music track (.mp3, .wav, .m4a, .aac, .ogg)"
                >
                  <Music className="w-3 h-3 text-[#6E6B64] group-hover:text-[#2DD4BF] transition-colors" />
                  <span>+ Add Background Music track (.mp3, .wav, .m4a, up to 30 MB)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
