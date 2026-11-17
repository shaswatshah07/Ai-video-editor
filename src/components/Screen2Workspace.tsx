import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, RotateCw, Scissors, Trash2, Volume2,
  Sparkles, Send, Upload, ChevronRight, ChevronLeft, ArrowRight,
  Bookmark, Check, X, Wand2, ShieldAlert
} from 'lucide-react';
import { useEditorStore } from '../store/useEditorStore';
import { mapProjectToSource, mapSourceToProjectMs } from '../utils/timelineMath';
import { parseCommandWithFallback } from '../utils/commandParser';
import { TransitionType } from '../types/edl';

export const Screen2Workspace: React.FC = () => {
  const {
    project,
    currentProjectMs,
    isPlaying,
    zoomLevel,
    selectedItemId,
    commandLogs,
    isAudioEnhanceActive,
    isNoiseReductionActive,
    undoStack,
    redoStack,
    setScreen,
    setCurrentProjectMs,
    setIsPlaying,
    setZoomLevel,
    setSelectedItemId,
    splitAtPlayhead,
    deleteSelected,
    acceptSilenceCut,
    keepSilencePause,
    setTransition,
    toggleVoiceEnhance,
    toggleNoiseReduction,
    undo,
    redo,
    addCustomMeme,
    applyAICommand
  } = useEditorStore();

  // Dual Video Elements (Spec 3)
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const memeVideoRef = useRef<HTMLVideoElement | null>(null);

  // RAF synchronization & Seek Loop Guard
  const rafIdRef = useRef<number | null>(null);
  const lastSeekTargetRef = useRef<number | null>(null);
  const activeMemeIdRef = useRef<string | null>(null);

  // Web Audio Context WeakMap Guard (Spec 4: single attachment per element in StrictMode)
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceAttachedRef = useRef<boolean>(false);
  const hpfFilterRef = useRef<BiquadFilterNode | null>(null);
  const eqFilterRef = useRef<BiquadFilterNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);

  // UI state
  const [activeTransitionClass, setActiveTransitionClass] = useState<string>('');
  const [promptInput, setPromptInput] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [leftTab, setLeftTab] = useState<'transcript' | 'chapters'>('transcript');
  const [isLeftOpen, setIsLeftOpen] = useState<boolean>(true);
  const [isRightOpen, setIsRightOpen] = useState<boolean>(true);
  const [activeMemePlaying, setActiveMemePlaying] = useState<boolean>(false);

  const timelineContainerRef = useRef<HTMLDivElement | null>(null);

  // Setup Web Audio Node Chain on user gesture or mount
  const setupWebAudio = useCallback(() => {
    if (!mainVideoRef.current || audioSourceAttachedRef.current) return;

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      audioContextRef.current = ctx;

      const source = ctx.createMediaElementSource(mainVideoRef.current);

      // 80Hz High-pass filter
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 80;
      hpfFilterRef.current = hpf;

      // 3kHz Peaking EQ (+3dB)
      const eq = ctx.createBiquadFilter();
      eq.type = 'peaking';
      eq.frequency.value = 3000;
      eq.gain.value = isAudioEnhanceActive ? 3 : 0;
      eqFilterRef.current = eq;

      // Dynamic Range Compressor
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 30;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      compressorRef.current = comp;

      source.connect(hpf);
      hpf.connect(eq);
      eq.connect(comp);
      comp.connect(ctx.destination);

      audioSourceAttachedRef.current = true;
    } catch {
      // Audio element might already be connected or blocked
    }
  }, [isAudioEnhanceActive]);

  // Update EQ gain when store toggle changes
  useEffect(() => {
    if (eqFilterRef.current && audioContextRef.current) {
      eqFilterRef.current.gain.setValueAtTime(
        isAudioEnhanceActive ? 3 : 0,
        audioContextRef.current.currentTime
      );
    }
    if (hpfFilterRef.current && audioContextRef.current) {
      hpfFilterRef.current.frequency.setValueAtTime(
        isAudioEnhanceActive ? 80 : 10,
        audioContextRef.current.currentTime
      );
    }
  }, [isAudioEnhanceActive]);

  // Main Virtual Playback Engine RAF Loop (Spec 3)
  useEffect(() => {
    if (!project) return;

    const loop = () => {
      if (isPlaying) {
        const activeItems = project.items.filter(it => it.status === 'ACTIVE' || it.status === 'SUGGESTED_MEME');
        const totalDuration = project.totalProjectDurationMs;

        if (currentProjectMs >= totalDuration) {
          setIsPlaying(false);
          setCurrentProjectMs(totalDuration);
          return;
        }

        const { item, sourceMs } = mapProjectToSource(currentProjectMs, project.items);

        if (!item) {
          // If in a gap or deleted region, jump forward
          const nextActive = activeItems.find(it => it.projectStartMs > currentProjectMs);
          if (nextActive) {
            setCurrentProjectMs(nextActive.projectStartMs);
          } else {
            setIsPlaying(false);
          }
          rafIdRef.current = requestAnimationFrame(loop);
          return;
        }

        // Check if playing a MEME clip
        if (item.kind === 'MEME_CLIP') {
          setActiveMemePlaying(true);
          if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();

          if (memeVideoRef.current) {
            if (activeMemeIdRef.current !== item.id) {
              activeMemeIdRef.current = item.id;
              memeVideoRef.current.src = item.blobUrl;
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

            // Sync main video if drifting > 150ms or seek guard triggered
            if (driftSec > 0.15 && lastSeekTargetRef.current !== sourceMs) {
              lastSeekTargetRef.current = sourceMs;
              mainVideoRef.current.currentTime = targetSec;
            }

            if (mainVideoRef.current.paused) {
              mainVideoRef.current.play().catch(() => {});
            }
          }
        }

        // Check for transition trigger near cut boundary
        if (item.transitionOut && item.transitionOut.type !== 'none') {
          const distToEnd = item.projectEndMs - currentProjectMs;
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

        // Advance project playhead by ~16.6ms per frame
        setCurrentProjectMs(currentProjectMs + 16.6);
      } else {
        // Paused: halt both video players
        if (mainVideoRef.current && !mainVideoRef.current.paused) mainVideoRef.current.pause();
        if (memeVideoRef.current && !memeVideoRef.current.paused) memeVideoRef.current.pause();
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying, currentProjectMs, project, activeTransitionClass, setCurrentProjectMs, setIsPlaying]);

  // Handle Play/Pause Toggle
  const togglePlayPause = () => {
    setupWebAudio();
    if (!isPlaying && project && currentProjectMs >= project.totalProjectDurationMs) {
      setCurrentProjectMs(0);
    }
    setIsPlaying(!isPlaying);
  };

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

  const totalProjSec = (project.totalProjectDurationMs / 1000).toFixed(1);
  const curProjSec = (currentProjectMs / 1000).toFixed(1);

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

        {/* Audio Filter Indicators */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => toggleVoiceEnhance()}
            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5 border transition-all ${
              isAudioEnhanceActive
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-300'
                : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Voice EQ (+3dB)</span>
          </button>

          <button
            onClick={() => toggleNoiseReduction()}
            className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1.5 border transition-all ${
              isNoiseReductionActive
                ? 'bg-indigo-950/60 border-indigo-500/80 text-indigo-300'
                : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Denoise</span>
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
            isLeftOpen ? 'w-72' : 'w-10'
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
            <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
              {leftTab === 'transcript' ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-gray-400 italic">Click any word to seek video:</p>
                  <div className="leading-relaxed space-x-1">
                    {project.transcript.map((w) => {
                      const projMs = mapSourceToProjectMs(w.sourceStartMs, project.items);
                      const isDeleted = projMs === null;
                      const isCurrent =
                        projMs !== null &&
                        currentProjectMs >= projMs &&
                        currentProjectMs < projMs + (w.sourceEndMs - w.sourceStartMs);

                      return (
                        <span
                          key={w.id}
                          onClick={() => {
                            if (projMs !== null) handleSeek(projMs);
                          }}
                          className={`inline-block px-1 py-0.5 rounded cursor-pointer transition-colors ${
                            isDeleted
                              ? 'line-through text-gray-600 bg-gray-900/50 cursor-not-allowed'
                              : isCurrent
                              ? 'bg-indigo-600 text-white font-bold'
                              : 'text-gray-300 hover:bg-gray-800'
                          }`}
                        >
                          {w.word}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {project.chapters.map((ch) => {
                    const projMs = mapSourceToProjectMs(ch.sourceMs, project.items);
                    return (
                      <div
                        key={ch.id}
                        onClick={() => {
                          if (projMs !== null) handleSeek(projMs);
                        }}
                        className="p-2 rounded-lg bg-gray-800/40 hover:bg-gray-800 border border-gray-750 cursor-pointer flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-2">
                          <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="font-medium text-gray-200">{ch.title}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {projMs !== null ? `${(projMs / 1000).toFixed(1)}s` : 'Cut'}
                        </span>
                      </div>
                    );
                  })}
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
      <footer className="h-44 border-t border-gray-800 bg-[#10121A] flex flex-col p-3 z-20">
        {/* Timeline Toolbar */}
        <div className="flex items-center justify-between pb-2 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-gray-400 text-[11px]">Zoom:</span>
            {([1, 2, 5] as const).map((z) => (
              <button
                key={z}
                onClick={() => setZoomLevel(z)}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors ${
                  zoomLevel === z ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {z}x
              </button>
            ))}
          </div>

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

        {/* Timeline Track Area */}
        <div
          ref={timelineContainerRef}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const pct = clickX / rect.width;
            handleSeek(pct * project.totalProjectDurationMs);
          }}
          className="flex-1 bg-gray-950 rounded-xl border border-gray-800 relative overflow-x-auto flex items-center p-2 cursor-pointer"
        >
          {/* Red Playhead Line */}
          <div
            style={{
              left: `${project.totalProjectDurationMs > 0 ? (currentProjectMs / project.totalProjectDurationMs) * 100 : 0}%`
            }}
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-30 pointer-events-none"
          >
            <div className="w-3 h-3 bg-red-500 transform -translate-x-1/2 -translate-y-1 rotate-45 rounded-sm shadow-md" />
          </div>

          {/* Timeline Items Track */}
          <div className="w-full h-16 flex items-center space-x-1 relative">
            {project.items.map((item) => {
              const isSelected = selectedItemId === item.id;

              if (item.status === 'DELETED') {
                return null; // Skip rendering deleted parts in active timeline bar
              }

              const durPct = project.totalProjectDurationMs > 0
                ? Math.max(3, (item.durationMs / project.totalProjectDurationMs) * 100)
                : 10;

              const isSilence = item.status === 'SUGGESTED_SILENCE_CUT';
              const isMeme = item.kind === 'MEME_CLIP';

              return (
                <div
                  key={item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItemId(item.id);
                  }}
                  style={{ width: `${durPct}%` }}
                  className={`h-14 rounded-lg px-2 py-1 flex flex-col justify-between transition-all relative overflow-hidden select-none cursor-pointer ${
                    isSelected
                      ? 'ring-2 ring-white shadow-lg'
                      : 'border border-black/20'
                  } ${
                    isSilence
                      ? 'bg-amber-600/90 text-amber-50 hover:bg-amber-500'
                      : isMeme
                      ? 'bg-purple-600/90 text-purple-50 hover:bg-purple-500'
                      : 'bg-indigo-600/90 text-white hover:bg-indigo-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold truncate">{item.title}</span>
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

                  <div className="flex items-center justify-between text-[10px] opacity-80 font-mono">
                    <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                    {item.transitionOut && item.transitionOut.type !== 'none' && (
                      <span className="bg-black/30 px-1 rounded uppercase text-[9px]">
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
      </footer>
    </div>
  );
};
