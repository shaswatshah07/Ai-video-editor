# REVISION 3.1 — FINAL VERIFIED ARCHITECTURE BLUEPRINT
## AI-Powered Video Editor MVP — Scaler YIIC 9.0
### Strict ₹0 Budget | Browser-Side Media Engine | Gemini Free Tier | Vercel Hobby + GitHub

---

## 1. EXECUTIVE SUMMARY

This document is the final, independently verified architecture for the AI-Powered Video Editor MVP. Every major claim has been researched against current official documentation and is tagged with its verification status. The architecture delivers a genuine, functional video editor where evaluators upload real video, edit it through an InShot-inspired workspace with AI-powered natural-language commands, and download an actually edited MP4 — all at absolute ₹0 cost.

**Core architectural principles (all retained from prior revisions):**
- 100% client-side video processing via WebAssembly (no cloud rendering)
- Non-destructive Edit Decision List with undo/redo
- Google Gemini Free Tier for natural-language command parsing only
- API key secured server-side in Vercel Environment Variables
- Original footage immutable, never uploaded to any server
- Antigravity → VS Code → GitHub → Vercel deployment pipeline

---

## 2. OVERALL ASSESSMENT OF REVISION 3

### What was correct and is retained

| Decision | Status |
|---|---|
| Browser-side video processing via `@ffmpeg/ffmpeg` WASM | **Retained** |
| React 18 + TypeScript + Vite frontend | **Retained** |
| GitHub → Vercel automatic deployment | **Retained** |
| Non-destructive EDL with immutable source | **Retained** |
| Gemini used only for command text parsing, never for media | **Retained** |
| API key in Vercel Environment Variables, never in frontend | **Retained** |
| Web Workers for heavy processing | **Retained** |
| IndexedDB for persistent blob storage | **Retained** |
| Local regex fallback when Gemini is unavailable | **Retained** |
| `vercel.json` for COOP/COEP headers | **Retained** |
| Zustand for state management | **Retained** |
| Zod for runtime schema validation | **Retained** |

### What is modified

| Issue in Revision 3 | Correction in 3.1 |
|---|---|
| Used `gemini-1.5-flash` (old model) | Changed to `gemini-3.5-flash-lite` per dashboard data |
| Claimed 15 RPM / 1,500 RPD for Gemini | Corrected to 15 RPM / 500 RPD per user's dashboard |
| Used `@xenova/transformers` (deprecated package) | Changed to `@huggingface/transformers` v4.3.x |
| Listed Vercel Node.js runtime as 20.x | Updated to 22.x / 24.x / 26.x (Node 20 is EOL on Vercel) |
| Whisper model was `Xenova/whisper-tiny` | Changed to `onnx-community/whisper-tiny` for v3/v4 API |
| Labeled `@ffmpeg/core` as LGPL 2.1 | Corrected: the standard build with libx264 is **GPL-2.0-or-later** |
| `mapProjectTimeToSourceTime` used accumulated durations | Rewritten to use explicit `projectStartMs` with half-open intervals |
| Meme assets referenced by ephemeral `blobUrl` | Changed to IndexedDB-stored blobs with URL regeneration |
| `vercel dev` described without mentioning login requirement | Documented: `vercel dev` requires CLI login; alternative local dev strategy provided |
| Performance figures labeled as verified | All relabeled as **[Estimated]** — none have been actually benchmarked |
| 5-minute / 250MB file limits | Reduced to 3-minute / 150MB as conservative starting point, subject to Phase 3 testing |
| RNNoise package was `@timephy/rnnoise-wasm` | Changed to `@sapphi-red/web-noise-suppressor` (actively maintained, MIT license) |

### What is replaced or removed

| Removed Item | Reason |
|---|---|
| References to Replit deployment | Replaced entirely by Vercel Hobby |
| Python FastAPI backend | Eliminated — no server-side processing |
| SQLite database | Eliminated — all state in browser IndexedDB + Zustand |
| Stream copy (`-c copy`) as default export | Removed — re-encoding is the default for accuracy |
| Claims of "tested" browser performance | Relabeled honestly as estimates pending Phase 3 spike |
| `faster-whisper` / `Silero VAD` Python packages | Replaced by browser-native equivalents |
| Fabricated benchmark numbers | Removed entirely or marked as estimates |

---

## 3. FINAL SYSTEM ARCHITECTURE

```
+─────────────────────────────────────────────────────────────────────────────────────────+
|                              EVALUATOR'S BROWSER (CLIENT)                               |
|                                                                                         |
|  Screen 1: Upload          Screen 2: Workspace           Screen 3: Export               |
|  ┌──────────────────┐     ┌─────────────────────────┐    ┌──────────────────────┐       |
|  │ File Picker      │     │ Video Preview + Controls │    │ Render Progress      │       |
|  │ Metadata Inspect │     │ Interactive Timeline     │    │ Integrity Verify     │       |
|  │ Auto/Custom Mode │     │ Transcript Panel         │    │ Download MP4 Button  │       |
|  │ Recipe Checkboxes│     │ AI Command Input         │    │ Export Metadata      │       |
|  └──────────────────┘     │ Undo/Redo History        │    └──────────────────────┘       |
|                           └─────────────────────────┘                                   |
|                                                                                         |
|  [Web Workers — All Heavy Processing]                                                   |
|  ├── Worker A: @ffmpeg/ffmpeg 0.12 — trim, concat, filter, encode, mux to MP4          |
|  ├── Worker B: @huggingface/transformers — Whisper tiny multilingual speech-to-text     |
|  ├── Worker C: @ricky0123/vad-web — Silero VAD speech probability via ONNX Runtime     |
|  └── AudioWorklet: @sapphi-red/web-noise-suppressor — RNNoise neural denoiser          |
|                                                                                         |
|  [State & Storage]                                                                      |
|  ├── Zustand Store: EDL segments, audio settings, undo/redo stacks, UI state            |
|  └── IndexedDB (idb): Raw video File, uploaded meme Blobs, project snapshots            |
+────────────────────────────────────────┬────────────────────────────────────────────────+
                                         │ HTTPS POST (< 500 bytes JSON text only)
                                         │ { instruction: "Cut from 0:10 to 0:45",
                                         │   videoDurationMs: 180000 }
                                         ▼
+─────────────────────────────────────────────────────────────────────────────────────────+
|                    VERCEL HOBBY (STATIC HOST + SERVERLESS FUNCTION)                     |
|                                                                                         |
|  Static CDN: Serves Vite-built React SPA (HTML, CSS, JS, WASM binaries)                 |
|  Headers via vercel.json: COOP (same-origin) + COEP (require-corp)                      |
|                                                                                         |
|  Serverless Function: /api/parse-command.ts                                             |
|  ├── POST-only, validates payload (max 300 chars instruction)                           |
|  ├── Reads GEMINI_API_KEY from Vercel Environment Variables                             |
|  ├── Forwards text-only request to Gemini API                                           |
|  ├── Validates response against Zod schema                                              |
|  └── Returns structured JSON operation to browser                                       |
+────────────────────────────────────────┬────────────────────────────────────────────────+
                                         │ HTTPS POST (API key in query param, server-side)
                                         ▼
+─────────────────────────────────────────────────────────────────────────────────────────+
|                    GOOGLE AI STUDIO — GEMINI 3.5 FLASH LITE (FREE TIER)                |
|                                                                                         |
|  Model ID: gemini-3.5-flash-lite                                                        |
|  Endpoint: generativelanguage.googleapis.com/v1beta/models/                             |
|            gemini-3.5-flash-lite:generateContent                                        |
|  Free Tier Quotas (per user's dashboard):                                               |
|    RPM: 15 | RPD: 500 | TPM: 250,000                                                   |
|  Billing: NOT CONFIGURED | Credit Card: NOT REQUIRED                                   |
|  Structured Output: response_mime_type=application/json + response_schema [VERIFIED]    |
+─────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 4. DEPLOYMENT ARCHITECTURE: ANTIGRAVITY → VS CODE → GITHUB → VERCEL

### 4.1 Single shared workspace directory

Both Antigravity and VS Code operate on the same physical directory:
`d:\SHASWAT\shaswat studies\Ai editing app`

Antigravity writes and modifies code → VS Code sees changes instantly → developer commits and pushes via VS Code's integrated terminal → GitHub webhook triggers Vercel build → public URL updates.

### 4.2 Local development strategy

**Two approaches (developer chooses):**

**Option A: Pure Vite dev server (simpler, recommended for most work)**
- Run `npm.cmd run dev` in VS Code terminal (PowerShell)
- Vite serves frontend at `http://localhost:5173`
- For `/api/parse-command` calls during local dev, the Vite dev server proxies to a small local Node script or the developer temporarily tests against the deployed Vercel function URL
- `.env.local` contains `GEMINI_API_KEY=...` for local testing

