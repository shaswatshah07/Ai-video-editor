import { create } from 'zustand';
import { ProjectEDL, TimelineItem, TransitionType, TranscriptModelQuality, TranscriptMode, TranscriptWord } from '../types/edl';
import { AICommand, CommandLogEntry } from '../types/commands';
import {
  recalculateTimeline,
  splitAndTrimProjectRange,
  splitItemAtPlayhead,
  getTotalProjectDuration
} from '../utils/timelineMath';
import { MEME_LIBRARY, getMemeById, findMemeByKeyword } from '../utils/memeLibrary';
import { detectSilenceInVideo, injectSilenceCutsIntoTimeline, SilenceSensitivity } from '../utils/silenceDetector';
import { generateSourceThumbnails, ThumbnailMap, ThumbnailProgress } from '../utils/thumbnailGenerator';
import { transcribeVideoAudio, suggestNonSpeechCuts, TranscriptionStatus, terminateTranscriptionWorker } from '../utils/transcriptionService';

export type ScreenState = 'UPLOAD' | 'WORKSPACE' | 'EXPORT';

export interface UploadedMemeClip {
  id: string;
  name: string;
  blobUrl: string;
  durationMs: number;
  file?: File;
  addedAt: number;
}

export type CustomMeme = UploadedMemeClip;

export interface BgMusicTrack {
  file: File;
  blobUrl: string;
  name: string;
  durationMs: number;
  volume: number; // 0.0 to 1.0, default 0.18 (18%)
  isMuted: boolean; // default false
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
  clipFilmstrips: Record<string, ThumbnailMap>;
  thumbnailProgress: ThumbnailProgress | null;
  selectedItemId: string | null;
  commandLogs: CommandLogEntry[];
  userUploadedClips: UploadedMemeClip[];
  undoStack: TimelineItem[][];
  redoStack: TimelineItem[][];
  voiceEnhanceEnabled: boolean;
  noiseRemovalEnabled: boolean;

  // Real Web Worker Transcription State (Part A & Quality/Mode Options)
  transcriptionStatus: TranscriptionStatus;
  transcriptionDownloadPercent: number;
  transcriptionError: string | null;
  transcriptionFallbackNotice: string | null;
  transcriptQuality: TranscriptModelQuality;
  transcriptMode: TranscriptMode;
  addedClipTranscribing: boolean;
  bgMusic: BgMusicTrack | null;

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
  zoomIn: () => void;
  zoomOut: () => void;
  setTranscriptQuality: (quality: TranscriptModelQuality) => void;
  setTranscriptMode: (mode: TranscriptMode) => void;
  updateTranscriptWord: (wordId: string, newText: string) => void;
  generateTranscript: (quality?: TranscriptModelQuality, mode?: TranscriptMode) => Promise<void>;
  transcribeAddedClip: (clipId: string, blobUrl: string, durationMs: number) => Promise<void>;
  suggestNonSpeechCuts: () => { count: number; totalDurationMs: number; message: string };
  setSelectedItemId: (id: string | null) => void;
  addCommandLog: (log: CommandLogEntry) => void;
  
  // Timeline editing actions
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  keepSilencePause: (itemId: string) => void;
  toggleSilenceSelected: (itemId: string) => void;
  clearAllSilences: () => void;
  applySelectedSilenceCuts: () => void;
  cancelTranscription: () => void;
  detectSilencesOnly: (param?: SilenceSensitivity | number) => Promise<{ count: number; message: string }>;
  removeOrDetectSilences: (param?: SilenceSensitivity | number) => Promise<{ changed: boolean; message: string; count?: number; totalSilenceMs?: number; newDurationMs?: number }>;
  setTransition: (itemId: string, type: TransitionType, durationMs?: number) => void;
  trimProjectRange: (startMs: number, endMs: number) => void;
  reorderTimelineItem: (sourceItemId: string, targetItemId: string, position: 'before' | 'after') => void;
  appendClipToEnd: (clip: { id: string; name: string; url: string; durationMs: number; isCustom?: boolean }) => Promise<void>;
  insertMemeAtProjectMs: (clip: { id: string; name: string; url: string; durationMs: number; isCustom?: boolean }, targetProjMs: number) => Promise<void>;
  replaceMemeClip: (itemId: string, newClip: { id: string; name: string; url: string; durationMs: number; isCustom?: boolean }) => Promise<void>;
  removeMemeClip: (itemId: string) => void;
  insertLibraryMeme: (memeId: string, atProjectMs: number) => Promise<void>;
  insertUserClip: (clipId: string, atProjectMs: number) => void;
  addUploadedMeme: (file: File) => Promise<UploadedMemeClip>;
  removeUploadedMeme: (clipId: string) => void;
  setBgMusic: (track: BgMusicTrack | null) => void;
  setBgMusicVolume: (volume: number) => void;
  toggleBgMusicMute: () => void;
  removeBgMusic: () => void;
  toggleVoiceEnhance: (enabled?: boolean) => void;
  toggleNoiseRemoval: (enabled?: boolean) => void;
  applyAICommand: (command: AICommand, rawInput?: string) => Promise<void>;
}

