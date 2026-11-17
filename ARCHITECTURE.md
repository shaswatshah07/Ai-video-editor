# FINAL ARCHITECTURE LOCK (v4.0) — SINGLE SOURCE OF TRUTH

## 1. LOCKED SYSTEM ARCHITECTURE (STRICT ₹0 BUDGET)
- **Deployment Pipeline:** Antigravity + VS Code -> GitHub -> Vercel Hobby (₹0, no credit card required).
- **Frontend & State:** React 18 + TypeScript + Vite + Tailwind CSS + Lucide React + Zustand + Zod.
- **Terminal Execution Rule:** In Windows PowerShell, always invoke `npm.cmd` and `npx.cmd` (never bare `npm` or `npx`).
- **AI Command Proxy:** Vercel Serverless Function (`api/command.ts`) reading `process.env.GEMINI_API_KEY` and `process.env.GEMINI_MODEL` (Google AI Studio Free Tier, 10 req/min IP rate limit). If the key is unset, rate-limited (429), or offline, it automatically triggers the local deterministic regex parser in `src/utils/commandParser.ts` without crashing.
- **Client-Side Media Engine:** 100% of video playback, audio filtering, silence detection, and MP4 rendering runs inside the user's browser. Original uploaded files are never modified.

---

## 2. THE 8 LOCKED ENGINEERING SPECIFICATIONS

### Spec 1 — Unified Integer-Millisecond EDL (`src/types/edl.ts` & `src/store/useEditorStore.ts`)
- All timeline coordinates use integer milliseconds (`ms`) to eliminate floating-point drift.
- Source video slices and inserted memes live in one unified `TimelineItem[]` array:
  - `id: string`
  - `kind: 'SOURCE_CLIP' | 'MEME_CLIP'`
  - `title: string`
  - `blobUrl: string`
  - `sourceStartMs: number`
  - `sourceEndMs: number`
  - `durationMs: number`
  - `projectStartMs: number`
  - `projectEndMs: number`
  - `status: 'ACTIVE' | 'SUGGESTED_SILENCE_CUT' | 'SUGGESTED_MEME' | 'DELETED'`
  - `transitionOut: { type: 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideup'; durationMs: number }`
- `recalculateTimeline(items)` deterministically computes `projectStartMs` and `projectEndMs` (accounting for transition overlaps) on every state mutation.
- Non-destructive `undoStack` and `redoStack` store full EDL snapshots.

### Spec 2 — Project-Time (`T_proj`) vs. Source-Time (`T_src`) Coordinate Mapping
- User commands (e.g., "Cut from 0:15 to 0:30") execute against visible Project Time (`T_proj`), splitting overlapping `'ACTIVE'` segments and marking the cut slice `'DELETED'`.
- Transcript words and chapter markers store `sourceStartMs` and map dynamically to `T_proj` via `mapSourceToProjectMs(sourceMs, items)`.

### Spec 3 — Dual-`<video>` Virtual Player with `requestAnimationFrame` Sync
- Screen 2 renders two stacked `<video>` elements (`mainVideoRef` for source video, `memeVideoRef` for inserted meme clips).
- A `requestAnimationFrame` loop (not `onTimeUpdate`) tracks `T_proj`, jumps over `'DELETED'` segments in <16ms using a `lastSeekTargetRef` guard to prevent seek loops, swaps seamlessly to `memeVideoRef` during `'MEME_CLIP'` items, and renders live CSS transitions (`fade`, `dissolve`, `wipeleft`, `wiperight`, `slideup`) across cut points.

### Spec 4 — Live Web Audio API Mastering & Instant RMS Silence Detection
- `mainVideoRef` connects to a Web Audio API `AudioContext` chain (`80Hz` high-pass `BiquadFilterNode`, `3kHz` `+3dB` peaking EQ `BiquadFilterNode`, and `DynamicsCompressorNode`) for real-time A/B voice enhancement and noise reduction during playback.
- Auto-Edit silence detection decodes audio via `AudioContext.decodeAudioData()`, scans RMS energy in 50ms windows, and flags silent gaps `> 1200ms` as `'SUGGESTED_SILENCE_CUT'` with mandatory `+200ms` post-speech and `-150ms` pre-speech safety padding.

### Spec 5 — Synchronized 9-Operation Command Allowlist (`src/types/commands.ts`)
- Both the Gemini API proxy and local regex parser enforce one strict Zod schema supporting ONLY:
  1. `TRIM_SECTION`
  2. `REMOVE_SILENCE`
  3. `INSERT_LIBRARY_MEME`
  4. `INSERT_USER_CLIP`
  5. `ADD_TRANSITION`
  6. `ENHANCE_AUDIO`
  7. `REMOVE_NOISE`
  8. `GENERATE_TRANSCRIPT`
  9. `GENERATE_TIMESTAMPS`
  Plus `AMBIGUOUS_NEED_CLARIFICATION` and `UNSUPPORTED_OPERATION`.
- Unsupported prompts (e.g., "Add overlapping effect at 5:30", "3D text", "speed up") are politely refused without mutating state. Ambiguous prompts ("Remove the boring part") ask for exact timestamps.

### Spec 6 — Single-Threaded `FFmpeg.wasm` Two-Mode Render Engine (`src/utils/ffmpegExporter.ts`)
- Uses single-threaded `@ffmpeg/core` inside a background worker so it never fails on missing `COOP`/`COEP` headers.
- Enforces upload guardrails of 250 MB and 5 minutes (`.mp4`/`.mov`).
- Mode A (Stream Copy): Uses `-c copy` concat when only straight cuts exist.
- Mode B (Filtergraph Re-encode): Uses `-c:v libx264 -preset ultrafast -crf 23 -c:a aac` when audio filters (`highpass=f=80,equalizer=f=3000:t=q:w=1.5:g=3,acompressor,loudnorm=I=-16:TP=-1.5:LRA=11` and `afftdn=nf=-25`), meme splices, or `xfade` transitions are active.
- Output Verification Gate verifies non-zero byte size and valid `<video>` duration metadata before displaying export completion.

### Spec 7 — Three-Screen Flow & Sample Demo Loader
- **Screen 1:** Upload `.mp4`/`.mov` or click "Load Sample Demo Video" (programmatically generated playable canvas/audio clip), then choose Auto Edit (6 checkboxes) or Custom Edit.
- **Screen 2:** InShot-inspired workspace with Dual-`<video>` Player, interactive zoomable timeline (silence cut approvals, transition badges, meme markers, Split/Delete/Undo/Redo), collapsible Transcript & Chapters sidebar, and AI Command Hub with custom meme uploader.
- **Screen 3:** Real `FFmpeg.wasm` render progress bar, verified output preview, Download MP4 button, and Back to Workspace button.