**Option B: Vercel CLI (for testing serverless functions locally)**
- Install Vercel CLI globally: `npm.cmd install -g vercel`
- Run `vercel dev` (requires one-time `vercel login` and `vercel link`)
- Serves both frontend and `/api/*` functions on a single port
- Reads environment variables from Vercel dashboard

**Production builds:** Vercel's Linux build environment runs standard `npm run build` (not `npm.cmd`). The `package.json` scripts must use platform-neutral commands. The `npm.cmd` / `npx.cmd` requirement is Windows PowerShell–specific and must never appear in `package.json` scripts or `vercel.json` build commands.

### 4.3 Vercel Hobby plan compatibility

**[VERIFIED]** via official Vercel documentation:

| Aspect | Hobby Plan Status | Our Usage | Compatible? |
|---|---|---|---|
| Cost | ₹0, no credit card | ₹0 budget | ✅ Yes |
| Usage restriction | Personal / non-commercial only | Educational YIIC student project | ✅ Yes |
| Environment Variables | Fully available (64KB total) | 1 key: GEMINI_API_KEY (~40 bytes) | ✅ Yes |
| Serverless Functions | Available, 1M invocations/month | < 1,000 during demo period | ✅ Yes |
| Function timeout | 300 seconds max | Our function runs < 3 seconds | ✅ Yes |
| Request/Response payload | 4.5 MB limit | Our payload is ~500 bytes | ✅ Yes |
| Deployments per day | 100 | ~5–10 during active dev | ✅ Yes |
| Bandwidth | 100 GB/month | SPA bundle ~2MB; evaluator traffic minimal | ✅ Yes |
| Node.js runtime | 22.x, 24.x, 26.x (Node 20 EOL) | We target 22.x or newer | ✅ Yes |
| Git integration | GitHub, GitLab, Bitbucket | GitHub | ✅ Yes |
| Custom domain | Not available on Hobby | We use `*.vercel.app` subdomain | ✅ Acceptable |

> [!IMPORTANT]
> Vercel Hobby is restricted to **personal and non-commercial use**. Our YIIC educational submission qualifies. If this project were ever monetized or used commercially, it would need to migrate to Vercel Pro or another host.

---

## 5. GEMINI API — VERIFIED MODEL DECISION

### 5.1 Model selection

Based on the developer's own Google AI Studio dashboard:

| Model | RPM | TPM | RPD | Suitability |
|---|---:|---:|---:|---|
| Gemini 3.5 Flash Lite | 15 | 250K | 500 | **Best balance of quota and capability** |
| Gemini 3.1 Flash Lite | 15 | 250K | 500 | Same quotas, older model |
| Gemini 3.8 Flash | 5 | 250K | 20 | Too few RPD for shared public app |
| Gemini Decision 1 | 200 | 50K | 10K | Specialized Decisions API — not a general text model |

**Selected model: `gemini-3.5-flash-lite`** [VERIFIED — confirmed available via REST endpoint, supports `response_mime_type: "application/json"` and `response_schema` for constrained structured output]

**Rationale for choosing 3.5 over 3.1:** Same quotas, but 3.5 is the newer generation and more likely to remain supported longer. Both support structured output.

### 5.2 Quota management for a shared public application

With 500 RPD shared across all visitors:
- If 10 evaluators each send 20 AI commands = 200 requests (within budget)
- If the app goes viral or is abused, quota exhausts quickly

**Mitigations:**
1. The UI prominently encourages manual timeline editing (clicking/dragging) alongside AI commands
2. A client-side counter tracks AI requests in the current session and warns after 15 commands: *"AI commands are limited. Use the timeline controls for editing."*
3. When the server returns HTTP 429 or a quota error, the client automatically switches to the local regex parser and displays: *"AI assistant temporarily unavailable. Using local command parser."*
4. The local parser remains fully functional for standard commands (cut, trim, enhance, noise, transcript)

### 5.3 Free Tier data privacy

**[VERIFIED]** On the unbilled Free Tier, Google's terms state that inputs and outputs **may be reviewed by human annotators and used to improve Google products**.

**Our mitigation:** We send Gemini only:
- The user's short editing instruction text (e.g., "cut from 0:10 to 0:45") — max 300 characters
- The video's total duration in milliseconds
- No video bytes, no audio bytes, no transcript text, no filenames, no personal data

This is an unavoidable privacy tradeoff of the ₹0 Free Tier. The application should display a notice: *"AI commands are processed by Google Gemini. Only your instruction text is sent — never your video."*

---

