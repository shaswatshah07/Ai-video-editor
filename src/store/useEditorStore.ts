import { create } from 'zustand';
import { ProjectEDL, TimelineItem, TransitionType, TranscriptModelQuality, TranscriptMode } from '../types/edl';
import { AICommand, CommandLogEntry } from '../types/commands';
import {
  recalculateTimeline,
  splitAndTrimProjectRange,
  splitItemAtPlayhead,
  getTotalProjectDuration
} from '../utils/timelineMath';
import { getOrGenerateMemeBlob, MEME_PRESETS } from '../utils/memeGenerator';
import { detectSilenceInVideo, injectSilenceCutsIntoTimeline, SilenceSensitivity, SILENCE_PRESETS } from '../utils/silenceDetector';
import { generateSourceThumbnails, ThumbnailMap, ThumbnailProgress } from '../utils/thumbnailGenerator';
import { transcribeVideoAudio, suggestNonSpeechCuts, TranscriptionStatus } from '../utils/transcriptionService';

export type ScreenState = 'UPLOAD' | 'WORKSPACE' | 'EXPORT';

export interface CustomMeme {
  id: string;
  name: string;
  blobUrl: string;
  durationMs: number;
}

interface EditorState {
  screen: ScreenState;
  project: ProjectEDL | null;
  currentProjectMs: number;
  isPlaying: boolean;
  previewSpeed: 1 | 2 | 5;
  timelineZoom: number;
  minSilenceDurationMs: number;
  silenceSensitivity: SilenceSensitivity;
  thumbnails: ThumbnailMap;
  thumbnailProgress: ThumbnailProgress | null;
  selectedItemId: string | null;
  commandLogs: CommandLogEntry[];
  customMemeClips: CustomMeme[];
  undoStack: TimelineItem[][];
  redoStack: TimelineItem[][];
  voiceEnhanceEnabled: boolean;
  noiseRemovalEnabled: boolean;
  isAudioBypassed: boolean;
  isAudioEnhanceActive: boolean;
  isNoiseReductionActive: boolean;

  // Real Web Worker Transcription State (Part A & Quality/Mode Options)
  transcriptionStatus: TranscriptionStatus;
  transcriptionDownloadPercent: number;
  transcriptionCurrentFile: string;
  transcriptionError: string | null;
  transcriptionFallbackNotice: string | null;
  selectedLanguage: 'english' | 'hindi';
  transcriptQuality: TranscriptModelQuality;
  transcriptMode: TranscriptMode;