let transcriptionJobCounter = 0;

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
  clipFilmstrips: {},
  thumbnailProgress: null,
  selectedItemId: null,
  commandLogs: [],
  userUploadedClips: [],
  undoStack: [],
  redoStack: [],
  voiceEnhanceEnabled: false,
  noiseRemovalEnabled: false,
  transcriptionStatus: 'idle',
  transcriptionDownloadPercent: 0,
  transcriptionError: null,
  transcriptionFallbackNotice: null,
  bgMusic: null,
  transcriptQuality: 'fast',
  transcriptMode: 'transcribe_en',
  addedClipTranscribing: false,

  setScreen: (screen) => set({ screen }),

  loadProject: (videoUrl, fileName, fileSize, durationMs, initialItems, isDemoSample = false) => {
    const prevProject = get().project;
    if (prevProject && prevProject.sourceVideoUrl && prevProject.sourceVideoUrl !== videoUrl) {
      try {
        URL.revokeObjectURL(prevProject.sourceVideoUrl);
      } catch {
        // ignore
      }
    }

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
        noiseReductionEnabled: false
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const oldBgMusic = get().bgMusic;
    if (oldBgMusic?.blobUrl) URL.revokeObjectURL(oldBgMusic.blobUrl);

    set({
      project,
      currentProjectMs: 0,
      isPlaying: false,
      undoStack: [],
      redoStack: [],
      selectedItemId: null,
      thumbnails: {},
      clipFilmstrips: {},
      thumbnailProgress: { current: 0, total: Math.min(300, Math.max(1, Math.floor(durationMs / 1000))), done: false },
      transcriptionStatus: 'idle',
      transcriptionDownloadPercent: 0,
      transcriptionError: null,
      noiseRemovalEnabled: false,
      bgMusic: null
    });

    // Generate thumbnails in background (1 per second, up to 300 total)
    generateSourceThumbnails(videoUrl, durationMs, (current, total) => {
      set({
        thumbnailProgress: { current, total, done: current >= total }
      });
    }).then((thumbnails) => {
      const count = Object.keys(thumbnails).length;
      set((s) => ({
        thumbnails,
        clipFilmstrips: {
          ...s.clipFilmstrips,
          [videoUrl]: thumbnails
        },
        thumbnailProgress: {
          current: count,
          total: count,
          done: true
        }
      }));
    }).catch((err) => {
      console.warn('Background thumbnail generation failed:', err);
    });
  },

  setCurrentProjectMs: (ms) => set({ currentProjectMs: Math.max(0, Math.round(ms)) }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPreviewSpeed: (previewSpeed) => set({ previewSpeed }),
  zoomIn: () => set((s) => ({ timelineZoom: Math.min(5, Number((s.timelineZoom + 0.5).toFixed(1))) })),
  zoomOut: () => set((s) => ({ timelineZoom: Math.max(1, Number((s.timelineZoom - 0.5).toFixed(1))) })),
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

  cancelTranscription: () => {
    transcriptionJobCounter++;
    terminateTranscriptionWorker();
    set({
      transcriptionStatus: 'idle',
      transcriptionDownloadPercent: 0,
      transcriptionError: null,
      transcriptionFallbackNotice: null
    });
  },

  generateTranscript: async (qual, m) => {
    const currentJob = ++transcriptionJobCounter;
    const { project, transcriptQuality, transcriptMode } = get();
    if (!project) return;

    const chosenQuality = qual ?? transcriptQuality ?? 'fast';
    const chosenMode = m ?? transcriptMode ?? 'transcribe_en';

    set({
      transcriptQuality: chosenQuality,
      transcriptMode: chosenMode,
      transcriptionStatus: 'extracting_audio',
      transcriptionDownloadPercent: 0,
      transcriptionError: null,
      transcriptionFallbackNotice: null
    });

    try {
      const { words, chapters, meta } = await transcribeVideoAudio(
        project.sourceVideoUrl,
        chosenQuality,
        chosenMode,
        (progress) => {
          if (currentJob !== transcriptionJobCounter) return;
          set((s) => ({
            transcriptionStatus: progress.status,
            transcriptionDownloadPercent: Math.max(s.transcriptionDownloadPercent, progress.downloadPercent),
            transcriptionError: progress.errorMessage,
            transcriptionFallbackNotice: progress.fallbackMessage || null
          }));
        },
        true // bypassCache on explicit generate/regenerate request
      );

      if (currentJob !== transcriptionJobCounter) return;

      const taggedPrimaryWords: TranscriptWord[] = words.map((w) => ({
        ...w,
        clipId: 'primary'
      }));

      let allWords: TranscriptWord[] = [...taggedPrimaryWords];

      // Transcribe any added video clips currently on the timeline
      const addedClips = project.items.filter(
        (it) => it.kind === 'MEME_CLIP' && (it.meta?.isAddedClip || it.id.startsWith('clip_')) && it.status !== 'DELETED'
      );

      for (let i = 0; i < addedClips.length; i++) {
        if (currentJob !== transcriptionJobCounter) return;
        const clipItem = addedClips[i];
        set({
          transcriptionStatus: 'transcribing'
        });
        try {
          const clipRes = await transcribeVideoAudio(
            clipItem.blobUrl,
            chosenQuality,
            chosenMode,
            undefined,
            false
          );
          if (currentJob !== transcriptionJobCounter) return;
          const taggedClipWords: TranscriptWord[] = clipRes.words.map((w) => ({
            ...w,
            id: `${clipItem.id}_${w.id}`,
            clipId: clipItem.id
          }));
          allWords = [...allWords, ...taggedClipWords];
        } catch (clipErr) {
          console.warn(`Transcription for added clip ${clipItem.title} skipped or failed:`, clipErr);
        }
      }

      if (currentJob !== transcriptionJobCounter) return;

      set((s) => ({
        transcriptionStatus: 'done',
        transcriptionDownloadPercent: 100,
        transcriptionError: null,
        transcriptQuality: meta.modelQuality,
        transcriptMode: meta.mode,
        project: s.project ? {
          ...s.project,
          transcript: allWords,
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
      if (currentJob !== transcriptionJobCounter) return;
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

  suggestNonSpeechCuts: () => {
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

  keepSilencePause: (itemId: string) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const updated = project.items.map((it) =>
      it.id === itemId
        ? {
            ...it,
            status: 'ACTIVE' as const,
            title: project.sourceFileName || it.title
          }
        : it
    );

    // Coalesce adjacent active source clips that share the same origin
    const coalesced: TimelineItem[] = [];
    for (const it of updated) {
      if (coalesced.length === 0) {
        coalesced.push({ ...it });
        continue;
      }
      const prev = coalesced[coalesced.length - 1];
      if (
        prev.status === 'ACTIVE' &&
        it.status === 'ACTIVE' &&
        prev.kind === 'SOURCE_CLIP' &&
        it.kind === 'SOURCE_CLIP' &&
        prev.blobUrl === it.blobUrl &&
        Math.abs(prev.sourceEndMs - it.sourceStartMs) <= 5
      ) {
        prev.sourceEndMs = it.sourceEndMs;
        prev.durationMs = prev.sourceEndMs - prev.sourceStartMs;
        prev.projectEndMs = prev.projectStartMs + prev.durationMs;
        if (it.transitionOut && it.transitionOut.type !== 'none') {
          prev.transitionOut = it.transitionOut;
        }
        if (project.sourceFileName) {
          prev.title = project.sourceFileName;
        }
      } else {
        coalesced.push({ ...it });
      }
    }

    const recalculated = recalculateTimeline(coalesced);
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

  toggleSilenceSelected: (itemId: string) => {
    const { project } = get();
    if (!project) return;
    const updated = project.items.map((it) => {
      if (it.id === itemId && it.status === 'SUGGESTED_SILENCE_CUT') {
        const currentlySelected = it.meta?.silenceSelected !== false;
        return {
          ...it,
          meta: {
            ...it.meta,
            silenceSelected: !currentlySelected
          }
        };
      }
      return it;
    });
    set({
      project: {
        ...project,
        items: updated,
        updatedAt: Date.now()
      }
    });
  },

  clearAllSilences: () => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();
    const updated = project.items.map((it) =>
      it.status === 'SUGGESTED_SILENCE_CUT'
        ? {
            ...it,
            status: 'ACTIVE' as const,
            title: project.sourceFileName || it.title
          }
        : it
    );

    // Coalesce adjacent active source clips that share the same origin
    const coalesced: TimelineItem[] = [];
    for (const it of updated) {
      if (coalesced.length === 0) {
        coalesced.push({ ...it });
        continue;
      }
      const prev = coalesced[coalesced.length - 1];
      if (
        prev.status === 'ACTIVE' &&
        it.status === 'ACTIVE' &&
        prev.kind === 'SOURCE_CLIP' &&
        it.kind === 'SOURCE_CLIP' &&
        prev.blobUrl === it.blobUrl &&
        Math.abs(prev.sourceEndMs - it.sourceStartMs) <= 5
      ) {
        prev.sourceEndMs = it.sourceEndMs;
        prev.durationMs = prev.sourceEndMs - prev.sourceStartMs;
        prev.projectEndMs = prev.projectStartMs + prev.durationMs;
        if (it.transitionOut && it.transitionOut.type !== 'none') {
          prev.transitionOut = it.transitionOut;
        }
        if (project.sourceFileName) {
          prev.title = project.sourceFileName;
        }
      } else {
        coalesced.push({ ...it });
      }
    }

    const recalculated = recalculateTimeline(coalesced);
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

  applySelectedSilenceCuts: () => {
    const { project } = get();
    if (!project) return;

    const silencesToCut = project.items.filter(
      (it) => it.status === 'SUGGESTED_SILENCE_CUT' && it.meta?.silenceSelected !== false
    );
    const cutCount = silencesToCut.length;
    if (cutCount === 0) return;

    get().pushHistory();

    const savedMs = silencesToCut.reduce(
      (sum, it) => sum + (it.durationMs || (it.sourceEndMs - it.sourceStartMs)),
      0
    );
    const savedSec = (savedMs / 1000).toFixed(1);

    const updated = project.items.map((it) => {
      if (it.status === 'SUGGESTED_SILENCE_CUT') {
        const isSelected = it.meta?.silenceSelected !== false;
        return {
          ...it,
          status: isSelected ? ('DELETED' as const) : ('ACTIVE' as const)
        };
      }
      return it;
    });

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

    get().addCommandLog({
      id: `cmd_silence_${Date.now()}`,
      rawInput: 'Apply selected silence cuts',
      timestamp: Date.now(),
      parsedCommand: {
        action: 'REMOVE_SILENCE',
        payload: { minDurationMs: 0, paddingPreMs: 0, paddingPostMs: 0 },
        explanation: `Applied ${cutCount} silence cuts (saved ${savedSec}s)`
      },
      status: 'SUCCESS',
      appliedMessage: `Applied ${cutCount} silence cuts (saved ${savedSec}s)`
    });
  },

  detectSilencesOnly: async (param) => {
    const currentProject = get().project;
    if (!currentProject) return { count: 0, message: 'No video project loaded.' };

    const effectiveSensitivity: SilenceSensitivity = typeof param === 'string'
      ? (param === 'Tight' ? 'Sensitive' : param === 'Gentle' ? 'Strict' : param as SilenceSensitivity)
      : typeof param === 'number'
      ? (param >= 700 ? 'Strict' : param <= 400 ? 'Sensitive' : 'Normal')
      : (get().silenceSensitivity ?? 'Normal');

    const res = await detectSilenceInVideo(
      currentProject.sourceVideoUrl,
      currentProject.sourceDurationMs,
      effectiveSensitivity
    );

    const latestProject = get().project;
    if (!latestProject) return { count: 0, message: 'Project was closed.' };

    const msg = res.diagnosticMessage || (res.silences.length === 0
      ? (res.warning || `No pauses detected (${effectiveSensitivity} mode).`)
      : `Found ${res.silences.length} pause(s).`);

    if (res.silences.length === 0) {
      return { count: 0, message: msg };
    }

    get().pushHistory();
    const updated = injectSilenceCutsIntoTimeline(latestProject.items, res.silences);
    const recalculated = recalculateTimeline(updated);
    const totalProjMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...latestProject,
        items: recalculated,
        totalProjectDurationMs: totalProjMs,
        updatedAt: Date.now()
      }
    });

    return { count: res.silences.length, message: msg };
  },

  removeOrDetectSilences: async (param) => {
    let currentProject = get().project;
    if (!currentProject) return { changed: false, message: 'No video project loaded.' };

    const effectiveSensitivity: SilenceSensitivity = typeof param === 'string'
      ? (param === 'Tight' ? 'Sensitive' : param === 'Gentle' ? 'Strict' : param as SilenceSensitivity)
      : typeof param === 'number'
      ? (param >= 700 ? 'Strict' : param <= 400 ? 'Sensitive' : 'Normal')
      : (get().silenceSensitivity ?? 'Normal');

    let existingSuggested = currentProject.items.filter(it => it.status === 'SUGGESTED_SILENCE_CUT');
    const hadPriorSuggestions = existingSuggested.length > 0;
    let rawGapsCount = existingSuggested.length;
    let noiseFloorDb: number | null = null;
    let speechLevelDb: number | null = null;
    let thresholdDb: number | null = null;

    if (existingSuggested.length === 0) {
      const res = await detectSilenceInVideo(
        currentProject.sourceVideoUrl,
        currentProject.sourceDurationMs,
        effectiveSensitivity
      );
      currentProject = get().project;
      if (!currentProject) return { changed: false, message: 'Project was closed.' };

      rawGapsCount = res.rawGapsCount;
      noiseFloorDb = res.noiseFloorDb;
      speechLevelDb = res.speechLevelDb;
      thresholdDb = res.thresholdDb;

      if (res.silences.length === 0) {
        return {
          changed: false,
          message: res.diagnosticMessage || res.warning || `No pauses detected (${effectiveSensitivity} mode).`
        };
      }
      const injected = injectSilenceCutsIntoTimeline(currentProject.items, res.silences);
      currentProject = { ...currentProject, items: injected };
      existingSuggested = currentProject.items.filter(it => it.status === 'SUGGESTED_SILENCE_CUT');
    }

    const silencesToDelete = existingSuggested.filter(it => it.meta?.silenceSelected !== false);
    const count = silencesToDelete.length;
    if (count === 0) {
      return { changed: false, message: 'No selected silence cuts to apply.' };
    }
    const totalSilenceMs = silencesToDelete.reduce((acc, it) => acc + it.durationMs, 0);

    get().pushHistory();

    const updated = currentProject.items.map(it => {
      if (it.status === 'SUGGESTED_SILENCE_CUT') {
        const isSelected = it.meta?.silenceSelected !== false;
        return {
          ...it,
          status: isSelected ? ('DELETED' as const) : ('ACTIVE' as const),
          title: isSelected ? it.title : (currentProject?.sourceFileName || it.title)
        };
      }
      return it;
    });

    // Coalesce adjacent active source clips
    const coalesced: TimelineItem[] = [];
    for (const it of updated) {
      if (coalesced.length === 0) {
        coalesced.push({ ...it });
        continue;
      }
      const prev = coalesced[coalesced.length - 1];
      if (
        prev.status === 'ACTIVE' &&
        it.status === 'ACTIVE' &&
        prev.kind === 'SOURCE_CLIP' &&
        it.kind === 'SOURCE_CLIP' &&
        prev.blobUrl === it.blobUrl &&
        Math.abs(prev.sourceEndMs - it.sourceStartMs) <= 5
      ) {
        prev.sourceEndMs = it.sourceEndMs;
        prev.durationMs = prev.sourceEndMs - prev.sourceStartMs;
        prev.projectEndMs = prev.projectStartMs + prev.durationMs;
        if (it.transitionOut && it.transitionOut.type !== 'none') {
          prev.transitionOut = it.transitionOut;
        }
        if (currentProject.sourceFileName) {
          prev.title = currentProject.sourceFileName;
        }
      } else {
        coalesced.push({ ...it });
      }
    }

    const recalculated = recalculateTimeline(coalesced);
    const newDurationMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...currentProject,
        items: recalculated,
        totalProjectDurationMs: newDurationMs,
        updatedAt: Date.now()
      }
    });

    const secondsRemovedStr = (totalSilenceMs / 1000).toFixed(1);
    const newLengthStr = (newDurationMs / 1000).toFixed(1);
    const msg = hadPriorSuggestions || noiseFloorDb === null
      ? `Applied ${count} silence cuts (${secondsRemovedStr}s removed). New length ${newLengthStr}s.`
      : `Found ${rawGapsCount} raw gaps -> ${count} merged regions (${secondsRemovedStr}s removed, speech ${speechLevelDb!.toFixed(1)} dB, noise ${noiseFloorDb!.toFixed(1)} dB, threshold ${thresholdDb!.toFixed(1)} dB). New length ${newLengthStr}s.`;

    return {
      changed: true,
      message: msg,
      count,
      totalSilenceMs,
      newDurationMs
    };
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
    const totalDuration = project.totalProjectDurationMs;
    const totalDurSec = totalDuration / 1000;
    const startSec = startMs / 1000;
    const endSec = endMs / 1000;

    if (startMs >= totalDuration || endMs <= startMs || (endMs - startMs) < 50) {
      console.warn(`Nothing trimmed — ${startSec.toFixed(1)}s to ${endSec.toFixed(1)}s is outside the current video length (0s to ${totalDurSec.toFixed(1)}s).`);
      return;
    }

    const clampedEndMs = Math.min(totalDuration, Math.max(startMs, endMs));
    get().pushHistory();

    const updated = splitAndTrimProjectRange(project.items, Math.max(0, startMs), clampedEndMs);
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

  reorderTimelineItem: (sourceItemId: string, targetItemId: string, position: 'before' | 'after') => {
    const { project } = get();
    if (!project || sourceItemId === targetItemId) return;

    const sourceIndex = project.items.findIndex((it) => it.id === sourceItemId);
    const targetIndex = project.items.findIndex((it) => it.id === targetItemId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const sourceItem = project.items[sourceIndex];
    const targetItem = project.items[targetIndex];

    get().pushHistory();

    const newItems = [...project.items];
    newItems.splice(sourceIndex, 1);

    const newTargetIndex = newItems.findIndex((it) => it.id === targetItemId);
    if (newTargetIndex === -1) return;

    const insertAt = position === 'before' ? newTargetIndex : newTargetIndex + 1;
    newItems.splice(insertAt, 0, sourceItem);

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

    const msg = `Moved clip "${sourceItem.title || 'Clip'}" ${position} "${targetItem.title || 'Clip'}".`;
    get().addCommandLog({
      id: `cmd_${Date.now()}`,
      rawInput: `Reorder clip (${position})`,
      timestamp: Date.now(),
      parsedCommand: {
        action: 'TRIM_SECTION',
        payload: { startMs: sourceItem.projectStartMs, endMs: sourceItem.projectEndMs },
        explanation: msg
      },
      status: 'SUCCESS',
      appliedMessage: msg
    });
  },

  appendClipToEnd: async (clip: { id: string; name: string; url: string; durationMs: number; isCustom?: boolean }) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const currentTotalMs = getTotalProjectDuration(project.items);
    const newItem: TimelineItem = {
      id: `clip_${clip.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      kind: 'MEME_CLIP',
      title: clip.name,
      blobUrl: clip.url,
      sourceStartMs: 0,
      sourceEndMs: clip.durationMs,
      durationMs: clip.durationMs,
      projectStartMs: currentTotalMs,
      projectEndMs: currentTotalMs + clip.durationMs,
      status: 'ACTIVE',
      transitionOut: { type: 'none', durationMs: 0 },
      meta: {
        memeCategory: clip.id,
        isCustomUpload: !!clip.isCustom,
        isAddedClip: true
      }
    };

    const newItems = [...project.items, newItem];
    const recalculated = recalculateTimeline(newItems);
    const newTotalMs = getTotalProjectDuration(recalculated);

    set({
      project: {
        ...project,
        items: recalculated,
        totalProjectDurationMs: newTotalMs,
        updatedAt: Date.now()
      }
    });

    // Generate thumbnails for the added clip in background
    generateSourceThumbnails(clip.url, clip.durationMs)
      .then((clipThumbs) => {
        set((s) => ({
          clipFilmstrips: {
            ...s.clipFilmstrips,
            [clip.url]: clipThumbs
          }
        }));
      })
      .catch((err) => console.warn('Thumbnail generation for added clip failed:', err));

    // If project already has transcript, auto-transcribe this added clip in background
    if (project.transcript && project.transcript.length > 0 && !project.isDemoSample) {
      get().transcribeAddedClip(newItem.id, clip.url, clip.durationMs);
    }

    const msg = `Appended "${clip.name}" (${(clip.durationMs / 1000).toFixed(1)}s) to end of timeline.`;
    get().addCommandLog({
      id: `cmd_${Date.now()}`,
      rawInput: `Add clip "${clip.name}" to end`,
      timestamp: Date.now(),
      parsedCommand: {
        action: 'INSERT_USER_CLIP',
        payload: { clipId: clip.id, atProjectMs: currentTotalMs },
        explanation: msg
      },
      status: 'SUCCESS',
      appliedMessage: msg
    });
  },

  transcribeAddedClip: async (clipId: string, blobUrl: string, _durationMs?: number) => {
    const { transcriptQuality, transcriptMode, project } = get();
    if (!project) return;
    set({ addedClipTranscribing: true });
    try {
      const res = await transcribeVideoAudio(
        blobUrl,
        transcriptQuality || 'accurate',
        transcriptMode || 'translate_en',
        undefined,
        false
      );
      const taggedWords: TranscriptWord[] = res.words.map((w) => ({
        ...w,
        id: `${clipId}_${w.id}`,
        clipId
      }));
      set((s) => {
        if (!s.project) return { addedClipTranscribing: false };
        const existingWithoutClip = s.project.transcript.filter((w) => w.clipId !== clipId);
        return {
          addedClipTranscribing: false,
          project: {
            ...s.project,
            transcript: [...existingWithoutClip, ...taggedWords],
            updatedAt: Date.now()
          }
        };
      });
      get().addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: `Transcribe added clip`,
        timestamp: Date.now(),
        parsedCommand: {
          action: 'GENERATE_TRANSCRIPT',
          payload: {},
          explanation: `Generated ${taggedWords.length} words for added clip.`
        },
        status: 'SUCCESS',
        appliedMessage: `Generated ${taggedWords.length} words for added clip.`
      });
    } catch (err: any) {
      console.warn('Background transcription of added clip failed:', err);
      set({ addedClipTranscribing: false });
    }
  },

  insertMemeAtProjectMs: async (clip, targetProjMs) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    // 1. Split existing active source clip at targetProjMs
    const splitItems = splitItemAtPlayhead(project.items, targetProjMs);

    // 2. Locate insertion index
    let insertIndex = splitItems.length;
    for (let i = 0; i < splitItems.length; i++) {
      if (splitItems[i].projectStartMs >= targetProjMs) {
        insertIndex = i;
        break;
      }
    }

    const memeItem: TimelineItem = {
      id: `meme_${clip.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      kind: 'MEME_CLIP',
      title: clip.name,
      blobUrl: clip.url,
      sourceStartMs: 0,
      sourceEndMs: clip.durationMs,
      durationMs: clip.durationMs,
      projectStartMs: targetProjMs,
      projectEndMs: targetProjMs + clip.durationMs,
      status: 'ACTIVE',
      transitionOut: { type: 'none', durationMs: 0 },
      meta: {
        memeCategory: clip.id,
        isCustomUpload: !!clip.isCustom
      }
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

  replaceMemeClip: async (itemId, newClip) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const items = project.items.map((it) => {
      if (it.id === itemId && it.kind === 'MEME_CLIP') {
        return {
          ...it,
          title: newClip.name,
          blobUrl: newClip.url,
          sourceStartMs: 0,
          sourceEndMs: newClip.durationMs,
          durationMs: newClip.durationMs,
          meta: {
            ...it.meta,
            memeCategory: newClip.id,
            isCustomUpload: !!newClip.isCustom
          }
        };
      }
      return it;
    });

    const recalculated = recalculateTimeline(items);
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

  removeMemeClip: (itemId) => {
    const { project } = get();
    if (!project) return;
    get().pushHistory();

    const filtered = project.items.filter((it) => it.id !== itemId);

    // Coalesce adjacent active source clips that share the same origin
    const coalesced: TimelineItem[] = [];
    for (const it of filtered) {
      if (coalesced.length === 0) {
        coalesced.push({ ...it });
        continue;
      }
      const prev = coalesced[coalesced.length - 1];
      if (
        prev.status === 'ACTIVE' &&
        it.status === 'ACTIVE' &&
        prev.kind === 'SOURCE_CLIP' &&
        it.kind === 'SOURCE_CLIP' &&
        prev.blobUrl === it.blobUrl &&
        prev.sourceEndMs === it.sourceStartMs
      ) {
        prev.sourceEndMs = it.sourceEndMs;
        prev.durationMs = prev.sourceEndMs - prev.sourceStartMs;
        prev.projectEndMs = prev.projectStartMs + prev.durationMs;
      } else {
        coalesced.push({ ...it });
      }
    }

    const recalculated = recalculateTimeline(coalesced);
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

  insertLibraryMeme: async (memeId, atProjectMs) => {
    const meme = getMemeById(memeId) || findMemeByKeyword(memeId) || MEME_LIBRARY[0];
    await get().insertMemeAtProjectMs({
      id: meme.id,
      name: meme.title,
      url: meme.url,
      durationMs: meme.durationMs,
      isCustom: false
    }, atProjectMs);
  },

  insertUserClip: (clipId, atProjectMs) => {
    const { userUploadedClips } = get();
    const clip = userUploadedClips.find((c) => c.id === clipId) || userUploadedClips[userUploadedClips.length - 1];
    if (!clip) return;

    get().insertMemeAtProjectMs({
      id: clip.id,
      name: clip.name,
      url: clip.blobUrl,
      durationMs: clip.durationMs,
      isCustom: true
    }, atProjectMs);
  },

  toggleVoiceEnhance: (enabled) => {
    const cur = get().voiceEnhanceEnabled;
    const next = enabled !== undefined ? enabled : !cur;
    set((s) => ({
      voiceEnhanceEnabled: next,
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

  setBgMusic: (track) => {
    const prev = get().bgMusic;
    if (prev?.blobUrl && (!track || prev.blobUrl !== track.blobUrl)) {
      URL.revokeObjectURL(prev.blobUrl);
    }
    set({ bgMusic: track });
    if (track) {
      get().addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput: `Added background music: "${track.name}"`,
        timestamp: Date.now(),
        parsedCommand: {
          action: 'INSERT_USER_CLIP',
          payload: { clipId: track.name, atProjectMs: 0 },
          explanation: `Added background music track "${track.name}" at ${Math.round(track.volume * 100)}% volume.`
        },
        status: 'SUCCESS',
        appliedMessage: `Added background music: "${track.name}" (${Math.round(track.volume * 100)}% volume)`
      });
    }
  },

  setBgMusicVolume: (volume) => {
    const { bgMusic } = get();
    if (!bgMusic) return;
    const clamped = Math.max(0, Math.min(1, Number(volume.toFixed(2))));
    set({ bgMusic: { ...bgMusic, volume: clamped } });
  },

  toggleBgMusicMute: () => {
    const { bgMusic } = get();
    if (!bgMusic) return;
    set({ bgMusic: { ...bgMusic, isMuted: !bgMusic.isMuted } });
  },

  removeBgMusic: () => {
    const prev = get().bgMusic;
    if (prev?.blobUrl) {
      URL.revokeObjectURL(prev.blobUrl);
    }
    set({ bgMusic: null });
    get().addCommandLog({
      id: `cmd_${Date.now()}`,
      rawInput: 'Removed background music',
      timestamp: Date.now(),
      parsedCommand: {
        action: 'RESET_AUDIO',
        payload: {},
        explanation: 'Removed background music track.'
      },
      status: 'SUCCESS',
      appliedMessage: 'Removed background music track.'
    });
  },

  addUploadedMeme: async (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.muted = true;
    tempVideo.src = blobUrl;

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Video metadata timeout (10s)'));
        }, 10000);

        const onLoaded = () => {
          cleanup();
          resolve();
        };

        const onError = () => {
          cleanup();
          reject(new Error('Failed to load video file'));
        };

        function cleanup() {
          clearTimeout(timeout);
          tempVideo.onloadedmetadata = null;
          tempVideo.onerror = null;
        }

        tempVideo.onloadedmetadata = onLoaded;
        tempVideo.onerror = onError;
      });
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      throw err;
    }

    const durationMs = Math.round((tempVideo.duration || 3) * 1000);
    const newClip: UploadedMemeClip = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: file.name.replace(/\.[^/.]+$/, '').slice(0, 32),
      blobUrl,
      durationMs,
      file,
      addedAt: Date.now()
    };

    set((s) => ({
      userUploadedClips: [...(s.userUploadedClips || []), newClip]
    }));

    return newClip;
  },

  removeUploadedMeme: (clipId: string) => {
    const { userUploadedClips, project } = get();
    const clip = userUploadedClips.find(c => c.id === clipId);
    if (clip?.blobUrl) {
      const isUsedInTimeline = project?.items.some(it => it.blobUrl === clip.blobUrl);
      if (!isUsedInTimeline) {
        URL.revokeObjectURL(clip.blobUrl);
      }
    }
    set((s) => ({
      userUploadedClips: (s.userUploadedClips || []).filter(c => c.id !== clipId)
    }));
  },

  applyAICommand: async (command: AICommand, rawInput = '') => {
    const { action, payload, explanation } = command;
    const store = get();

    if (action === 'TRIM_SECTION') {
      const totalDurMs = store.project?.totalProjectDurationMs || 0;
      const totalDurSec = totalDurMs / 1000;
      const startSec = payload.startMs / 1000;
      const endSec = payload.endMs / 1000;

      if (payload.startMs >= totalDurMs || payload.endMs <= payload.startMs || (payload.endMs - payload.startMs) < 50) {
        store.addCommandLog({
          id: `cmd_${Date.now()}`,
          rawInput,
          timestamp: Date.now(),
          parsedCommand: command,
          status: 'WARNING',
          appliedMessage: `Nothing trimmed — ${startSec.toFixed(1)}s to ${endSec.toFixed(1)}s is outside the current video length (0s to ${totalDurSec.toFixed(1)}s).`
        });
        return;
      }

      const clampedEndMs = Math.min(totalDurMs, payload.endMs);
      const wasClamped = payload.endMs > totalDurMs;

      store.trimProjectRange(payload.startMs, clampedEndMs);
      const appliedMsg = wasClamped
        ? `Trimmed section from ${startSec.toFixed(1)}s to ${(clampedEndMs / 1000).toFixed(1)}s (clamped to end of video).`
        : `Trimmed section from ${startSec.toFixed(1)}s to ${endSec.toFixed(1)}s.`;

      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: appliedMsg
      });
    } else if (action === 'REMOVE_SILENCE') {
      if (rawInput.toLowerCase().includes('non-speech') || rawInput.toLowerCase().includes('breath') || rawInput.toLowerCase().includes('ambient')) {
        store.suggestNonSpeechCuts();
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
      const meme = getMemeById(payload.memeId) || findMemeByKeyword(payload.memeId) || MEME_LIBRARY[0];
      await store.insertLibraryMeme(payload.memeId, payload.atProjectMs);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: `Inserted meme "${meme.title}" at ${(payload.atProjectMs / 1000).toFixed(1)}s.`
      });
    } else if (action === 'INSERT_USER_CLIP') {
      const clips = store.userUploadedClips || [];
      if (clips.length === 0) {
        store.addCommandLog({
          id: `cmd_${Date.now()}`,
          rawInput,
          timestamp: Date.now(),
          parsedCommand: command,
          status: 'WARNING',
          appliedMessage: `No custom meme uploaded yet. Please upload your .mp4 clip under "Insert Your Own Meme" first.`
        });
        return;
      }
      const clipToInsert = payload.clipId === 'custom_latest' || !payload.clipId
        ? clips[clips.length - 1]
        : (clips.find(c => c.id === payload.clipId) || clips[clips.length - 1]);

      store.insertUserClip(clipToInsert.id, payload.atProjectMs);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: `Inserted custom meme "${clipToInsert.name}" at ${(payload.atProjectMs / 1000).toFixed(1)}s.`
      });
    } else if (action === 'ADD_TRANSITION') {
      const activeItems = store.project?.items.filter(it => it.status === 'ACTIVE') || [];
      if (activeItems.length === 0) {
        store.addCommandLog({
          id: `cmd_${Date.now()}`,
          rawInput,
          timestamp: Date.now(),
          parsedCommand: command,
          status: 'WARNING',
          appliedMessage: 'No active clips on timeline to add a transition to.'
        });
        return;
      }
      const selectedActive = activeItems.find(it => it.id === store.selectedItemId);
      const targetId = payload.clipId || (selectedActive ? selectedActive.id : activeItems[0].id);
      store.setTransition(targetId, payload.type, payload.durationMs);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: `Applied ${payload.type} transition (${payload.durationMs}ms).`
      });
    } else if (action === 'ENHANCE_AUDIO') {
      store.toggleVoiceEnhance(payload.enabled);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: payload.enabled
          ? 'Speaker Voice Enhancement activated (EQ & dynamic leveling).'
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
          ? 'Reduce Low Hum (Basic) activated (high-pass filter).'
          : 'Reduce Low Hum (Basic) disabled.'
      });
    } else if (action === 'RESET_AUDIO') {
      store.toggleVoiceEnhance(false);
      store.toggleNoiseRemoval(false);
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: 'Audio reset: Speaker Voice Enhancement and Reduce Low Hum (Basic) disabled.'
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
      if (curChapters.length > 0) {
        const chapList = curChapters.map(c => `${(c.sourceMs / 1000).toFixed(1)}s: ${c.title}`).join(' | ');
        store.addCommandLog({
          id: `cmd_${Date.now()}`,
          rawInput,
          timestamp: Date.now(),
          parsedCommand: command,
          status: 'SUCCESS',
          appliedMessage: chapList
        });
      } else {
        store.addCommandLog({
          id: `cmd_${Date.now()}`,
          rawInput,
          timestamp: Date.now(),
          parsedCommand: command,
          status: 'WARNING',
          appliedMessage: 'No speech segments detected to form chapters.'
        });
      }
    } else if (action === 'ASSISTANT_ADVICE') {
      store.addCommandLog({
        id: `cmd_${Date.now()}`,
        rawInput,
        timestamp: Date.now(),
        parsedCommand: command,
        status: 'SUCCESS',
        appliedMessage: payload.message || explanation
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