## 6. API KEY SECURITY & ABUSE PROTECTION

### 6.1 Key isolation

```
┌─────────────────────────────────────────────────────────────────┐
│ WHERE THE KEY EXISTS:                                           │
│  ✅ Vercel Environment Variables (encrypted at rest)            │
│  ✅ .env.local on developer's machine (gitignored)              │
│                                                                 │
│ WHERE THE KEY MUST NEVER EXIST:                                 │
│  ❌ Any file starting with VITE_ (exposed to browser bundle)    │
│  ❌ Any .ts or .tsx file in src/                                 │
│  ❌ GitHub repository (any branch, any commit, any file)         │
│  ❌ Browser JavaScript, localStorage, sessionStorage             │
│  ❌ Network responses returned to the client                     │
│  ❌ Console.log statements or error messages                     │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Realistic protection assessment

**What the serverless proxy protects against:**
- Direct exposure of the API key in client code ✅
- Casual inspection of browser network traffic ✅
- GitHub scraping for leaked keys ✅

**What it does NOT reliably protect against:**
- Determined abuse of the public `/api/parse-command` endpoint by bots sending thousands of requests
- In-memory rate limiting in a serverless function is unreliable because each invocation may run on a different instance with no shared memory [VERIFIED — serverless functions are stateless]

**Honest limitation:** Robust global rate limiting at ₹0 is not feasible. Solutions like Upstash Redis or Vercel KV require paid tiers or billing activation for meaningful capacity. [BLOCKER for robust rate limiting, but NOT a blocker for the project — the 500 RPD cap itself acts as a natural ceiling, and the local fallback parser ensures the app remains functional]

**Practical mitigations within ₹0:**
1. POST-only endpoint (rejects GET, PUT, DELETE)
2. Payload size validation (reject > 500 bytes)
3. Instruction length validation (reject > 300 characters)
4. Origin header check (advisory, can be spoofed but deters casual abuse)
5. Validate Gemini's response structure before returning to client
6. Return generic error messages (never expose the API key in error payloads)

---

## 7. EDL AND TIMELINE ARCHITECTURE

### 7.1 Time representation

Video timing is complex. Different frame rates, variable frame rate footage, and audio sample rates all create potential drift.

**Our approach:**

| Layer | Representation | Purpose |
|---|---|---|
| EDL segments | Integer milliseconds (`number`) | Cut boundaries, meme positions, transcript alignment |
| FFmpeg trim commands | Decimal seconds (`"10.500"`) | Passed to `-ss`, `trim=start=` |
| UI display | `HH:MM:SS.mmm` or `MM:SS` | Human-readable timecodes |
| HTML5 video seek | `video.currentTime` (float seconds) | Browser playback sync |

**Why integer milliseconds (not frame indices or PTS):**
- Frame indices require knowing the exact frame rate, which varies per file and may be variable (VFR)
- PTS values are container-specific and not directly accessible from JavaScript's `HTMLVideoElement`
- Integer milliseconds provide sub-frame precision at 30fps (one frame = 33.3ms) and are consistent across all our layers
- FFmpeg's `trim` filter accepts decimal seconds and handles the frame-level alignment internally

**Acknowledged limitation:** At very high frame rates (120fps, where one frame = 8.3ms), millisecond precision can occasionally round to the wrong frame. For our MVP targeting standard phone/webcam footage (24–60fps), this is acceptable. [ASSUMPTION — acceptable for MVP]

### 7.2 Corrected EDL data model

```typescript
// All time values are in integer milliseconds

interface VideoMetadata {
  fileName: string;
  fileSizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;    // e.g., "h264", "hevc"
  audioCodec: string;    // e.g., "aac", "mp3", "" if no audio
  hasAudio: boolean;
  // Frame rate stored but not used for timing arithmetic
  frameRateDisplay: string; // e.g., "29.97", "30", "60" — for UI info only
}

interface EDLSegment {
  id: string;
  sourceStartMs: number;   // Start in original video [inclusive]
  sourceEndMs: number;     // End in original video [exclusive]
  projectStartMs: number;  // Pre-calculated start on edited timeline
  durationMs: number;      // Always === sourceEndMs - sourceStartMs
}

interface EDLMemeInsert {
  id: string;
  memeId: string;          // References MemeAsset.id or user-upload ID
  storageKey: string;      // IndexedDB key for the actual Blob
  projectInsertMs: number; // Where on the project timeline it appears
  durationMs: number;
  mode: 'INSERT';          // INSERT = splices into timeline, extending duration
}

interface AudioSettings {
  voiceEnhanceEnabled: boolean;    // Highpass + EQ + compressor
  noiseReductionEnabled: boolean;  // RNNoise neural denoiser
  loudnessNormalizeEnabled: boolean;
}

interface ProjectState {
  projectId: string;
  version: number;          // Incremented on every edit
  source: VideoMetadata;
  segments: EDLSegment[];   // Ordered, non-overlapping, half-open intervals
  memes: EDLMemeInsert[];   // Ordered by projectInsertMs
  audio: AudioSettings;
  undoStack: ProjectSnapshot[];
  redoStack: ProjectSnapshot[];
}
```

### 7.3 Corrected coordinate mapping

The mapping function uses each segment's explicit `projectStartMs` rather than accumulating durations:

```typescript
function projectToSource(
  projectMs: number, 
  segments: EDLSegment[]
): { sourceMs: number; segmentId: string } | null {
  for (const seg of segments) {
    const segProjectEnd = seg.projectStartMs + seg.durationMs;
    if (projectMs >= seg.projectStartMs && projectMs < segProjectEnd) {
      const offset = projectMs - seg.projectStartMs;
      return { sourceMs: seg.sourceStartMs + offset, segmentId: seg.id };
    }
  }
  // Past the end of all segments
  return null;
}
```

**After any edit operation** (cut, trim, meme insert, undo), `projectStartMs` values must be **recalculated** for every segment:

```typescript
function recalculateProjectPositions(segments: EDLSegment[]): void {
  let cursor = 0;
  for (const seg of segments) {
    seg.projectStartMs = cursor;
    seg.durationMs = seg.sourceEndMs - seg.sourceStartMs;
    cursor += seg.durationMs;
  }
}
```

**Boundary rules:**
- Segments use half-open intervals: `[sourceStartMs, sourceEndMs)`
- Zero-duration segments (`sourceStartMs === sourceEndMs`) are immediately removed
- Segments are always stored in ascending order of `projectStartMs`
- No two segments may overlap in source time after a cut (they can be non-contiguous in source time)

### 7.4 Undo/redo

Before each edit operation, the current `segments` array and `memes` array are deep-cloned and pushed onto the `undoStack`. Undo pops from undoStack and pushes current state to redoStack. Redo reverses.

### 7.5 Persistent storage

| Data | Storage | Recovery on page reload |
|---|---|---|
| Raw source video `File` | IndexedDB (`idb` library) | Read back, recreate Object URL |
| Uploaded meme `Blob`s | IndexedDB | Read back, recreate Object URLs |
| Project EDL state | IndexedDB (serialized JSON) | Restore Zustand state |
| Undo/redo history | Not persisted (session-only) | Lost on reload — acceptable for MVP |

---

## 8. EXPORT ARCHITECTURE

### 8.1 Why stream copy is not the default

**[VERIFIED]** H.264 video is compressed using Groups of Pictures (GOPs). A GOP starts with a keyframe (I-frame) and is followed by dependent frames (P-frames, B-frames). Keyframe intervals in typical phone/webcam footage are 1–3 seconds.

`-c copy` can only cut cleanly at keyframe boundaries. If the user cuts at 01:23.450 and the nearest keyframe is at 01:22.000, the first ~1.4 seconds of the output will show frozen/corrupted video.

**Decision:** Re-encoding via `libx264` is the default and only export path for the MVP. This guarantees frame-accurate cuts regardless of keyframe placement.

### 8.2 Export pipeline design

```
Step 1: Read EDL segments and meme inserts
Step 2: Build FFmpeg complex filtergraph
  - For each segment: trim source video + audio
  - For each meme: load meme file, scale to match output dimensions
  - Concatenate all clips in timeline order
  - Apply audio filters (highpass, EQ, loudnorm) if enabled
