import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Scissors, Trash2, VolumeX,
  Sparkles, Send, Upload, ChevronRight, ChevronLeft, ArrowRight,
  Bookmark, Check, X, Wand2, ShieldAlert, Download,
  Loader2, AlertCircle, RefreshCw
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { mapProjectToSource, mapSourceToProjectMs } from '../utils/timelineMath';
import { parseCommandWithFallback } from '../utils/commandParser';
import { TransitionType } from '../types/edl';
import { SilenceSensitivity, SILENCE_PRESETS } from '../utils/silenceDetector';
import { downloadTranscriptAsTxt } from '../utils/transcriptParser';

export const Screen2Workspace: React.FC = () => {
  const {
    project,
    currentProjectMs,
    isPlaying,
    previewSpeed,
    timelineZoom,
    silenceSensitivity,
    thumbnails,
    thumbnailProgress,
    selectedItemId,
    commandLogs,
    voiceEnhanceEnabled,
    noiseRemovalEnabled,
    isAudioBypassed,
    undoStack,
    redoStack,
    transcriptionStatus,
    transcriptionDownloadPercent,
    transcriptionError,
    transcriptionFallbackNotice,
    transcriptQuality,
    transcriptMode,
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
    suggestNonSpeechSilences,
    setSelectedItemId,
    splitAtPlayhead,
    deleteSelected,
    acceptSilenceCut,
    keepSilencePause,
    detectSilencesOnly,
    setTransition,
    toggleVoiceEnhance,
    toggleNoiseRemoval,
    toggleAudioBypass,
    undo,
    redo,
    addCustomMeme,
    applyAICommand,
    addCommandLog
  } = useEditorStore();

  // Dual Video Elements (Spec 3)
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const memeVideoRef = useRef<HTMLVideoElement | null>(null);

  // RAF synchronization & Seek Loop Guard
  const rafIdRef = useRef<number | null>(null);
  const lastSeekTargetRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number | null>(null);
  const activeMemeIdRef = useRef<string | null>(null);

  // Web Audio Context WeakMap Guard (Spec 4: single attachment per element in StrictMode)
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceAttachedRef = useRef<boolean>(false);

  // Background Noise Removal stage refs
  const nrHighPassRef = useRef<BiquadFilterNode | null>(null);
  const nrLowPassRef = useRef<BiquadFilterNode | null>(null);
  const nrGateGainRef = useRef<GainNode | null>(null);
  const nrAnalyserRef = useRef<AnalyserNode | null>(null);
  const nrAnalyserBufferRef = useRef<Float32Array | null>(null);

  // Speaker Voice Enhancement stage refs
  const veHighPassRef = useRef<BiquadFilterNode | null>(null);
  const veWarmthCutRef = useRef<BiquadFilterNode | null>(null);
  const vePresenceBoostRef = useRef<BiquadFilterNode | null>(null);
  const veCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const veMakeupGainRef = useRef<GainNode | null>(null);

  // Effective audio processing states considering A/B Bypass
  const effectiveVoiceEnhance = !isAudioBypassed && voiceEnhanceEnabled;
  const effectiveNoiseRemoval = !isAudioBypassed && noiseRemovalEnabled;

  // UI state
  const [activeTransitionClass, setActiveTransitionClass] = useState<string>('');
  const [promptInput, setPromptInput] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [leftTab, setLeftTab] = useState<'transcript' | 'chapters'>('transcript');
  const [isLeftOpen, setIsLeftOpen] = useState<boolean>(true);
  const [isRightOpen, setIsRightOpen] = useState<boolean>(true);
  const [activeMemePlaying, setActiveMemePlaying] = useState<boolean>(false);

  // Timeline scrubbing & hover state (Item 2)
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  // Editable transcript word state
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editingWordText, setEditingWordText] = useState<string>('');

  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const trackContainerRef = useRef<HTMLDivElement | null>(null);

  // Setup Web Audio Node Chain on user gesture or mount
  const setupWebAudio = useCallback(() => {
    if (!mainVideoRef.current || audioSourceAttachedRef.current) return;

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      audioContextRef.current = ctx;

      const source = ctx.createMediaElementSource(mainVideoRef.current);

      // --- Stage 1: Background Noise Removal Chain ---
      // 1. High-pass filter at 100 Hz (transparent at 10 Hz when OFF)
      const nrHighPass = ctx.createBiquadFilter();
      nrHighPass.type = 'highpass';
      nrHighPass.frequency.value = effectiveNoiseRemoval ? 100 : 10;
      nrHighPass.Q.value = 0.7071;
      nrHighPassRef.current = nrHighPass;

      // 2. Low-pass filter at 7500 Hz (transparent at 22050 Hz when OFF)
      const nrLowPass = ctx.createBiquadFilter();
      nrLowPass.type = 'lowpass';
      nrLowPass.frequency.value = effectiveNoiseRemoval ? 7500 : 22050;
      nrLowPass.Q.value = 0.7071;
      nrLowPassRef.current = nrLowPass;

      // 3. RMS Noise-Floor Gate Gain Node
      const nrGateGain = ctx.createGain();
      nrGateGain.gain.value = 1.0;
      nrGateGainRef.current = nrGateGain;

      // 4. Analyser Node for noise-floor monitoring (fftSize = 512)
      const nrAnalyser = ctx.createAnalyser();
      nrAnalyser.fftSize = 512;
      nrAnalyserRef.current = nrAnalyser;
      nrAnalyserBufferRef.current = new Float32Array(512);

      // --- Stage 2: Speaker Voice Enhancement Chain ---
      // 1. High-pass filter at 80 Hz (transparent at 10 Hz when OFF)
      const veHighPass = ctx.createBiquadFilter();
      veHighPass.type = 'highpass';
      veHighPass.frequency.value = effectiveVoiceEnhance ? 80 : 10;
      veHighPass.Q.value = 0.7071;
      veHighPassRef.current = veHighPass;

      // 2. Warmth cut: peaking filter at 250 Hz, Q = 1.2, -2 dB (0 dB when OFF)
      const veWarmthCut = ctx.createBiquadFilter();
      veWarmthCut.type = 'peaking';
      veWarmthCut.frequency.value = 250;
      veWarmthCut.Q.value = 1.2;
      veWarmthCut.gain.value = effectiveVoiceEnhance ? -2 : 0;
      veWarmthCutRef.current = veWarmthCut;

      // 3. Vocal presence boost: peaking filter at 3000 Hz, Q = 1.4, +4 dB (0 dB when OFF)
      const vePresenceBoost = ctx.createBiquadFilter();
      vePresenceBoost.type = 'peaking';
      vePresenceBoost.frequency.value = 3000;
      vePresenceBoost.Q.value = 1.4;
      vePresenceBoost.gain.value = effectiveVoiceEnhance ? 4 : 0;
      vePresenceBoostRef.current = vePresenceBoost;

      // 4. Dynamics Compressor (ratio 4:1, threshold -20, knee 18, attack 0.005, release 0.15)
      // When OFF: ratio 1:1, threshold 0 (linear bypass)
      const veCompressor = ctx.createDynamicsCompressor();
      veCompressor.threshold.value = effectiveVoiceEnhance ? -20 : 0;
      veCompressor.knee.value = 18;
      veCompressor.ratio.value = effectiveVoiceEnhance ? 4 : 1;
      veCompressor.attack.value = 0.005;
      veCompressor.release.value = 0.15;
      veCompressorRef.current = veCompressor;

      // 5. Makeup Gain: 1.25 when ON, 1.0 when OFF
      const veMakeupGain = ctx.createGain();
      veMakeupGain.gain.value = effectiveVoiceEnhance ? 1.25 : 1.0;
      veMakeupGainRef.current = veMakeupGain;

      // Audio Graph Connections:
      // source -> nrHighPass -> nrLowPass -> nrGateGain
      source.connect(nrHighPass);
      nrHighPass.connect(nrLowPass);
      nrLowPass.connect(nrGateGain);

      // Connect lowpass to analyser for speech energy calculation
      nrLowPass.connect(nrAnalyser);

      // nrGateGain -> veHighPass -> veWarmthCut -> vePresenceBoost -> veCompressor -> veMakeupGain -> ctx.destination
      nrGateGain.connect(veHighPass);
      veHighPass.connect(veWarmthCut);
      veWarmthCut.connect(vePresenceBoost);
      vePresenceBoost.connect(veCompressor);
      veCompressor.connect(veMakeupGain);
      veMakeupGain.connect(ctx.destination);

      audioSourceAttachedRef.current = true;
    } catch {
      // Audio element might already be connected or blocked
    }
  }, [effectiveNoiseRemoval, effectiveVoiceEnhance]);

  // Dynamically update audio node parameters when store toggles or A/B Bypass changes
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;

    // --- Background Noise Removal Stage ---
    if (nrHighPassRef.current) {
      nrHighPassRef.current.frequency.setTargetAtTime(effectiveNoiseRemoval ? 100 : 10, now, 0.015);
    }
    if (nrLowPassRef.current) {
      nrLowPassRef.current.frequency.setTargetAtTime(effectiveNoiseRemoval ? 7500 : 22050, now, 0.015);
    }
    if (!effectiveNoiseRemoval && nrGateGainRef.current) {
      nrGateGainRef.current.gain.setTargetAtTime(1.0, now, 0.01);
    }

    // --- Speaker Voice Enhancement Stage ---
    if (veHighPassRef.current) {
      veHighPassRef.current.frequency.setTargetAtTime(effectiveVoiceEnhance ? 80 : 10, now, 0.015);
    }
    if (veWarmthCutRef.current) {
      veWarmthCutRef.current.gain.setTargetAtTime(effectiveVoiceEnhance ? -2 : 0, now, 0.015);
    }
    if (vePresenceBoostRef.current) {
      vePresenceBoostRef.current.gain.setTargetAtTime(effectiveVoiceEnhance ? 4 : 0, now, 0.015);
    }
    if (veCompressorRef.current) {
      veCompressorRef.current.ratio.setTargetAtTime(effectiveVoiceEnhance ? 4 : 1, now, 0.015);
      veCompressorRef.current.threshold.setTargetAtTime(effectiveVoiceEnhance ? -20 : 0, now, 0.015);
    }
    if (veMakeupGainRef.current) {
      veMakeupGainRef.current.gain.setTargetAtTime(effectiveVoiceEnhance ? 1.25 : 1.0, now, 0.015);
    }
  }, [effectiveVoiceEnhance, effectiveNoiseRemoval]);

  // Apply playback speed to video elements
  const applyPlaybackSpeed = useCallback((speed: number) => {
    if (mainVideoRef.current) {
      mainVideoRef.current.playbackRate = speed;
      mainVideoRef.current.preservesPitch = true;
    }
    if (memeVideoRef.current) {
      memeVideoRef.current.playbackRate = speed;
      memeVideoRef.current.preservesPitch = true;
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
          } else {
            setIsPlaying(false);
            lastTickTimeRef.current = null;
          }
          rafIdRef.current = requestAnimationFrame(loop);
          return;
        }

        // Check if playing a MEME clip
        if (item.kind === 'MEME_CLIP') {
          setActiveMemePlaying(true);
          if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();

          if (memeVideoRef.current) {
            if (memeVideoRef.current.playbackRate !== previewSpeed) {
              memeVideoRef.current.playbackRate = previewSpeed;
              memeVideoRef.current.preservesPitch = true;
            }
            if (activeMemeIdRef.current !== item.id) {
              activeMemeIdRef.current = item.id;
              memeVideoRef.current.src = item.blobUrl;
              memeVideoRef.current.playbackRate = previewSpeed;
              memeVideoRef.current.preservesPitch = true;
              memeVideoRef.current.currentTime = (sourceMs - item.sourceStartMs) / 1000;
              memeVideoRef.current.play().catch(() => {});
            }
          }
        } else {
          // SOURCE_CLIP
          setActiveMemePlaying(false);
          if (memeVideoRef.current && !memeVideoRef.current.paused) {
            memeVideoRef.current.pause();
            activeMemeIdRef.current = null;
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

            // Smooth RMS Noise-Floor Gate during active playback
            if (
              effectiveNoiseRemoval &&
              nrAnalyserRef.current &&
              nrGateGainRef.current &&
              nrAnalyserBufferRef.current &&
              audioContextRef.current
            ) {
              const buffer = nrAnalyserBufferRef.current;
              nrAnalyserRef.current.getFloatTimeDomainData(buffer as any);
              let sumSq = 0;
              for (let i = 0; i < buffer.length; i++) {
                sumSq += buffer[i] * buffer[i];
              }
              const rms = Math.sqrt(sumSq / buffer.length);
              const now = audioContextRef.current.currentTime;

              if (rms < 0.015) {
                // Smoothly duck gateGain down to 0.15 (40ms release)
                nrGateGainRef.current.gain.setTargetAtTime(0.15, now, 0.04);
              } else {
                // Snap back to 1.0 (10ms attack) as soon as speech starts
                nrGateGainRef.current.gain.setTargetAtTime(1.0, now, 0.01);
              }
            }
          }
        }

        // Check for transition trigger near cut boundary
        if (item.transitionOut && item.transitionOut.type !== 'none') {
          const distToEnd = item.projectEndMs - nextProjectMs;
          if (distToEnd > 0 && distToEnd <= item.transitionOut.durationMs) {
            const cls = `transition-${item.transitionOut.type}`;
            if (activeTransitionClass !== cls) {
              setActiveTransitionClass(cls);
            }
          } else if (activeTransitionClass) {
            setActiveTransitionClass('');
          }
        } else if (activeTransitionClass) {
          setActiveTransitionClass('');
        }

        setCurrentProjectMs(nextProjectMs);
      } else {
        // Paused: halt both video players and reset gate gain
        lastTickTimeRef.current = null;
        if (nrGateGainRef.current && audioContextRef.current) {
          nrGateGainRef.current.gain.setTargetAtTime(1.0, audioContextRef.current.currentTime, 0.01);
        }
        if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
        if (memeVideoRef.current && !memeVideoRef.current.paused) memeVideoRef.current.pause();
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying, currentProjectMs, project, activeTransitionClass, previewSpeed, effectiveNoiseRemoval, setCurrentProjectMs, setIsPlaying]);

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
      if (item && item.kind === 'SOURCE_CLIP' && mainVideoRef.current) {
        mainVideoRef.current.currentTime = sourceMs / 1000;
        lastSeekTargetRef.current = sourceMs;
      }
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
        project.totalProjectDurationMs
      );
      await applyAICommand(command, query);
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Upload Custom Meme
  const handleCustomMemeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const meme = await addCustomMeme(file);
      // Auto insert at playhead
      applyAICommand({
        action: 'INSERT_USER_CLIP',
        payload: { clipId: meme.id, atProjectMs: currentProjectMs },
        explanation: `Uploaded and inserted ${meme.name}`
      }, `Upload ${meme.name}`);
    } catch {
      // ignore
    }
  };

  if (!project) return null;

  const totalProjSecNum = Math.max(1, project.totalProjectDurationMs / 1000);
  const totalProjSec = totalProjSecNum.toFixed(1);
  const curProjSec = (currentProjectMs / 1000).toFixed(1);

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
    <div className="h-screen w-screen bg-[#0F1117] text-gray-100 flex flex-col overflow-hidden select-none">
      {/* Top Header */}
      <header className="h-14 border-b border-gray-800 bg-[#141721] px-4 flex items-center justify-between z-20">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-sm shadow">
            AI
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-gray-200">{project.title}</h2>
            <div className="flex items-center space-x-2 text-[11px] text-gray-400">
              <span>{curProjSec}s / {totalProjSec}s</span>
              <span>•</span>
              <span className="text-indigo-400">Virtual InShot Playback</span>
            </div>
          </div>
        </div>

        {/* Audio Filter Controls & A/B Bypass */}
        <div className="flex items-center space-x-2">
          {/* Speaker Voice Enhancement Toggle */}
          <button
            onClick={() => toggleVoiceEnhance()}
            title="Speaker Voice Enhancement: 80Hz HPF + 250Hz warmth cut + 3kHz vocal presence boost + dynamics leveling"
            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5 border transition-all ${
              voiceEnhanceEnabled
                ? 'bg-emerald-950/70 border-emerald-500/80 text-emerald-300 shadow-sm'
                : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Voice Enhance</span>
            <span className={`text-[10px] px-1 py-0.2 rounded font-mono font-bold ${voiceEnhanceEnabled ? 'bg-emerald-800/60 text-emerald-200' : 'bg-gray-700 text-gray-400'}`}>
              {voiceEnhanceEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Background Noise Removal Toggle */}
          <button
            onClick={() => toggleNoiseRemoval()}
            title="Background Noise Removal: 100Hz HPF + 7500Hz LPF + dynamic noise-floor gate to attenuate fan rumble & room hiss"
            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5 border transition-all ${
              noiseRemovalEnabled
                ? 'bg-indigo-950/70 border-indigo-500/80 text-indigo-300 shadow-sm'
                : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Noise Removal</span>
            <span className={`text-[10px] px-1 py-0.2 rounded font-mono font-bold ${noiseRemovalEnabled ? 'bg-indigo-800/60 text-indigo-200' : 'bg-gray-700 text-gray-400'}`}>
              {noiseRemovalEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Bypass / Original Audio A/B Comparison Toggle */}
          <button
            onClick={() => toggleAudioBypass()}
            title="Instant A/B Comparison: Hear Original raw audio vs Enhanced audio in real time while playing"
            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5 border transition-all ${
              isAudioBypassed
                ? 'bg-amber-950/80 border-amber-500 text-amber-300 font-bold shadow-md shadow-amber-950/50'
                : 'bg-gray-800/60 border-gray-700 text-gray-300 hover:text-white'
            }`}
          >
            <VolumeX className="w-3.5 h-3.5 text-amber-400" />
            <span>{isAudioBypassed ? 'Bypassed (Original)' : 'Compare Original'}</span>
          </button>

          <div className="h-4 w-[1px] bg-gray-800 mx-1" />

          <button
            onClick={() => setScreen('EXPORT')}
            className="flex items-center space-x-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium px-4 py-1.5 rounded-lg text-xs shadow-md shadow-indigo-900/30 transition-all active:scale-95"
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
          className={`border-r border-gray-800 bg-[#12141D] flex flex-col transition-all duration-200 z-10 ${
            isLeftOpen ? 'w-80' : 'w-10'
          }`}
        >
          <div className="h-10 border-b border-gray-800 flex items-center justify-between px-3">
            {isLeftOpen ? (
              <div className="flex items-center space-x-2 text-xs">
                <button
                  onClick={() => setLeftTab('transcript')}
                  className={`font-medium pb-0.5 border-b-2 transition-all ${
                    leftTab === 'transcript' ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-gray-400'
                  }`}
                >
                  Transcript
                </button>
                <button
                  onClick={() => setLeftTab('chapters')}
                  className={`font-medium pb-0.5 border-b-2 transition-all ${
                    leftTab === 'chapters' ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-gray-400'
                  }`}
                >
                  Chapters
                </button>
              </div>
            ) : null}
            <button
              onClick={() => setIsLeftOpen(!isLeftOpen)}
              className="text-gray-400 hover:text-gray-200 p-1"
            >
              {isLeftOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>

          {isLeftOpen && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              {leftTab === 'transcript' ? (
                <div className="space-y-3">
                  {/* Quality & Mode Controls Bar */}
                  <div className="p-2.5 rounded-lg bg-gray-900/80 border border-gray-800 space-y-2">
                    {/* Quality Selector */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-400 font-medium">Quality:</span>
                      <select
                        value={transcriptQuality}
                        onChange={(e) => setTranscriptQuality(e.target.value as any)}
                        disabled={transcriptionStatus === 'downloading_model' || transcriptionStatus === 'transcribing' || transcriptMode === 'transcribe_hinglish'}
                        className="bg-gray-950 border border-gray-800 text-gray-200 text-[11px] rounded px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                      >
                        <option value="accurate">Accurate (Small, ~285 MB)</option>
                        <option value="fast">Fast (Base, ~75 MB)</option>
                      </select>
                    </div>

                    {/* Mode Selector */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-400 font-medium">Mode:</span>
                      <select
                        value={transcriptMode}
                        onChange={(e) => setTranscriptMode(e.target.value as any)}
                        disabled={transcriptionStatus === 'downloading_model' || transcriptionStatus === 'transcribing'}
                        className="bg-gray-950 border border-gray-800 text-gray-200 text-[11px] rounded px-2 py-1 max-w-[175px] truncate focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="transcribe_hinglish">Hinglish (Hindi + English)</option>
                        <option value="translate_en">English (translated)</option>
                        <option value="transcribe_en">English (as spoken)</option>
                      </select>
                    </div>

                    <p className="text-[10px] text-gray-500">
                      First use downloads the model ({transcriptMode === 'transcribe_hinglish' ? 'about 72 MB' : transcriptQuality === 'accurate' ? 'about 285 MB' : 'about 75 MB'}), only once.
                    </p>

                    <div className="flex items-center space-x-2 pt-1">
                      <button
                        type="button"
                        onClick={() => generateTranscript(transcriptQuality, transcriptMode)}
                        disabled={transcriptionStatus === 'downloading_model' || transcriptionStatus === 'transcribing'}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-1.5 px-3 rounded-md text-xs flex items-center justify-center space-x-1.5 shadow transition-all"
                      >
                        {transcriptionStatus === 'downloading_model' ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Loading model... {transcriptionDownloadPercent}%</span>
                          </>
                        ) : transcriptionStatus === 'transcribing' ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
                          className="bg-gray-800 hover:bg-gray-700 text-gray-300 p-1.5 rounded-md border border-gray-700 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {project.transcript.length > 0 && !project.isDemoSample && (
                      <button
                        type="button"
                        onClick={() => {
                          const res = suggestNonSpeechSilences();
                          alert(res.message);
                        }}
                        className="w-full bg-amber-950/40 hover:bg-amber-950/70 border border-amber-800/60 text-amber-300 py-1 px-2 rounded text-[11px] flex items-center justify-center space-x-1 transition-all"
                      >
                        <ShieldAlert className="w-3 h-3 text-amber-400" />
                        <span>Suggest Non-Speech Cuts</span>
                      </button>
                    )}
                  </div>

                  {/* Fallback Notice if Small model fell back to Base */}
                  {transcriptionFallbackNotice && (
                    <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-700/60 text-amber-300 text-[11px] flex items-start space-x-2">
                      <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                      <span>{transcriptionFallbackNotice}</span>
                    </div>
                  )}

                  {/* Urdu Script Warning Banner (Requirement 5) */}
                  {project.transcriptionMeta?.hasUrduWarning && (
                    <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-600/70 text-amber-200 text-[11px] flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                      <span>Output contains Urdu-script text. For a cleaner result use &apos;English (translated)&apos; mode.</span>
                    </div>
                  )}

                  {/* Status Banner: Downloading Model */}
                  {transcriptionStatus === 'downloading_model' && (
                    <div className="p-3 rounded-lg bg-indigo-950/50 border border-indigo-700/60 space-y-2">
                      <div className="flex items-center justify-between text-xs text-indigo-300 font-medium">
                        <span className="flex items-center space-x-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          <span>Downloading Whisper Model</span>
                        </span>
                        <span>{transcriptionDownloadPercent}%</span>
                      </div>
                      <div className="w-full bg-indigo-950 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-indigo-500 h-1.5 rounded-full transition-all duration-200"
                          style={{ width: `${transcriptionDownloadPercent}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-indigo-200/70">
                        First use downloads the model ({transcriptMode === 'transcribe_hinglish' ? 'about 72 MB' : transcriptQuality === 'accurate' ? 'about 285 MB' : 'about 75 MB'}), only once.
                      </p>
                    </div>
                  )}

                  {/* Status Banner: Transcribing */}
                  {transcriptionStatus === 'transcribing' && (
                    <div className="p-3 rounded-lg bg-purple-950/50 border border-purple-700/60 flex items-center space-x-2.5">
                      <Loader2 className="w-4 h-4 animate-spin text-purple-400 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-purple-200">Transcribing speech...</p>
                        <p className="text-[10px] text-purple-300/70">Running Whisper AI in background Web Worker</p>
                      </div>
                    </div>
                  )}

                  {/* Status Banner: Error */}
                  {transcriptionStatus === 'error' && (
                    <div className="p-3 rounded-lg bg-red-950/60 border border-red-700/60 space-y-1.5">
                      <div className="flex items-center space-x-1.5 text-xs font-semibold text-red-300">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                        <span>Transcription Failed</span>
                      </div>
                      <p className="text-[11px] text-red-200 leading-snug">{transcriptionError}</p>
                      <button
                        type="button"
                        onClick={() => generateTranscript(transcriptQuality, transcriptMode)}
                        className="text-[10px] text-red-300 hover:text-white underline mt-1 font-medium"
                      >
                        Try Again
                      </button>
                    </div>
                  )}

                  {/* Transcript Content List */}
                  {project.transcript.length === 0 && transcriptionStatus === 'idle' ? (
                    <div className="p-4 rounded-xl bg-gray-900/40 border border-gray-800 text-center space-y-2">
                      <p className="text-gray-300 text-xs">No transcript generated yet.</p>
                      <p className="text-[11px] text-gray-500 leading-relaxed">
                        Click &quot;Generate Transcript&quot; above to transcribe using in-browser Whisper AI. First use downloads the model once.
                      </p>
                    </div>
                  ) : project.transcript.length > 0 ? (
                    <div className="space-y-2">
                      {project.transcriptionMeta?.lowQualityWarning && (
                        <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-600/70 text-amber-200 text-[11px] flex items-start space-x-2">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400 mt-0.5" />
                          <span>{project.transcriptionMeta.lowQualityWarning}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-gray-400 pb-1 border-b border-gray-800/80">
                        <span>Click to seek • Double-click to edit:</span>
                        {project.isDemoSample ? (
                          <span className="text-[10px] bg-amber-950/60 text-amber-300 border border-amber-800/60 px-1.5 py-0.2 rounded">
                            Sample transcript
                          </span>
                        ) : (
                          <span className="text-[10px] bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 px-1.5 py-0.2 rounded">
                            {project.transcriptionMeta?.modelName || (transcriptQuality === 'accurate' ? 'Whisper Small' : 'Whisper Base')} ({project.transcript.length} words)
                          </span>
                        )}
                      </div>

                      <div className="leading-relaxed space-x-1 font-sans text-xs">
                        {project.transcript.map((w) => {
                          const projMs = mapSourceToProjectMs(w.sourceStartMs, project.items);
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
                                className="bg-gray-800 text-white font-medium border border-indigo-500 rounded px-1 py-0.5 text-xs outline-none w-20 inline-block shadow-sm"
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
                                  ? 'line-through text-gray-500 bg-gray-900/50 hover:text-gray-300'
                                  : isCurrent
                                  ? 'bg-indigo-600 text-white font-bold shadow-sm'
                                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                              } ${w.edited ? 'ring-1 ring-indigo-400/50 bg-indigo-950/30' : ''}`}
                            >
                              {w.word}
                              {w.edited && <span className="text-[9px] text-indigo-300 ml-0.5 font-bold">*</span>}
                            </span>
                          );
                        })}
                      </div>

                      {/* Labels under the transcript (Requirement 7) */}
                      <div className="pt-2.5 mt-2 border-t border-gray-800 text-[11px] text-gray-400 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono">
                          <span>
                            {project.transcriptionMeta?.modelName || (transcriptQuality === 'accurate' ? 'Whisper Small' : 'Whisper Base')} ({project.transcriptionMeta?.device || 'WASM'})
                          </span>
                          <span>
                            {project.transcriptionMeta?.durationMs ? `${(project.transcriptionMeta.durationMs / 1000).toFixed(1)}s` : ''}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-400">
                          Mode:{' '}
                          {
                            (project.transcriptionMeta?.mode || transcriptMode) === 'transcribe_hinglish'
                              ? 'Hinglish (Hindi + English)'
                              : (project.transcriptionMeta?.mode || transcriptMode) === 'transcribe_en'
                              ? 'English (as spoken)'
                              : 'English (translated)'
                          }
                        </div>
                        <p className="text-[10px] text-gray-500 italic">
                          Auto-generated, may contain errors. Double-click a word to fix it.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-gray-400 pb-1 border-b border-gray-800/80">
                    <span className="font-medium text-gray-300">Chapters (Auto-generated, approximate)</span>
                    <span className="text-[10px] text-gray-500">{project.chapters.length} markers</span>
                  </div>

                  {project.chapters.length === 0 ? (
                    <div className="p-4 rounded-xl bg-gray-900/40 border border-gray-800 text-center space-y-2">
                      <Bookmark className="w-5 h-5 text-gray-600 mx-auto" />
                      <p className="text-gray-300 text-xs">No chapters yet.</p>
                      <p className="text-[11px] text-gray-500 leading-relaxed">
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
                          className="p-2 rounded-lg bg-gray-800/40 hover:bg-gray-800 border border-gray-750 cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <div className="flex items-center space-x-2 truncate mr-2">
                            <Bookmark className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                            <span className="font-medium text-gray-200 truncate">{ch.title}</span>
                          </div>
                          <span className="text-[10px] text-gray-400 font-mono flex-shrink-0">
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
        <div className="flex-1 flex flex-col bg-[#0A0C11] items-center justify-center p-4 relative overflow-hidden">
          {/* Silence Alert Banner if pauses present */}
          {project.items.some(it => it.status === 'SUGGESTED_SILENCE_CUT') && (
            <div className="absolute top-4 left-6 right-6 bg-amber-950/70 border border-amber-600/50 rounded-xl px-4 py-2 flex items-center justify-between text-xs z-20 backdrop-blur shadow-lg">
              <div className="flex items-center space-x-2 text-amber-300">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <span>
                  <strong>Awkward Pauses Detected:</strong> Review amber intervals on timeline or click to clean up:
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => applyAICommand({
                    action: 'REMOVE_SILENCE',
                    payload: { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 },
                    explanation: 'Removing all detected silence intervals.'
                  })}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-medium px-3 py-1 rounded text-xs transition-colors"
                >
                  Accept All Cuts
                </button>
              </div>
            </div>
          )}

          {/* Dual-Video Canvas Frame */}
          <div className="relative w-full max-w-3xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-gray-800 flex items-center justify-center">
            {/* Main Video Element */}
            <video
              ref={mainVideoRef}
              src={project.sourceVideoUrl}
              playsInline
              className={`w-full h-full object-contain absolute inset-0 transition-opacity duration-150 ${
                activeMemePlaying ? 'opacity-0 pointer-events-none' : 'opacity-100'
              } ${activeTransitionClass}`}
            />

            {/* Stacked Meme Video Element (Spec 3) */}
            <video
              ref={memeVideoRef}
              playsInline
              className={`w-full h-full object-contain absolute inset-0 transition-opacity duration-150 ${
                activeMemePlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
              } ${activeTransitionClass}`}
            />

            {/* Click to play overlay */}
            <div
              onClick={togglePlayPause}
              className="absolute inset-0 cursor-pointer flex items-center justify-center group"
            >
              {!isPlaying && (
                <div className="w-16 h-16 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-xl transform group-hover:scale-105 transition-all">
                  <Play className="w-8 h-8 fill-white translate-x-0.5" />
                </div>
              )}
            </div>
          </div>

          {/* Player Controls Bar */}
          <div className="w-full max-w-3xl flex items-center justify-between mt-3 px-2">
            <div className="flex items-center space-x-3">
              <button
                onClick={togglePlayPause}
                className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow transition-all active:scale-95"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white translate-x-0.5" />}
              </button>

              <button
                onClick={() => handleSeek(0)}
                className="p-2 text-gray-400 hover:text-gray-200 transition-colors"
                title="Restart"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <div className="text-xs font-mono text-gray-300">
                <span className="font-bold text-white">{curProjSec}s</span>
                <span className="text-gray-600"> / </span>
                <span>{totalProjSec}s</span>
              </div>
            </div>

            {/* Editing quick tools */}
            <div className="flex items-center space-x-2">
              <button
                onClick={splitAtPlayhead}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors"
                title="Split at playhead position"
              >
                <Scissors className="w-3.5 h-3.5 text-indigo-400" />
                <span>Split (S)</span>
              </button>

              <button
                onClick={deleteSelected}
                disabled={!selectedItemId}
                className="px-3 py-1.5 bg-gray-800 hover:bg-red-950/60 hover:text-red-300 border border-transparent hover:border-red-800/60 text-gray-400 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Delete selected clip"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>

              <div className="h-4 w-[1px] bg-gray-800 mx-1" />

              <button
                onClick={undo}
                disabled={undoStack.length === 0}
                className="p-1.5 text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
                title="Undo"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={redo}
                disabled={redoStack.length === 0}
                className="p-1.5 text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
                title="Redo"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Collapsible Panel: AI Command Hub */}
        <div
          className={`border-l border-gray-800 bg-[#12141D] flex flex-col transition-all duration-200 z-10 ${
            isRightOpen ? 'w-80' : 'w-10'
          }`}
        >
          <div className="h-10 border-b border-gray-800 flex items-center justify-between px-3">
            <button
              onClick={() => setIsRightOpen(!isRightOpen)}
              className="text-gray-400 hover:text-gray-200 p-1"
            >
              {isRightOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            {isRightOpen && (
              <span className="text-xs font-semibold text-gray-200 flex items-center space-x-1">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>AI Command Hub</span>
              </span>
            )}
          </div>

          {isRightOpen && (
            <div className="flex-1 flex flex-col overflow-hidden p-3 space-y-3">
              {/* Quick Prompt Chips */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Quick Prompts</span>
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
                      className="text-[11px] bg-gray-800 hover:bg-indigo-900/40 hover:text-indigo-300 text-gray-300 px-2 py-1 rounded-md border border-gray-700/60 transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              {/* Meme Library Quick Insertion */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Meme Reactions</span>
                  <label className="text-[10px] text-indigo-400 hover:underline cursor-pointer flex items-center space-x-1">
                    <Upload className="w-3 h-3" />
                    <span>Upload .mp4</span>
                    <input
                      type="file"
                      accept="video/mp4,video/webm"
                      onChange={handleCustomMemeUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'fail_trombone', label: '🎺 Fail Trombone' },
                    { id: 'wait_what', label: '🤨 Wait What' },
                    { id: 'victory_cheer', label: '🎉 Victory' },
                    { id: 'shocked_blink', label: '😳 Shocked' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => applyAICommand({
                        action: 'INSERT_LIBRARY_MEME',
                        payload: { memeId: m.id as any, atProjectMs: currentProjectMs },
                        explanation: `Inserted ${m.label}`
                      }, `Insert ${m.label}`)}
                      className="text-left text-[11px] bg-gray-800/80 hover:bg-gray-700 p-1.5 rounded-lg border border-gray-700/60 text-gray-200 truncate"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Command Input Bar */}
              <div className="relative pt-1">
                <input
                  type="text"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendCommand()}
                  placeholder='e.g. "Cut from 0:10 to 0:25"'
                  disabled={isAiProcessing}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-3 pr-9 py-2 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={handleSendCommand}
                  disabled={isAiProcessing || !promptInput.trim()}
                  className="absolute right-1.5 bottom-1.5 p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
                >
                  <Send className="w-3 h-3" />
                </button>
              </div>

              {/* Command Execution Log */}
              <div className="flex-1 overflow-y-auto space-y-2 pt-1">
                <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Execution Log</span>
                {commandLogs.length === 0 ? (
                  <p className="text-[11px] text-gray-500 italic">No AI commands executed yet.</p>
                ) : (
                  commandLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-2 rounded-lg border text-[11px] space-y-1 ${
                        log.status === 'SUCCESS'
                          ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                          : log.status === 'CLARIFICATION'
                          ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
                          : 'bg-red-950/20 border-red-800/40 text-red-300'
                      }`}
                    >
                      <div className="font-semibold">{log.rawInput}</div>
                      <div className="text-gray-300 text-[10px]">{log.appliedMessage}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Timeline Section (Spec 1 & Spec 2) */}
      <footer className="h-48 border-t border-gray-800 bg-[#10121A] flex flex-col p-3 z-20">
        {/* Timeline Toolbar */}
        <div className="flex flex-wrap items-center justify-between pb-2 text-xs gap-2">
          <div className="flex items-center space-x-3">
            {/* Playback Speed Controls (Item 1) */}
            <div className="flex items-center space-x-1.5">
              <span className="text-gray-400 text-[11px] font-medium">Speed:</span>
              {([1, 2, 5] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPreviewSpeed(s)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors ${
                    previewSpeed === s ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {s}x
                </button>
              ))}
              <span className="text-[10px] text-gray-500 hidden sm:inline">Preview speed only. Export keeps normal speed.</span>
              {previewSpeed === 5 && (
                <span className="text-[10px] text-amber-400/90 ml-1">
                  (Audio may be muted or distorted at 5x by browser)
                </span>
              )}
            </div>

            {/* Timeline Zoom Controls (Item 1B) */}
            <div className="flex items-center space-x-1.5 pl-3 border-l border-gray-800">
              <span className="text-gray-400 text-[11px] font-medium">Zoom:</span>
              <button
                onClick={zoomOut}
                disabled={timelineZoom <= 1}
                className="w-5 h-5 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                title="Zoom Out Timeline (-)"
              >
                -
              </button>
              <span className="text-[11px] font-mono text-gray-300 w-7 text-center">{timelineZoom}x</span>
              <button
                onClick={zoomIn}
                disabled={timelineZoom >= 5}
                className="w-5 h-5 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                title="Zoom In Timeline (+)"
              >
                +
              </button>
            </div>

            {/* Silence Detection Sensitivity (Item 2) */}
            <div className="flex items-center space-x-1.5 pl-3 border-l border-gray-800">
              <span className="text-gray-400 text-[11px] font-medium">Sensitivity:</span>
              <select
                value={silenceSensitivity}
                onChange={(e) => setSilenceSensitivity(e.target.value as SilenceSensitivity)}
                className="bg-gray-800 text-gray-200 border border-gray-700 rounded px-1.5 py-0.5 text-[11px]"
                title="Gentle: >=800ms (+8dB) | Normal: >=500ms (+10dB) | Tight: >=350ms (+12dB)"
              >
                <option value="Gentle">Gentle (800ms)</option>
                <option value="Normal">Normal (500ms)</option>
                <option value="Tight">Tight (350ms)</option>
              </select>
              <button
                onClick={async () => {
                  const res = await detectSilencesOnly(silenceSensitivity);
                  const cfg = SILENCE_PRESETS[silenceSensitivity];
                  addCommandLog({
                    id: `cmd_${Date.now()}`,
                    rawInput: `Detect pauses (${silenceSensitivity} mode)`,
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
                className="px-2 py-0.5 bg-amber-900/60 hover:bg-amber-800/80 border border-amber-600/60 text-amber-200 rounded text-[11px] font-medium transition-colors"
                title="Scan audio and display amber silence blocks on timeline without deleting them yet"
              >
                Detect Silences
              </button>
            </div>

            {/* Audio Processing Toggles & A/B Bypass */}
            <div className="flex items-center space-x-1.5 pl-3 border-l border-gray-800">
              <span className="text-gray-400 text-[11px] font-medium">Audio:</span>
              <button
                onClick={() => toggleVoiceEnhance()}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                  voiceEnhanceEnabled
                    ? 'bg-emerald-950/80 border-emerald-600/80 text-emerald-300'
                    : 'bg-gray-800/80 border-gray-750 text-gray-400 hover:text-gray-200'
                }`}
                title="Speaker Voice Enhancement (80Hz HPF + 250Hz warmth cut + 3kHz boost + compressor)"
              >
                Voice {voiceEnhanceEnabled ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => toggleNoiseRemoval()}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                  noiseRemovalEnabled
                    ? 'bg-indigo-950/80 border-indigo-600/80 text-indigo-300'
                    : 'bg-gray-800/80 border-gray-750 text-gray-400 hover:text-gray-200'
                }`}
                title="Background Noise Removal (100Hz HPF + 7500Hz LPF + dynamic noise-floor gate)"
              >
                Noise {noiseRemovalEnabled ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => toggleAudioBypass()}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border ${
                  isAudioBypassed
                    ? 'bg-amber-950/80 border-amber-500 text-amber-300 font-bold'
                    : 'bg-gray-800/80 border-gray-750 text-gray-300 hover:text-white'
                }`}
                title="A/B Compare: Instantly toggle bypass to hear original raw audio vs enhanced audio"
              >
                {isAudioBypassed ? 'Original (Bypassed)' : 'A/B Bypass'}
              </button>
            </div>

            {/* Thumbnail Generation Progress (Item 1) */}
            {thumbnailProgress && !thumbnailProgress.done && (
              <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-[10px] animate-pulse">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                <span>Generating frames {thumbnailProgress.current}/{thumbnailProgress.total}</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center space-x-4 text-[11px] text-gray-400">
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" />
              <span>Active Clip</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
              <span>Awkward Silence</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" />
              <span>Meme Insert</span>
            </div>
          </div>
        </div>

        {/* Timeline Track Area (Horizontally Scrollable) */}
        <div
          ref={timelineContainerRef}
          className="flex-1 bg-gray-950 rounded-xl border border-gray-800 relative overflow-x-auto overflow-y-hidden p-2"
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
                <div className="bg-gray-900/95 border border-indigo-500/80 text-indigo-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap">
                  {formatReadout(isScrubbing ? currentProjectMs : (hoverTimeMs ?? currentProjectMs))}
                </div>
                <div className="w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-indigo-500" />
              </div>
            )}

            {/* Thin Time Ruler Row (Item 2) */}
            <div className="w-full h-5 border-b border-gray-800/80 relative font-mono text-[9px] text-gray-400 select-none pointer-events-none">
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
                    className="absolute bottom-0 h-1.5 w-[1px] bg-gray-700/60 transform -translate-x-1/2"
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
                    <span className="leading-none text-[8.5px] text-gray-400">{mm}:{ss}</span>
                    <div className="h-2 w-[1px] bg-gray-500 mt-auto" />
                  </div>
                );
              })}
            </div>

            {/* Red Playhead Line */}
            <div
              style={{
                left: `${project.totalProjectDurationMs > 0 ? (currentProjectMs / project.totalProjectDurationMs) * 100 : 0}%`
              }}
              className="absolute top-6 bottom-0 w-[2px] bg-red-500 z-30 pointer-events-none"
            >
              <div className="w-3 h-3 bg-red-500 transform -translate-x-1/2 -translate-y-1 rotate-45 rounded-sm shadow-md" />
              <div className="absolute top-0 transform -translate-x-1/2 -translate-y-4 px-1 rounded bg-red-600 text-white font-mono text-[8px] font-bold shadow pointer-events-none whitespace-nowrap">
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
                const isMeme = item.kind === 'MEME_CLIP';
                const hasThumbnails = Object.keys(thumbnails).length > 0;
                const isNarrow = item.durationMs < 2000;
                const isHighZoom = timelineZoom >= 3;
                const frameIntervalMs = isHighZoom ? 500 : 1000;
                const tileCount = Math.max(1, Math.round(item.durationMs / frameIntervalMs));

                return (
                  <div
                    key={item.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItemId(item.id);
                    }}
                    style={{ width: `${durPct}%`, minWidth: '34px' }}
                    title={`${item.title} (${(item.durationMs / 1000).toFixed(1)}s)`}
                    className={`h-11 rounded-lg px-2 py-1 flex flex-col justify-between transition-all relative overflow-hidden select-none cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-white shadow-lg'
                        : 'border border-black/20'
                    } ${
                      isSilence
                        ? 'bg-amber-600/95 text-amber-50 hover:bg-amber-500'
                        : isMeme
                        ? 'bg-purple-600/95 text-purple-50 hover:bg-purple-500'
                        : 'bg-indigo-600/95 text-white hover:bg-indigo-500'
                    }`}
                  >
                    {/* Filmstrip Frame Thumbnails (Item 1) */}
                    {hasThumbnails && item.kind === 'SOURCE_CLIP' && !isSilence && (
                      <div className="absolute inset-0 flex flex-row overflow-hidden pointer-events-none opacity-85">
                        {Array.from({ length: tileCount }).map((_, tileIdx) => {
                          const tileSourceMs = item.sourceStartMs + (tileIdx * item.durationMs) / tileCount;
                          const nearestMs = Math.round(tileSourceMs / 500) * 500;
                          const frameUrl = thumbnails[nearestMs] || thumbnails[Math.floor(tileSourceMs / 1000)] || thumbnails[0];
                          return (
                            <div
                              key={tileIdx}
                              className="flex-1 h-full bg-cover bg-center border-r border-black/25"
                              style={{
                                backgroundImage: frameUrl ? `url(${frameUrl})` : undefined,
                                backgroundColor: frameUrl ? undefined : '#312e81',
                                imageRendering: 'auto'
                              }}
                            />
                          );
                        })}
                        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/15 to-black/75 pointer-events-none" />
                      </div>
                    )}

                    <div className="relative z-10 flex items-center justify-between">
                      <span className="text-[11px] font-semibold truncate drop-shadow-md">
                        {isNarrow && !isSilence ? '' : item.title}
                      </span>
                      {isSilence && (
                        <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => acceptSilenceCut(item.id)}
                            className="p-1 bg-red-700 hover:bg-red-600 rounded text-white"
                            title="Accept Silence Cut"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => keepSilencePause(item.id)}
                            className="p-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-200"
                            title="Keep Pause"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="relative z-10 flex items-center justify-between text-[10px] opacity-90 font-mono drop-shadow-sm">
                      <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                      {item.transitionOut && item.transitionOut.type !== 'none' && (
                        <span className="bg-black/50 px-1 rounded uppercase text-[9px]">
                          {item.transitionOut.type}
                        </span>
                      )}
                    </div>

                    {/* Transition Picker Diamond */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        const types: TransitionType[] = ['none', 'fade', 'dissolve', 'wipeleft', 'slideup'];
                        const curIdx = types.indexOf(item.transitionOut?.type || 'none');
                        const nextType = types[(curIdx + 1) % types.length];
                        setTransition(item.id, nextType);
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 rounded-full bg-gray-900 border border-gray-600 hover:border-indigo-400 flex items-center justify-center text-[8px] z-20 shadow cursor-pointer"
                      title={`Click to cycle transition (Current: ${item.transitionOut?.type || 'none'})`}
                    >
                      ◇
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