  // Actions
  setScreen: (screen: ScreenState) => void;
  loadProject: (
    videoUrl: string,
    fileName: string,
    fileSize: number,
    durationMs: number,
    initialItems?: TimelineItem[],
    isDemoSample?: boolean
  ) => void;
  setCurrentProjectMs: (ms: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPreviewSpeed: (speed: 1 | 2 | 5) => void;
  setTimelineZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setMinSilenceDurationMs: (ms: number) => void;
  setSilenceSensitivity: (sensitivity: SilenceSensitivity) => void;
  setSelectedLanguage: (lang: 'english' | 'hindi') => void;
  setTranscriptQuality: (quality: TranscriptModelQuality) => void;
  setTranscriptMode: (mode: TranscriptMode) => void;
  updateTranscriptWord: (wordId: string, newText: string) => void;
  generateTranscript: (quality?: TranscriptModelQuality, mode?: TranscriptMode) => Promise<void>;
  suggestNonSpeechSilences: () => { count: number; totalDurationMs: number; message: string };
  setSelectedItemId: (id: string | null) => void;
  addCommandLog: (log: CommandLogEntry) => void;
  
  // Timeline editing actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  acceptSilenceCut: (itemId: string) => void;
  keepSilencePause: (itemId: string) => void;
  acceptAllSilences: () => Promise<{ changed: boolean; message: string }>;
  detectSilencesOnly: (param?: SilenceSensitivity | number) => Promise<{ count: number; message: string }>;
  removeOrDetectSilences: (param?: SilenceSensitivity | number) => Promise<{ changed: boolean; message: string; count?: number; totalSilenceMs?: number; newDurationMs?: number }>;
  setTransition: (itemId: string, type: TransitionType, durationMs?: number) => void;
  trimProjectRange: (startMs: number, endMs: number) => void;
  insertLibraryMeme: (memeId: 'fail_trombone' | 'wait_what' | 'victory_cheer' | 'shocked_blink', atProjectMs: number) => Promise<void>;
  insertUserClip: (clipId: string, atProjectMs: number) => void;
  toggleVoiceEnhance: (enabled?: boolean) => void;
  toggleNoiseRemoval: (enabled?: boolean) => void;
  toggleNoiseReduction: (enabled?: boolean) => void;
  toggleAudioBypass: (bypassed?: boolean) => void;
  addCustomMeme: (file: File) => Promise<CustomMeme>;
  applyAICommand: (command: AICommand, rawInput?: string) => Promise<void>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  screen: 'UPLOAD',
  project: null,
  currentProjectMs: 0,
  isPlaying: false,
  previewSpeed: 1,
  timelineZoom: 1,
  minSilenceDurationMs: 500,
  silenceSensitivity: 'Normal',
  thumbnails: {},
  thumbnailProgress: null,
  selectedItemId: null,
  commandLogs: [],
  customMemeClips: [],
  undoStack: [],
  redoStack: [],
  voiceEnhanceEnabled: false,
  noiseRemovalEnabled: false,
  isAudioBypassed: false,
  isAudioEnhanceActive: false,
  isNoiseReductionActive: false,
  transcriptionStatus: 'idle',
  transcriptionDownloadPercent: 0,
  transcriptionCurrentFile: '',
  transcriptionError: null,
  transcriptionFallbackNotice: null,
  selectedLanguage: 'english',
  transcriptQuality: 'accurate',
  transcriptMode: 'translate_en',

  setScreen: (screen) => set({ screen }),

  loadProject: (videoUrl, fileName, fileSize, durationMs, initialItems, isDemoSample = false) => {
    const rawItems: TimelineItem[] = initialItems && initialItems.length > 0
      ? initialItems
      : [
          {
            id: 'clip_source_root',
            kind: 'SOURCE_CLIP',
            title: fileName,
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

    const recalculated = recalculateTimeline(rawItems);
    const totalProjMs = getTotalProjectDuration(recalculated);

    // Hardcoded demo sentence is ONLY used if isDemoSample is true
    const demoTranscript = isDemoSample ? [
      { id: 'w1', word: 'Welcome', sourceStartMs: 500, sourceEndMs: 1100, confidence: 0.98, approximate: false },
      { id: 'w2', word: 'to', sourceStartMs: 1150, sourceEndMs: 1350, confidence: 0.99, approximate: false },
      { id: 'w3', word: 'our', sourceStartMs: 1400, sourceEndMs: 1650, confidence: 0.97, approximate: false },
      { id: 'w4', word: 'AI', sourceStartMs: 1700, sourceEndMs: 2100, confidence: 0.99, approximate: false },
      { id: 'w5', word: 'video', sourceStartMs: 2150, sourceEndMs: 2550, confidence: 0.98, approximate: false },
      { id: 'w6', word: 'editor', sourceStartMs: 2600, sourceEndMs: 3100, confidence: 0.99, approximate: false },
      { id: 'w7', word: 'studio.', sourceStartMs: 3150, sourceEndMs: 3800, confidence: 0.95, approximate: false },
      { id: 'w8', word: 'Notice', sourceStartMs: 5200, sourceEndMs: 5800, confidence: 0.98, approximate: false },
      { id: 'w9', word: 'how', sourceStartMs: 5850, sourceEndMs: 6100, confidence: 0.96, approximate: false },
      { id: 'w10', word: 'instant', sourceStartMs: 6150, sourceEndMs: 6650, confidence: 0.98, approximate: false },
      { id: 'w11', word: 'cutting', sourceStartMs: 6700, sourceEndMs: 7200, confidence: 0.97, approximate: false },
      { id: 'w12', word: 'and', sourceStartMs: 7250, sourceEndMs: 7450, confidence: 0.99, approximate: false },
      { id: 'w13', word: 'voice', sourceStartMs: 7500, sourceEndMs: 7900, confidence: 0.98, approximate: false },
      { id: 'w14', word: 'enhancement', sourceStartMs: 7950, sourceEndMs: 8700, confidence: 0.99, approximate: false },
      { id: 'w15', word: 'work!', sourceStartMs: 8750, sourceEndMs: 9300, confidence: 0.97, approximate: false }
    ] : [];

    const demoChapters = isDemoSample ? [
      { id: 'c1', title: 'Intro & Welcome', sourceMs: 0, isAutoGenerated: false },
      { id: 'c2', title: 'Core Demonstration', sourceMs: 5000, isAutoGenerated: false }
    ] : [];

    const project: ProjectEDL = {
      id: `proj_${Date.now()}`,
      title: fileName.replace(/\.[^/.]+$/, ''),
      sourceDurationMs: durationMs,
      sourceVideoUrl: videoUrl,
      sourceFileName: fileName,
      sourceFileSize: fileSize,
      totalProjectDurationMs: totalProjMs,
      items: recalculated,
      transcript: demoTranscript,
      chapters: demoChapters,
      isDemoSample,
      audioSettings: {
        voiceEnhanceEnabled: false,
        noiseRemovalEnabled: false,
        noiseReductionEnabled: false,
        highPassFreq: 80,
        eqPeakFreq: 3000,
        eqGainDb: 4,
        compressorThresholdDb: -20
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    set({
      project,
      currentProjectMs: 0,
      isPlaying: false,
      undoStack: [],
      redoStack: [],
      selectedItemId: null,
      thumbnails: {},
      thumbnailProgress: { current: 0, total: Math.min(300, Math.max(1, Math.floor(durationMs / 1000))), done: false },
      transcriptionStatus: 'idle',
      transcriptionDownloadPercent: 0,
      transcriptionCurrentFile: '',
      transcriptionError: null
    });

    // Generate thumbnails in background (1 per second, up to 300 total)
    generateSourceThumbnails(videoUrl, durationMs, (current, total) => {
      set({
        thumbnailProgress: { current, total, done: current >= total }
      });
    }).then((thumbnails) => {
      const count = Object.keys(thumbnails).length;
      set({
        thumbnails,
        thumbnailProgress: {
          current: count,
          total: count,
          done: true
        }
      });
    }).catch((err) => {
      console.warn('Background thumbnail generation failed:', err);
    });
  },

  setCurrentProjectMs: (ms) => set({ currentProjectMs: Math.max(0, Math.round(ms)) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPreviewSpeed: (previewSpeed) => set({ previewSpeed }),
  setTimelineZoom: (timelineZoom) => set({ timelineZoom: Math.max(1, Math.min(5, timelineZoom)) }),
  zoomIn: () => set((s) => ({ timelineZoom: Math.min(5, Number((s.timelineZoom + 0.5).toFixed(1))) })),
  zoomOut: () => set((s) => ({ timelineZoom: Math.max(1, Number((s.timelineZoom - 0.5).toFixed(1))) })),
  setMinSilenceDurationMs: (minSilenceDurationMs) => set({ minSilenceDurationMs }),
  setSilenceSensitivity: (silenceSensitivity) => set({
    silenceSensitivity,
    minSilenceDurationMs: SILENCE_PRESETS[silenceSensitivity]?.minSilenceMs ?? 500
  }),
  setSelectedLanguage: (selectedLanguage) => set({ selectedLanguage }),
  setTranscriptQuality: (transcriptQuality) => set({
    transcriptQuality,
    transcriptionError: null,
    transcriptionFallbackNotice: null,
    transcriptionStatus: 'idle'
  }),
  setTranscriptMode: (transcriptMode) => set({
    transcriptMode,
    transcriptionError: null,
    transcriptionFallbackNotice: null,
    transcriptionStatus: 'idle'
  }),

  updateTranscriptWord: (wordId, newText) => {
    const { project } = get();
    if (!project) return;
    const trimmed = newText.trim();
    if (!trimmed) return;
    const updated = project.transcript.map((w) => {
      if (w.id === wordId) {
        return { ...w, word: trimmed, edited: true };
      }
      return w;
    });
    set({
      project: {
        ...project,
        transcript: updated,
        updatedAt: Date.now()
      }
    });
  },

  generateTranscript: async (qual, m) => {
    const { project, transcriptQuality, transcriptMode } = get();
    if (!project) return;

    const chosenQuality = qual ?? transcriptQuality ?? 'accurate';
    const chosenMode = m ?? transcriptMode ?? 'translate_en';

    set({
      transcriptQuality: chosenQuality,
      transcriptMode: chosenMode,
      transcriptionStatus: 'extracting_audio',
      transcriptionDownloadPercent: 0,
      transcriptionCurrentFile: 'Extracting 16kHz audio...',
      transcriptionError: null,
      transcriptionFallbackNotice: null
    });

    try {
      const { words, chapters, meta } = await transcribeVideoAudio(
        project.sourceVideoUrl,
        chosenQuality,
        chosenMode,
        (progress) => {
          set({
            transcriptionStatus: progress.status,
            transcriptionDownloadPercent: progress.downloadPercent,
            transcriptionCurrentFile: progress.currentDownloadFile,
            transcriptionError: progress.errorMessage,
            transcriptionFallbackNotice: progress.fallbackMessage || null
          });
        },
        true // bypassCache on explicit generate/regenerate request
      );

      set((s) => ({
        transcriptionStatus: 'done',
        transcriptionDownloadPercent: 100,
        transcriptionCurrentFile: '',
        transcriptionError: null,
        transcriptQuality: meta.modelQuality,
        transcriptMode: meta.mode,
        project: s.project ? {
          ...s.project,
          transcript: words,
          chapters,
          transcriptMode: meta.mode,
          transcriptionMeta: meta,
          updatedAt: Date.now()
        } : null
      }));

      get().addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: `Generate transcript (${meta.modelName}, ${meta.mode})`,
        timestamp: Date.now(),
        parsedCommand: {
          action: 'GENERATE_TRANSCRIPT',
          payload: {},
          explanation: `Generated ${words.length} words and ${chapters.length} auto-chapters using ${meta.modelName} (${meta.device}) in ${(meta.durationMs / 1000).toFixed(1)}s.`
        },
        status: 'SUCCESS',
        appliedMessage: `Generated ${words.length} words and ${chapters.length} auto-chapters (${meta.modelName}, ${(meta.durationMs / 1000).toFixed(1)}s).`
      });
    } catch (err: any) {
      const errMsg = err?.message || 'Transcription failed.';
      set({
        transcriptionStatus: 'error',
        transcriptionError: errMsg
      });
      get().addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: `Generate transcript (${chosenQuality}, ${chosenMode})`,
        timestamp: Date.now(),
        parsedCommand: {
          action: 'GENERATE_TRANSCRIPT',
          payload: {},
          explanation: errMsg
        },
        status: 'WARNING',
        appliedMessage: errMsg
      });
    }
  },

  suggestNonSpeechSilences: () => {
    const { project } = get();
    if (!project || project.transcript.length === 0) {
      const msg = 'Please generate a transcript first to detect non-speech segments.';
      return { count: 0, totalDurationMs: 0, message: msg };
    }

    get().pushHistory();
    const { updatedItems, count, totalDurationMs } = suggestNonSpeechCuts(project.items, project.transcript);
    const recalculated = recalculateTimeline(updatedItems);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });

    const msg = `Found ${count} short non-speech segments totalling ${(totalDurationMs / 1000).toFixed(1)} s.`;
    get().addCommandLog({
      id: `cmd_${Date.now()}`,
      rawInput: 'Suggest non-speech cuts',
      timestamp: Date.now(),
      parsedCommand: {
        action: 'REMOVE_SILENCE',
        payload: { minDurationMs: 0, paddingPreMs: 0, paddingPostMs: 0 },
        explanation: msg
      },
      status: count > 0 ? 'SUCCESS' : 'WARNING',
      appliedMessage: msg
    });

    return { count, totalDurationMs, message: msg };
  },

  setSelectedItemId: (selectedItemId) => set({ selectedItemId }),

  addCommandLog: (log) => set((s) => ({
    commandLogs: [log, ...s.commandLogs]
  })),

  pushHistory: () => {
    const { project, undoStack } = get();
    if (!project) return;
    set({
      undoStack: [...undoStack, JSON.parse(JSON.stringify(project.items))],
      redoStack: []
    });
  },

  undo: () => {
    const { project, undoStack, redoStack } = get();
    if (!project || undoStack.length === 0) return;

    const previousItems = undoStack[undoStack.length - 1];
    const newUndo = undoStack.slice(0, -1);
    const newRedo = [JSON.parse(JSON.stringify(project.items)), ...redoStack];

    const recalculated = recalculateTimeline(previousItems);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      undoStack: newUndo,
      redoStack: newRedo,
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  redo: () => {
    const { project, undoStack, redoStack } = get();
    if (!project || redoStack.length === 0) return;

    const nextItems = redoStack[0];
    const newRedo = redoStack.slice(1);
    const newUndo = [...undoStack, JSON.parse(JSON.stringify(project.items))];

    const recalculated = recalculateTimeline(nextItems);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      undoStack: newUndo,
      redoStack: newRedo,
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  splitAtPlayhead: () => {
    const { project, currentProjectMs } = get();
    if (!project) return;
    get().pushHistory();

    const newItems = splitItemAtPlayhead(project.items, currentProjectMs);
    const totalProjMs = getTotalProjectDuration(newItems);

    set({
      project: {
        ...project,
        items: newItems,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  deleteSelected: () => {
    const { project, selectedItemId } = get();
    if (!project || !selectedItemId) return;
    get().pushHistory();

    const updated = project.items.map((it) =>
      it.id === selectedItemId ? { ...it, status: 'DELETED' as const } : it
    );
    const recalculated = recalculateTimeline(updated);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      selectedItemId: null,
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  acceptSilenceCut: (itemId: string) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const updated = project.items.map((it) =>
      it.id === itemId ? { ...it, status: 'DELETED' as const } : it
    );
    const recalculated = recalculateTimeline(updated);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  keepSilencePause: (itemId: string) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const updated = project.items.map((it) =>
      it.id === itemId ? { ...it, status: 'ACTIVE' as const } : it
    );
    const recalculated = recalculateTimeline(updated);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  detectSilencesOnly: async (param) => {
    const { project, silenceSensitivity } = get();
    if (!project) return { count: 0, message: 'No video project loaded.' };

    const effectiveSensitivity: SilenceSensitivity = typeof param === 'string'
      ? param
      : typeof param === 'number'
      ? (param >= 700 ? 'Gentle' : param <= 400 ? 'Tight' : 'Normal')
      : (silenceSensitivity ?? 'Normal');
    const res = await detectSilenceInVideo(project.sourceVideoUrl, project.sourceDurationMs, effectiveSensitivity);

    if (res.silences.length === 0) {
      const msg = `No pauses detected (${effectiveSensitivity} mode, noise floor ${res.noiseFloorDb.toFixed(1)} dB, threshold ${res.thresholdDb.toFixed(1)} dB).`;
      return { count: 0, message: msg };
    }

    get().pushHistory();
    const updated = injectSilenceCutsIntoTimeline(project.items, res.silences);
    const recalculated = recalculateTimeline(updated);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });

    const totalSec = res.silences.reduce((acc, s) => acc + s.durationMs, 0) / 1000;
    const msg = `Found ${res.rawGapsCount} raw gaps -> ${res.silences.length} merged regions (${totalSec.toFixed(1)}s, noise floor ${res.noiseFloorDb.toFixed(1)} dB, threshold ${res.thresholdDb.toFixed(1)} dB). Amber blocks added to timeline.`;
    return { count: res.silences.length, message: msg };
  },

  removeOrDetectSilences: async (param) => {
    const { project, silenceSensitivity } = get();
    if (!project) return { changed: false, message: 'No video project loaded.' };

    const effectiveSensitivity: SilenceSensitivity = typeof param === 'string'
      ? param
      : typeof param === 'number'
      ? (param >= 700 ? 'Gentle' : param <= 400 ? 'Tight' : 'Normal')
      : (silenceSensitivity ?? 'Normal');
    let items = [...project.items];
    let existingSuggested = items.filter(it => it.status === 'SUGGESTED_SILENCE_CUT');
    let rawGapsCount = existingSuggested.length;
    let noiseFloorDb = -50;
    let thresholdDb = -40;

    // If detector hasn't run yet, run it on demand
    if (existingSuggested.length === 0) {
      const res = await detectSilenceInVideo(project.sourceVideoUrl, project.sourceDurationMs, effectiveSensitivity);
      rawGapsCount = res.rawGapsCount;
      noiseFloorDb = res.noiseFloorDb;
      thresholdDb = res.thresholdDb;

      if (res.silences.length === 0) {
        return {
          changed: false,
          message: `No pauses detected (${effectiveSensitivity} mode, noise floor ${res.noiseFloorDb.toFixed(1)} dB, threshold ${res.thresholdDb.toFixed(1)} dB).`
        };
      }
      items = injectSilenceCutsIntoTimeline(items, res.silences);
      existingSuggested = items.filter(it => it.status === 'SUGGESTED_SILENCE_CUT');
    }

    const count = existingSuggested.length;
    const totalSilenceMs = existingSuggested.reduce((acc, it) => acc + it.durationMs, 0);

    get().pushHistory();

    const updated = items.map(it =>
      it.status === 'SUGGESTED_SILENCE_CUT' ? { ...it, status: 'DELETED' as const } : it
    );
    const recalculated = recalculateTimeline(updated);
    const newDurationMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: newDurationMs,
        updatedAt: Date.now()
      }
    });

    const msg = `Found ${rawGapsCount} raw gaps -> ${count} merged regions (${(totalSilenceMs / 1000).toFixed(1)}s removed, noise floor ${noiseFloorDb.toFixed(1)} dB, threshold ${thresholdDb.toFixed(1)} dB). New length ${(newDurationMs / 1000).toFixed(1)} s.`;
    return {
      changed: true,
      message: msg,
      count,
      totalSilenceMs,
      newDurationMs
    };
  },

  acceptAllSilences: async () => {
    return await get().removeOrDetectSilences();
  },

  setTransition: (itemId: string, type: TransitionType, durationMs = 400) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const updated = project.items.map((it) =>
      it.id === itemId
        ? { ...it, transitionOut: { type, durationMs: type === 'none' ? 0 : durationMs } }
        : it
    );
    const recalculated = recalculateTimeline(updated);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  trimProjectRange: (startMs: number, endMs: number) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const updated = splitAndTrimProjectRange(project.items, startMs, endMs);
    const totalProjMs = getTotalProjectDuration(updated);

    set({
      project: {
        ...project,
        items: updated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  insertLibraryMeme: async (memeId, atProjectMs) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const preset = MEME_PRESETS[memeId];
    if (!preset) return;

    const blobUrl = await getOrGenerateMemeBlob(memeId);

    // Split existing item at atProjectMs
    const splitItems = splitItemAtPlayhead(project.items, atProjectMs);

    // Locate the insertion index
    let insertIndex = splitItems.length;
    for (let i = 0; i < splitItems.length; i++) {
      if (splitItems[i].projectStartMs >= atProjectMs) {
        insertIndex = i;
        break;
      }
    }

    const memeItem: TimelineItem = {
      id: `meme_${memeId}_${Date.now()}`,
      kind: 'MEME_CLIP',
      title: preset.name,
      blobUrl,
      sourceStartMs: 0,
      sourceEndMs: preset.durationMs,
      durationMs: preset.durationMs,
      projectStartMs: atProjectMs,
      projectEndMs: atProjectMs + preset.durationMs,
      status: 'ACTIVE',
      transitionOut: { type: 'none', durationMs: 0 },
      meta: { memeCategory: memeId }
    };

    const newItems = [...splitItems];
    newItems.splice(insertIndex, 0, memeItem);

    const recalculated = recalculateTimeline(newItems);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  insertUserClip: (clipId, atProjectMs) => {
    const { project, customMemeClips } = get();
    if (!project) return;
    const clip = customMemeClips.find((c) => c.id === clipId);
    if (!clip) return;
    get().pushHistory();

    const splitItems = splitItemAtPlayhead(project.items, atProjectMs);

    let insertIndex = splitItems.length;
    for (let i = 0; i < splitItems.length; i++) {
      if (splitItems[i].projectStartMs >= atProjectMs) {
        insertIndex = i;
        break;
      }
    }

    const userMemeItem: TimelineItem = {
      id: `usermeme_${clip.id}_${Date.now()}`,
      kind: 'MEME_CLIP',
      title: clip.name,
      blobUrl: clip.blobUrl,
      sourceStartMs: 0,
      sourceEndMs: clip.durationMs,
      durationMs: clip.durationMs,
      projectStartMs: atProjectMs,
      projectEndMs: atProjectMs + clip.durationMs,
      status: 'ACTIVE',
      transitionOut: { type: 'none', durationMs: 0 },
      meta: { isCustomUpload: true }
    };

    const newItems = [...splitItems];
    newItems.splice(insertIndex, 0, userMemeItem);

    const recalculated = recalculateTimeline(newItems);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });
  },

  toggleVoiceEnhance: (enabled) => {
    const cur = get().voiceEnhanceEnabled;
    const next = enabled !== undefined ? enabled : !cur;
    set((s) => ({
      voiceEnhanceEnabled: next,
      isAudioEnhanceActive: next,
      project: s.project
        ? {
            ...s.project,
            audioSettings: {
              ...s.project.audioSettings,
              voiceEnhanceEnabled: next
            }
          }
        : null
    }));
  },

  toggleNoiseRemoval: (enabled) => {
    const cur = get().noiseRemovalEnabled;
    const next = enabled !== undefined ? enabled : !cur;
    set((s) => ({
      noiseRemovalEnabled: next,
      isNoiseReductionActive: next,
      project: s.project
        ? {
            ...s.project,
            audioSettings: {
              ...s.project.audioSettings,
              noiseRemovalEnabled: next,
              noiseReductionEnabled: next
            }
          }
        : null
    }));
  },

  toggleNoiseReduction: (enabled) => {
    get().toggleNoiseRemoval(enabled);
  },

  toggleAudioBypass: (bypassed) => {
    const cur = get().isAudioBypassed;
    const next = bypassed !== undefined ? bypassed : !cur;
    set({ isAudioBypassed: next });
  },

  addCustomMeme: async (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    // Determine duration
    const tempVideo = document.createElement('video');
    tempVideo.src = blobUrl;
    await new Promise<void>((resolve) => {
      tempVideo.onloadedmetadata = () => resolve();
      tempVideo.onerror = () => resolve();
    });

    const durationMs = Math.round((tempVideo.duration || 3) * 1000);
    const newMeme: CustomMeme = {
      id: `custom_${Date.now()}`,
      name: file.name.slice(0, 24),
      blobUrl,
      durationMs
    };

    set((s) => ({
      customMemeClips: [...s.customMemeClips, newMeme]
    }));

    return newMeme;
  },

  applyAICommand: async (command: AICommand, rawInput = '') => {
    const { action, payload, explanation } = command;
    const store = get();

    if (action === 'TRIM_SECTION') {
      store.trimProjectRange(payload.startMs, payload.endMs);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: `Trimmed section from ${(payload.startMs / 1000).toFixed(1)}s to ${(payload.endMs / 1000).toFixed(1)}s.`
      });
    } else if (action === 'REMOVE_SILENCE') {
      if (rawInput.toLowerCase().includes('non-speech') || rawInput.toLowerCase().includes('breath') || rawInput.toLowerCase().includes('ambient')) {
        store.suggestNonSpeechSilences();
        return;
      }
      const res = await store.removeOrDetectSilences(payload.minDurationMs);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: res.changed ? 'SUCCESS' : 'WARNING',
        appliedMessage: res.message
      });
    } else if (action === 'INSERT_LIBRARY_MEME') {
      await store.insertLibraryMeme(payload.memeId, payload.atProjectMs);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: `Inserted meme "${payload.memeId}" at ${(payload.atProjectMs / 1000).toFixed(1)}s.`
      });
    } else if (action === 'INSERT_USER_CLIP') {
      store.insertUserClip(payload.clipId, payload.atProjectMs);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: `Inserted custom clip at ${(payload.atProjectMs / 1000).toFixed(1)}s.`
      });
    } else if (action === 'ADD_TRANSITION') {
      const activeItems = store.project?.items.filter(it => it.status === 'ACTIVE') || [];
      const targetId = payload.clipId || (activeItems.length > 0 ? activeItems[0].id : undefined);
      if (targetId) {
        store.setTransition(targetId, payload.type, payload.durationMs);
        store.addCommandLog({
          id: `cmd_${Date.now()}`,
          rawInput,
          timestamp: Date.now(),
          parsedCommand: command,
          status: 'SUCCESS',
          appliedMessage: `Applied ${payload.type} transition (${payload.durationMs}ms).`
        });
      }
    } else if (action === 'ENHANCE_AUDIO') {
      store.toggleVoiceEnhance(payload.enabled);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: payload.enabled
          ? 'Speaker Voice Enhancement activated (80Hz HPF + 250Hz warmth cut + 3kHz boost + dynamic leveling).'
          : 'Speaker Voice Enhancement disabled.'
      });
    } else if (action === 'REMOVE_NOISE') {
      store.toggleNoiseRemoval(payload.enabled);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: payload.enabled
          ? 'Background Noise Removal activated (100Hz HPF + 7500Hz LPF + dynamic noise-floor gate).'
          : 'Background Noise Removal disabled.'
      });
    } else if (action === 'RESET_AUDIO') {
      store.toggleVoiceEnhance(false);
      store.toggleNoiseRemoval(false);
      store.toggleAudioBypass(false);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: 'Audio reset: Speaker Voice Enhancement and Background Noise Removal disabled.'
      });
    } else if (action === 'GENERATE_TRANSCRIPT') {
      const isHinglish = rawInput.toLowerCase().includes('hinglish') || rawInput.toLowerCase().includes('hindi');
      const isEnglishSpoken = rawInput.toLowerCase().includes('english') && rawInput.toLowerCase().includes('spoken');
      const mode: TranscriptMode = isHinglish ? 'transcribe_hinglish' : isEnglishSpoken ? 'transcribe_en' : 'translate_en';
      await store.generateTranscript(store.transcriptQuality, mode);
    } else if (action === 'GENERATE_TIMESTAMPS') {
      let curChapters = store.project?.chapters || [];
      if (curChapters.length === 0 || !store.project?.transcript || store.project.transcript.length === 0) {
        await store.generateTranscript();
        curChapters = get().project?.chapters || [];
      }
      const chapList = curChapters.map(c => `${(c.sourceMs / 1000).toFixed(1)}s: ${c.title}`).join(' | ');
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: chapList || 'No speech segments detected to form chapters.'
      });
    } else if (action === 'AMBIGUOUS_NEED_CLARIFICATION') {
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'CLARIFICATION',
        appliedMessage: payload.message
      });
    } else if (action === 'UNSUPPORTED_OPERATION') {
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'REJECTED',
        appliedMessage: payload.message || explanation
      });
    }
  }
}));