Step 3: Execute FFmpeg WASM in Web Worker
  - Monitor progress via FFmpeg log parsing
  - Use -preset ultrafast -crf 23 for reasonable speed/quality balance
Step 4: Verify output
  - Check output byte array length > 0
  - Load into hidden <video> element, confirm loadedmetadata fires
  - Confirm video.duration is within ±1 second of expected timeline duration
  - If verification fails: report error, do not show download button
Step 5: Present download
  - Create Blob, generate Object URL, present download link
  - Clean up WASM virtual filesystem
```

### 8.3 Output verification strategy

A non-zero file size does not prove validity. The verification gate:

1. **Byte size check:** `output.length > 1024` (an empty MP4 container is ~500 bytes; a truly encoded video will be much larger)
2. **Browser decode test:** Load the `Blob` into a temporary `<video>` element:
   - If `loadedmetadata` fires: check `video.duration`, `video.videoWidth`, `video.videoHeight`
   - If `error` fires: the file is corrupt or unplayable
3. **Duration sanity check:** The exported video's reported duration should be within ±2 seconds of the EDL's calculated total duration. Significant deviation indicates a rendering error.

### 8.4 Required export test cases

| Test Case | Input | Expected Result |
|---|---|---|
| No edits | Original 2-min video, no cuts | Output identical in duration to source |
| Single cut | Remove 00:30–01:00 | Output is ~1:30, clean audio/video at cut point |
| Multiple cuts | 3 cuts removing 15s each | Output is ~1:15, all cuts clean |
| Cut between keyframes | Cut at arbitrary timestamp | No frozen frames, no visual glitch |
| Short final clip | Cut to produce 3-second output | Valid playable MP4 |
| Meme insertion | Insert 2s meme at 00:45 | Meme appears at correct position, total duration increases by 2s |
| Meme after cut | Cut 00:10–00:20, insert meme at 00:30 (project time) | Meme at correct project position (which is 00:40 source time) |
| No audio stream | Screen recording with no audio track | Export produces video-only MP4 without crashing |
| Audio filters enabled | Voice enhance + noise reduction | Audio is processed, video unaffected |
| Empty EDL | All segments removed | Export refuses with error message, not a 0-byte file |
| Large file at limit | 150MB, 3-min, 1080p | Completes without WASM memory crash |
| Export cancellation | User cancels mid-export | WASM cleanup occurs, no corrupted partial download |

---

## 9. TRANSCRIPTION ARCHITECTURE

### 9.1 Package and model

**Package:** `@huggingface/transformers` **v4.3.x** [VERIFIED — current latest on npm, Apache-2.0 license]

> [!WARNING]
> The older `@xenova/transformers` package is deprecated. Revision 3 incorrectly mixed references to both packages. This revision uses exclusively `@huggingface/transformers`.

**Model:** `onnx-community/whisper-tiny` (multilingual) [VERIFIED — available on Hugging Face, Apache-2.0 license]

**Why multilingual `whisper-tiny` instead of `whisper-tiny.en`:**
- Supports English, Hindi, Gujarati, and 96 other languages
- Only slightly larger download (~75–80 MB quantized vs ~40 MB for English-only)
- Same architecture, same inference speed

### 9.2 Capabilities and limitations

| Capability | Status |
|---|---|
| English transcription | Moderate–good accuracy on clear speech [VERIFIED by published benchmarks] |
| Hindi transcription | Moderate accuracy, degrades with noise/accents [VERIFIED — known Whisper-tiny limitation] |
| Gujarati transcription | Lower accuracy due to smaller training corpus [VERIFIED] |
| Word-level timestamps | Supported via `return_timestamps: 'word'` [VERIFIED] |
| Segment-level timestamps | Supported via `return_timestamps: true` [VERIFIED] |
| Browser caching | Model cached in browser CacheStorage after first download [VERIFIED] |
| WebGPU acceleration | Supported where browser offers WebGPU [VERIFIED] |
| WASM fallback | Automatic fallback if WebGPU unavailable [VERIFIED] |
| Offline operation | Yes, after first model download [VERIFIED] |

**Timestamp accuracy warning:** Whisper's word timestamps are **acoustic estimates**, not frame-precise alignment. They can drift by ±100–200ms. This is acceptable for transcript display but should not be used as the sole basis for automated cuts without safety margins.

### 9.3 Integration

Transcription runs inside a dedicated Web Worker to prevent UI freezing. The worker:
1. Receives the raw audio as a Float32Array at 16kHz mono
2. Runs the Whisper pipeline with `return_timestamps: 'word'`
3. Returns the transcript as an array of `{ word, startMs, endMs, confidence }` objects
4. These timestamps are in **source time** — the coordinate mapper translates them to project time for display

After edits change the timeline, transcript words whose source timestamps fall within a cut region are visually dimmed or hidden in the transcript panel.

---

## 10. SILENCE DETECTION ARCHITECTURE

### 10.1 Multi-pass pipeline

```
Pass 1: Silero VAD via @ricky0123/vad-web
  - Process extracted 16kHz mono audio through ONNX model
  - Output: array of speech segments { start, end } in source time ms
  
Pass 2: Whisper word timestamps
  - Map word boundaries onto the VAD-detected segments
  - Identify gaps between consecutive words: Δt = word[i+1].start - word[i].end
  
Pass 3: Silence classification heuristic
  For each inter-word gap Δt:
    If Δt < 750ms → RETAIN (natural speech cadence)
    If 750ms ≤ Δt ≤ 1500ms → CHECK:
      - If VAD shows speech probability > 0.3 during the gap: RETAIN (breathing/soft sound)
      - If word[i] ends with punctuation (period, comma, question): RETAIN (rhetorical pause)
      - Otherwise: FLAG as candidate for review
    If Δt > 1500ms AND VAD speech probability < 0.10 throughout:
      FLAG as strong candidate for removal

Pass 4: Safety margins
  For each flagged candidate:
    Proposed cut start = word[i].endMs + 200ms  (preserves word decay)
    Proposed cut end   = word[i+1].startMs - 150ms  (preserves onset)
    If proposed cut duration < 200ms: DISCARD (too short to matter)
```

### 10.2 User control

- Candidates appear as amber markers on the timeline
- Each marker has: Accept, Reject, Adjust (drag handles)
- "Accept All" and "Reject All" buttons available
- Accepted cuts become regular EDL segment removals (undoable)
- **No automatic deletion without user confirmation**

### 10.3 What this system does NOT claim

- It does not detect "boring" content (only audio silence/dead air)
- It does not understand semantic meaning of pauses
- It will occasionally flag valid dramatic pauses as candidates — the user must review
- Accuracy degrades with heavy background noise, overlapping speakers, or non-speech audio

---

## 11. VOICE ENHANCEMENT ARCHITECTURE

### 11.1 Voice clarity enhancement

This is an audio processing chain using standard DSP filters, **not** AI-based source separation.

Applied via FFmpeg WASM filter string during export:
```
highpass=f=80, equalizer=f=3000:t=q:w=1.5:g=3, acompressor=threshold=-20dB:ratio=3:attack=5:release=50, loudnorm=I=-16:TP=-1.5:LRA=11
```

| Filter | Purpose | Honest Description |
|---|---|---|
| `highpass=f=80` | Remove sub-bass rumble | Eliminates table thumps, wind, room resonance below 80Hz |
| `equalizer=f=3000:t=q:w=1.5:g=3` | Boost speech presence | Adds 3dB at 3kHz — makes voice sound "closer" and more articulate |
| `acompressor` | Even out volume | Reduces difference between quiet and loud speech |
| `loudnorm=I=-16:TP=-1.5:LRA=11` | Normalize loudness | Brings overall volume to web/mobile standard (-16 LUFS) |

**Honest limitation:** This filter chain improves voice clarity for typical talking-head footage but does NOT:
- Remove echo/reverb
- Separate overlapping speakers
- Fix extremely clipped or distorted audio
- Work equally well on every microphone or room acoustics

### 11.2 Real-time preview

During editing, the Web Audio API applies equivalent filters in real-time:
- `BiquadFilterNode` (type: highpass, frequency: 80)
- `BiquadFilterNode` (type: peaking, frequency: 3000, gain: 3)
- `DynamicsCompressorNode`

The user can toggle "Voice Enhance" on/off to hear the difference instantly.

**Important:** The preview uses Web Audio API nodes; the export uses FFmpeg filter strings. These are independent implementations of similar DSP operations. Minor audible differences between preview and export are possible. [ASSUMPTION — needs testing in Phase 5]

---

## 12. BACKGROUND NOISE REDUCTION

### 12.1 Technology: RNNoise via WebAssembly AudioWorklet

**Package:** `@sapphi-red/web-noise-suppressor` [VERIFIED — MIT license, actively maintained, wraps `shiguredo/rnnoise-wasm`]

**What RNNoise is:** A recurrent neural network trained specifically to suppress steady-state background noise (fan hum, air conditioner, road noise) from human speech. Developed by Mozilla/Xiph.Org.

**What RNNoise is NOT:** A general-purpose noise remover. It will not cleanly remove:
- A second person speaking
- Music playing in the background
- Sudden transient sounds (door slam, cough)

### 12.2 Integration challenge: Preview vs. Export

**For real-time preview:** RNNoise runs as an `AudioWorkletNode` in the Web Audio API graph, processing the `<video>` element's audio output in real-time at 48kHz. The user hears denoised audio during playback.

**For final export:** The processed audio must be baked into the exported MP4. Two approaches:

**Approach A (simpler, recommended for MVP):** During export, extract audio from the source video via FFmpeg WASM, process it through RNNoise in an AudioWorklet, capture the output as a WAV buffer, then feed it back to FFmpeg as the audio input for the final mux.

**Approach B (complex):** Apply FFmpeg's built-in `afftdn` or `arnndn` filter during the WASM export. However, `afftdn` may not be included in the standard `@ffmpeg/core` build [ASSUMPTION — requires Phase 3 testing], and `arnndn` requires a separate model file.

**[RECOMMENDATION]:** Start with Approach A. If it proves too slow or complex, fall back to applying only FFmpeg's `highpass` and `equalizer` filters during export (which are verified available) and document noise reduction as a "preview-only" feature for the MVP.

This is an honest acknowledgment that fully integrating neural noise reduction into the export pipeline is technically challenging in a browser environment and may need to be scoped as a preview feature if integration proves unreliable. [ASSUMPTION — requires Phase 5 testing]

---

## 13. MEME LIBRARY AND LICENSING

### 13.1 Curated stock library approach

For the MVP, we will create **3–5 short original reaction clips** ourselves (screen-recorded text animations, simple royalty-free sound effects) rather than bundling clips of uncertain copyright origin.

**Why:** True CC0 video *meme* clips (as opposed to generic stock footage) are difficult to verify as genuinely public domain. A "facepalm" clip from a movie is copyrighted regardless of what a random download site claims. Creating our own simple clips eliminates all legal ambiguity.

**Alternative free sources for evaluation:**
- **Pexels Videos** (Pexels License — free commercial use, no attribution required) [VERIFIED]
- **Pixabay Videos** (Pixabay License — similar to CC0) [VERIFIED]
- These offer stock footage (nature, abstract, people) that can serve as transition/reaction clips

### 13.2 Meme asset schema

```typescript
interface MemeAsset {
  id: string;
  title: string;
  tags: string[];
  durationMs: number;
  source: 'bundled' | 'user-uploaded';
  license: string;       // "Original" | "Pexels License" | "User Uploaded"
  storageKey: string;    // IndexedDB key for the Blob
  thumbnailDataUrl?: string;
}
```

### 13.3 Contextual matching

The meme suggestion engine scans the transcript for keywords matching meme tags:
- Transcript contains "failed" → suggest meme tagged ["fail", "mistake"]
- Transcript contains "unbelievable" → suggest meme tagged ["surprise", "shock"]

This is simple keyword matching, not semantic AI analysis. It will miss subtle humor but is reliable, fast, and free.

---

## 14. EXACT RECOMMENDED DEPENDENCIES

```
┌──────────────────────────────┬──────────┬───────────┬──────────────────────────────────┐
│ Package                      │ Version  │ License   │ Purpose & Verification           │
├──────────────────────────────┼──────────┼───────────┼──────────────────────────────────┤
│ react                        │ ^18.3.1  │ MIT       │ UI framework [VERIFIED]          │
│ react-dom                    │ ^18.3.1  │ MIT       │ DOM rendering [VERIFIED]         │
│ typescript                   │ ^5.6.0   │ Apache-2  │ Static typing [VERIFIED]         │
│ vite                         │ ^6.0.0   │ MIT       │ Build tool & HMR [VERIFIED]      │
│ @vitejs/plugin-react         │ ^4.3.0   │ MIT       │ Vite React integration [VERIFIED]│
│ tailwindcss                  │ ^3.4.0   │ MIT       │ Utility-first CSS [VERIFIED]     │
│ postcss                      │ ^8.4.0   │ MIT       │ Tailwind dependency [VERIFIED]   │
│ autoprefixer                 │ ^10.4.0  │ MIT       │ Tailwind dependency [VERIFIED]   │
│ lucide-react                 │ ^0.460.0 │ ISC       │ Icon library [VERIFIED]          │
│ zustand                      │ ^5.0.0   │ MIT       │ State management [VERIFIED]      │
│ zod                          │ ^3.23.0  │ MIT       │ Runtime schema validation [VER.] │
│ idb                          │ ^8.0.0   │ ISC       │ IndexedDB promise wrapper [VER.] │
│ @ffmpeg/ffmpeg               │ ^0.12.10 │ MIT       │ FFmpeg WASM orchestrator [VER.]  │
│ @ffmpeg/core                 │ ^0.12.10 │ GPL-2.0+  │ FFmpeg WASM binary (w/ x264)     │
│ @ffmpeg/util                 │ ^0.12.1  │ MIT       │ File conversion utilities [VER.] │
│ @huggingface/transformers    │ ^4.3.2   │ Apache-2  │ Whisper speech-to-text [VERIFIED]│
│ @ricky0123/vad-web           │ ^0.0.31  │ MIT       │ Silero VAD browser wrapper [VER.]│
│ onnxruntime-web              │ ^1.20.0  │ MIT       │ ONNX model runtime [VERIFIED]    │
│ @sapphi-red/web-noise-suppr. │ latest   │ MIT       │ RNNoise AudioWorklet [VERIFIED]  │
│ uuid                         │ ^11.0.0  │ MIT       │ Unique ID generation [VERIFIED]  │
└──────────────────────────────┴──────────┴───────────┴──────────────────────────────────┘
```

> [!WARNING]
> **FFmpeg licensing:** `@ffmpeg/core` includes `libx264`, which makes the compiled WASM binary **GPL-2.0-or-later** — not LGPL. This means the WASM binary carries copyleft obligations. Since our project source code will be on a public GitHub repository anyway, this is acceptable. However, if the project were ever closed-source, this would require legal review. [VERIFIED via FFmpeg licensing docs and npm package metadata]

---

## 15. PROJECT STRUCTURE

```
ai-video-editor/
├── .env.example                # GEMINI_API_KEY=your_key_here
├── .env.local                  # Actual key (gitignored)
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vercel.json                 # COOP/COEP headers + SPA rewrites
├── README.md
│
├── api/                        # Vercel Serverless Functions
│   ├── parse-command.ts        # Gemini proxy endpoint
│   └── _lib/                   # Shared server utilities (underscore = not deployed as endpoint)
│       └── schemas.ts          # Zod schemas for command validation
│
├── public/                     # Static assets (not bundled by Vite)
│   ├── favicon.ico
│   └── memes/                  # Bundled stock meme clips (small MP4s)
│       ├── clip_001.mp4
│       └── manifest.json       # { id, title, tags, durationMs, license }
│
└── src/
    ├── main.tsx
    ├── App.tsx                 # React Router: Screen1 | Screen2 | Screen3
    │
    ├── screens/
    │   ├── UploadScreen.tsx
    │   ├── WorkspaceScreen.tsx
    │   └── ExportScreen.tsx
    │
    ├── components/
    │   ├── player/             # VideoPreview.tsx, PlayerControls.tsx
    │   ├── timeline/           # TimelineContainer.tsx, Segment.tsx, Playhead.tsx
    │   ├── transcript/         # TranscriptPanel.tsx, WordHighlight.tsx
    │   ├── ai-panel/           # CommandInput.tsx, CommandHistory.tsx
    │   └── ui/                 # Button.tsx, Modal.tsx, ProgressBar.tsx, Toggle.tsx
    │
    ├── engine/                 # Core editing logic (no UI)
    │   ├── edl.ts              # Segment CRUD, recalculate positions
    │   ├── coordinateMap.ts    # projectToSource, sourceToProject
    │   ├── commandParser.ts    # Local regex fallback parser
    │   ├── commandValidator.ts # Zod validation of parsed operations
    │   └── memeIndex.ts        # Load manifest, keyword matching
    │
    ├── workers/                # Web Worker entry points
    │   ├── ffmpegWorker.ts     # FFmpeg WASM load, trim, concat, export
    │   ├── whisperWorker.ts    # @huggingface/transformers ASR pipeline
    │   └── vadWorker.ts        # Silero VAD analysis
    │
    ├── audio/                  # Audio processing
    │   ├── realtimeFilters.ts  # Web Audio API preview chain
    │   └── rnnoiseSetup.ts     # AudioWorklet noise suppressor
    │
    ├── storage/
    │   ├── db.ts               # IndexedDB schema (idb)
    │   └── projectStore.ts     # Zustand store with persistence
    │
    ├── api/
    │   └── geminiClient.ts     # Fetch wrapper for /api/parse-command
    │
    ├── types/
    │   ├── edl.ts              # EDLSegment, MemeInsert, AudioSettings, etc.
    │   └── commands.ts         # ParsedCommand, CommandResponse
    │
    └── utils/
        ├── timecode.ts         # msToTimecode, timecodeToMs formatters
        └── fileValidation.ts   # Size, duration, format checks
```

---

## 16. BROWSER & HARDWARE COMPATIBILITY

### 16.1 Cross-origin isolation

**Required for:** Multi-threaded FFmpeg WASM (`@ffmpeg/core-mt`) which uses `SharedArrayBuffer`

**Headers set in `vercel.json`:**
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

**Impact of COEP `require-corp`:** All sub-resources (scripts, images, WASM files) must either be same-origin OR have `Cross-Origin-Resource-Policy: cross-origin` headers. Since all our assets (WASM binaries, ONNX models, meme clips) are served from the same Vercel origin, this is not a problem.

**However:** If any CDN-hosted assets are loaded (e.g., fonts from Google Fonts, analytics scripts), they will be blocked unless they support CORP headers. [RECOMMENDATION: Host all assets from the same origin to avoid this]

**Fallback strategy:** If `crossOriginIsolated` is `false` in the browser (checked at runtime via `self.crossOriginIsolated`), fall back to single-threaded `@ffmpeg/core` which does not require `SharedArrayBuffer`. Single-threaded mode is slower but universally compatible.

### 16.2 WebGPU detection

```typescript
async function detectBestDevice(): Promise<'webgpu' | 'wasm'> {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch { /* fall through */ }
  }
  return 'wasm';
}
```

WebGPU accelerates Whisper inference. If unavailable, the WASM backend handles it (slower but functional).

**Intel Iris Xe + Chrome/Edge on Windows:** WebGPU is generally available but **not guaranteed on all driver versions**. [ASSUMPTION — runtime detection handles this gracefully]

### 16.3 Evaluator browser requirements

| Browser | Minimum Version | Support Level |
|---|---|---|
| Chrome (Desktop) | 113+ | Full (WebGPU + WASM + AudioWorklet) |
| Edge (Desktop) | 113+ | Full (same Chromium engine) |
| Firefox (Desktop) | 114+ | Partial (no WebGPU; WASM + AudioWorklet OK) |
| Safari (Desktop) | 17+ | Partial (WebGPU limited; WASM OK) |
| Mobile browsers | — | Not targeted for MVP |

### 16.4 Performance estimates (all [ESTIMATED], not tested)

For a 2-minute 1080p H.264 video on Intel Core i5-1335U:

| Operation | Estimated Time | Confidence |
|---|---|---|
| File ingestion + metadata | < 1 second | High |
| Whisper transcription (WebGPU) | 15–25 seconds | Medium |
| Whisper transcription (WASM only) | 30–60 seconds | Low |
| Silero VAD analysis | 2–4 seconds | Medium |
| FFmpeg re-encode export (single-threaded) | 60–120 seconds | Low |
| FFmpeg re-encode export (multi-threaded) | 30–60 seconds | Low |
| Gemini API round-trip | 0.5–2 seconds | Medium |

**These are engineering estimates, not measured benchmarks. Phase 3 will produce actual measurements.**

---

## 17. TESTING & ACCEPTANCE CRITERIA

### A. Functional Tests

| Test | Expected Result | Verification Method |
|---|---|---|
| Upload valid MP4 | Metadata displayed, player loads | Visual + console check |
| Upload invalid file (.txt) | Error message, no crash | Attempt upload |
| Auto Edit with transcript | Transcript panel populated with words | Visual inspection |
| Auto Edit with silence detect | Amber markers on timeline | Visual inspection |
| Custom Edit — no auto changes | Clean timeline, no markers | Visual inspection |
| AI command: "cut from 0:10 to 0:30" | EDL modified, timeline updated | Check segment array |
| AI command: "add sparkle effects" | Polite rejection message | Visual check |
| AI command: "remove the boring part" | Clarification request | Visual check |
| Manual trim via timeline drag | Segment boundary moves | Visual + EDL check |
| Undo after cut | Previous state restored | Visual + EDL check |
| Redo after undo | Cut re-applied | Visual + EDL check |
| Export with cuts | Valid MP4 downloaded | Play in media player |

### B. Timeline Correctness Tests

| Test | Expected Result | Verification |
|---|---|---|
| 3 cuts, check total duration | Sum of remaining segment durations | Calculate |
| Playhead at project time 0:30 after cut 0:00–0:15 | Shows source frame at 0:45 | Visual |
| Transcript word at source 0:50, after cut 0:10–0:20 | Displays at project time 0:40 | Check mapping |
| Meme inserted at project 0:30 | Total duration increases by meme length | Calculate |
| Export after meme insert | Meme visible at correct position | Play export |

### C. Browser Compatibility Tests

| Test | Chrome 120+ | Edge 120+ | Firefox 120+ |
|---|---|---|---|
| App loads | Must pass | Must pass | Must pass |
| Video plays | Must pass | Must pass | Must pass |
| FFmpeg WASM loads | Must pass | Must pass | Must pass |
| Whisper runs | Must pass | Must pass | Must pass (WASM) |
| Export produces valid MP4 | Must pass | Must pass | Must pass |
| AudioWorklet (RNNoise) | Must pass | Must pass | Must pass |

### D. Security Tests

| Test | Expected Result |
|---|---|
| Inspect browser network tab for API key | Key must NOT appear in any request or response |
| Send GET to /api/parse-command | 405 Method Not Allowed |
| Send POST with 10KB body | 400 Payload Too Large |
| Send POST with SQL injection in instruction | Gemini parses it as UNSUPPORTED_OPERATION |
| View page source / JS bundle | No API key present |
| Check `.env.example` in GitHub | Contains placeholder only |

### E. Deployment Tests

| Test | Expected Result |
|---|---|
| `git push origin main` | Vercel build triggers automatically |
| Vercel build completes | No errors, production URL updates |
| Open production URL in incognito | App loads, COOP/COEP headers present |
| Upload video on another device | Video processes in that device's browser |
| AI command on production | Gemini response returned via /api/parse-command |
| Download exported MP4 | File plays correctly in VLC/Windows Media Player |

---

## 18. PHASED IMPLEMENTATION ROADMAP

### Phase 1: Architecture Approval ← CURRENT STEP
- **Goal:** Finalize this Revision 3.1 document
- **Output:** Approved architecture blueprint
- **Completion criteria:** Developer confirms all decisions

### Phase 2: Deployment Foundation
- **Goal:** Prove the Antigravity → VS Code → GitHub → Vercel pipeline works
- **Features:** Minimal Vite + React "Hello World" with a `/api/parse-command` stub
- **Files:** `package.json`, `vite.config.ts`, `vercel.json`, `api/parse-command.ts`, `src/App.tsx`
- **Verification:** Public Vercel URL loads; `crossOriginIsolated === true` in browser console; `/api/parse-command` returns a test JSON response
- **Risk:** Vercel CLI login/linking may confuse a beginner — provide exact commands
- **Dependencies:** GitHub account, Vercel account (both free, both already have)

### Phase 3: Media Engine Feasibility Spike
- **Goal:** Prove FFmpeg WASM can trim and re-encode video in the browser
- **Features:** Upload a video → trim 10s → export → download → play
- **Key tests:** Memory usage, encoding time, output validity, single-threaded vs multi-threaded
- **Produces:** Actual measured performance data to replace estimates
- **Risk:** WASM memory limits may require reducing max file size further
- **Dependencies:** Phase 2 complete

### Phase 4: Core Three-Screen UI
- **Goal:** Build the complete editing interface
- **Features:** All three screens, timeline, player sync, EDL operations, undo/redo, manual trim
- **Key milestone:** A user can upload → manually cut sections → export an edited MP4
- **No AI features yet — this phase proves the editor works without Gemini**
- **Dependencies:** Phase 3 complete (confirms FFmpeg WASM works)

### Phase 5: AI, Audio, and Speech Integration
- **Goal:** Add AI command parsing, transcription, silence detection, audio enhancement
- **Features:** Gemini proxy, local fallback, Whisper transcription, VAD silence detection, voice enhancement preview, noise reduction preview
- **Key tests:** Gemini structured output parsing, transcript display, silence candidate UI
- **Risk:** RNNoise export integration may need to be scoped to preview-only
- **Dependencies:** Phase 4 complete

### Phase 6: Meme System
- **Goal:** Curated meme library, contextual suggestions, meme insertion in timeline and export
- **Features:** Meme picker, keyword suggestion engine, timeline markers, export with memes
- **Dependencies:** Phase 5 complete (needs transcript for keyword matching)

### Phase 7: Final Testing and YIIC Submission
- **Goal:** End-to-end verification on deployed Vercel app
- **Features:** Full test matrix execution, documentation, submission link
- **Key tests:** Another device/browser, evaluator-style usage flow
- **Dependencies:** All prior phases complete

---

## 19. COMPLETE ₹0 COST AUDIT

| Item | Provider | Cost | Payment Required? |
|---|---|---|---|
| Frontend & API hosting | Vercel Hobby | ₹0 | No credit card |
| AI command parsing | Gemini 3.5 Flash Lite Free Tier | ₹0 | No billing activation |
| Video processing | @ffmpeg/ffmpeg (browser WASM) | ₹0 | Open source |
| Speech recognition | @huggingface/transformers (browser) | ₹0 | Open source |
| Voice activity detection | @ricky0123/vad-web (browser) | ₹0 | Open source |
| Noise suppression | @sapphi-red/web-noise-suppressor | ₹0 | Open source |
| Data storage | Browser IndexedDB | ₹0 | User's own device |
| Source control | GitHub (free plan) | ₹0 | No card required |
| Development tools | VS Code, Antigravity, Git, Node.js | ₹0 | All free |

**Total: ₹0.00 — No credit card, no billing, no paid services at any stage.**

---

## 20. REMAINING RISKS AND BLOCKERS

| Risk | Severity | Status | Mitigation |
|---|---|---|---|
| FFmpeg WASM memory crash on large files | High | **Requires Phase 3 testing** | Enforce file size/duration limits; test actual limits |
| RNNoise export integration complexity | Medium | **Requires Phase 5 testing** | May scope to preview-only for MVP |
| Gemini 500 RPD shared across all visitors | Medium | **Known limitation** | Local fallback parser; session-level usage warnings |
| In-memory serverless rate limiting unreliable | Low | **Known limitation** | 500 RPD natural cap; origin check as advisory layer |
| Whisper Hindi/Gujarati accuracy | Medium | **Known limitation** | Document as experimental; English primary |
| Multi-threaded WASM requires COOP/COEP | Low | **Mitigated** | Single-threaded fallback if headers don't apply |
| Voice enhance preview vs export inconsistency | Low | **Requires Phase 5 testing** | Document difference; tune filter parameters |
| `@ffmpeg/core` GPL license implications | Low | **Accepted** | Project is open-source on public GitHub |

---

## 21. ASSUMPTIONS REQUIRING CONFIRMATION

| Assumption | How to Confirm | Phase |
|---|---|---|
| FFmpeg WASM can re-encode 3-min 1080p without WASM OOM | Test with real video file | Phase 3 |
| `loudnorm` filter is available in `@ffmpeg/core` 0.12.10 | Run test filtergraph in browser | Phase 3 |
| Multi-threaded WASM provides meaningful speedup | Benchmark ST vs MT export | Phase 3 |
| Whisper-tiny word timestamps are usable for silence detection | Run on test footage with known pauses | Phase 5 |
| RNNoise processed audio can be captured and fed to FFmpeg export | Implement and test Approach A | Phase 5 |
| Gemini 3.5 Flash Lite reliably produces valid structured JSON | Send 20 test prompts, check all parse correctly | Phase 5 |
| Vercel Hobby COEP headers work correctly with all our assets | Check `crossOriginIsolated` on deployed site | Phase 2 |
| `@sapphi-red/web-noise-suppressor` works in current Chrome with Vite | Install and test AudioWorklet initialization | Phase 5 |

---

## 22. FORMAL APPROVAL CHECKLIST

| Area | Status | Action Required |
|---|---|---|
| Deployment: Vercel Hobby | ✅ Verified compatible | None — proceed |
| Deployment: GitHub integration | ✅ Verified | None — proceed |
| Gemini model: `gemini-3.5-flash-lite` | ✅ Verified available, supports structured output | None — proceed |
| Gemini quota: 15 RPM / 500 RPD | ✅ Per dashboard (project-specific) | None |
| API key security | ✅ Design verified | Implement in Phase 2 |
| Budget: ₹0 total | ✅ All components verified free | None |
| FFmpeg WASM video processing | ⚠️ Requires Phase 3 feasibility test | Test before building full UI |
| Export accuracy (re-encoding) | ⚠️ Requires Phase 3 test | Test cut accuracy and A/V sync |
| Whisper browser transcription | ⚠️ Requires Phase 5 test | Test model load time and accuracy |
| RNNoise export integration | ⚠️ Requires Phase 5 test | May scope to preview-only |
| Silence detection accuracy | ⚠️ Requires Phase 5 test | User review mitigates false positives |
| Meme library licensing | ⚠️ Requires creating original clips | Create during Phase 6 |
| Cross-browser compatibility | ⚠️ Requires Phase 7 test | Test Chrome, Edge, Firefox |
| Performance on evaluator hardware | ⚠️ Unknown until Phase 7 | Enforce conservative input limits |

**Overall assessment: The architecture is ready for implementation with Phase 3 serving as the critical go/no-go gate for browser-based video processing feasibility.**

---

*Document prepared: 2026-11-16. All [VERIFIED] claims based on official documentation accessed on this date. Technology versions and free-tier quotas may change — re-verify before production deployment.*
