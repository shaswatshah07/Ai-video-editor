import { AICommand, AICommandSchema } from '../types/commands';
import { MEME_LIBRARY } from './memeLibrary';
import { mapSourceToProjectMs } from './timelineMath';
import { ProjectEDL } from '../types/edl';

/**
 * Parses time strings like "0:15", "1:20", "15s", "2.5s", "3 s", "10" into integer milliseconds.
 */
function parseTimeStringToMs(raw: string): number | null {
  const clean = raw.trim().toLowerCase().replace(/\s+/g, '');

  // Format MM:SS or M:SS or HH:MM:SS
  if (clean.includes(':')) {
    const parts = clean.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) {
      return Math.round((parts[0] * 60 + parts[1]) * 1000);
    }
    if (parts.length === 3) {
      return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
    }
  }

  // Format with "s" suffix like "15s", "2.5s", "3s"
  if (clean.endsWith('s')) {
    const val = parseFloat(clean.slice(0, -1));
    return isNaN(val) ? null : Math.round(val * 1000);
  }

  // Pure number as seconds
  const val = parseFloat(clean);
  return isNaN(val) ? null : Math.round(val * 1000);
}

/**
 * Extracts target timestamp from either an explicit time ("at 0:15", "at 10s", "at 3 s")
 * or a spoken transcript phrase ("when I say hello", "after I say congratulations").
 */
function extractTargetTimestamp(lower: string, currentProjectMs: number, project?: ProjectEDL | null): number {
  // 1. Spoken transcript phrase matching ("when I say [phrase]", "after I say [phrase]")
  const phraseMatch = lower.match(/(?:when\s+(?:i\s+)?say(?:ing)?|after\s+(?:i\s+)?say(?:ing)?|on\s+saying)\s+["']?([^"']+)["']?/i);
  if (phraseMatch && project?.transcript && project.transcript.length > 0) {
    const rawPhrase = phraseMatch[1].trim().toLowerCase();
    const cleanTokens = rawPhrase.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (cleanTokens.length > 0) {
      for (let i = 0; i <= project.transcript.length - cleanTokens.length; i++) {
        const slice = project.transcript.slice(i, i + cleanTokens.length);
        const match = slice.every((w, idx) => {
          const wText = (w.word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return wText === cleanTokens[idx] || wText.includes(cleanTokens[idx]);
        });
        if (match) {
          const matchEndSrcMs = slice[slice.length - 1].sourceEndMs;
          const mappedProj = mapSourceToProjectMs(matchEndSrcMs, project.items);
          if (mappedProj !== null) {
            return mappedProj;
          }
        }
      }
    }
  }

  // 2. Explicit timestamp ("at 0:15", "at 15s", "at 3 s", "around 10s")
  const atMatch = lower.match(/(?:at|around)\s+([0-9:.]+\s*s?)/i);
  if (atMatch) {
    const parsed = parseTimeStringToMs(atMatch[1]);
    if (parsed !== null) return parsed;
  }

  return currentProjectMs;
}

/**
 * Explicit regex matchers for each built-in meme in MEME_LIBRARY.
 * Disambiguates specific memes while preventing generic keywords (e.g. 'good', 'boom', 'what')
 * from triggering accidental meme insertions on unrelated queries.
 */
interface MemeMatcher {
  id: string;
  title: string;
  regex: RegExp;
}

const MEME_SPECIFIC_MATCHERS: MemeMatcher[] = [
  { id: 'damnnnnnnnnnnn', title: 'Damn!', regex: /\b(damn+|friday\s+damn)\b/i },
  { id: 'mission_passed', title: 'Mission Passed (GTA)', regex: /\b(mission\s*pass(ed)?|gta\s*passed|gta)\b/i },
  { id: 'ohhhhhhhhhhhhh_penguinz0', title: 'Penguinz0 (Yeah Baby!)', regex: /\b(penguinz0|moistcr1tikal|yeah\s+baby|oh\s+baby|charlie)\b/i },
  { id: 'pointing_finger', title: 'Pointing Finger (DiCaprio)', regex: /\b(pointing\s+finger|dicaprio|leonardo(\s+dicaprio)?|rick\s+dalton)\b/i },
  { id: 'pow_ohhhhhhhhhhhhhhhhh', title: 'Supa Hot Fire (Pow!)', regex: /\b(supa\s*hot\s*fire|rap\s*battle|pow\s*oh|pow!)\b/i },
  { id: 'ten_hours_later', title: '10 Hours Later (SpongeBob)', regex: /\b(10\s*hours\s*later|ten\s*hours\s*later|hours\s*later|spongebob)\b/i },
  { id: 'the_rock_eyebrow_raise', title: 'The Rock Eyebrow Raise', regex: /\b(the\s*rock(\s*eyebrow)?|eyebrow\s*raise|dwayne\s*johnson)\b/i },
  { id: 'wait_who_are_you', title: 'Wait, Who Are You?', regex: /\b(wait,?\s*who\s*are\s*you|kazoo\s*kid)\b/i },
  { id: 'yeah_boy', title: 'Yeah Boy (Ainsley Harriott)', regex: /\b(yeah\s*bo[yi]|ainsley(\s*harriott)?)\b/i },
  { id: 'you_serious_spiderman', title: 'Are You Serious? (J. Jonah)', regex: /\b(you\s*serious(\s*spider-?man)?|are\s*you\s*serious|j\s*jonah\s*jameson|spider-?man\s*laugh|jk\s*simmons)\b/i }
];

/**
 * Deterministic local regex parser matching approved operations and strictly rejecting unsupported ones.
 * Evaluates unsupported editing requests FIRST so they can never be hijacked by loose regexes.
 */
export function parseLocalCommand(
  rawInput: string,
  currentProjectMs = 0,
  _totalDurationMs = 30000,
  project?: ProjectEDL | null
): AICommand {
  const text = rawInput.trim();
  const lower = text.toLowerCase();

  // ====================================================================
  // STEP 1: STRICT UNSUPPORTED-FEATURE GUARDS (Evaluated FIRST)
  // ====================================================================

  // 1. Sound Effects / SFX
  if (
    /\b(sound\s*effect|sfx|whoosh|vine\s*boom|boom\s*sound|ding|audio\s*effect|sound\s*clip)s?\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Sound Effects (SFX)',
        message: 'Sound effects (SFX) are currently not available in Fastcutz.ai. You can add background music using \'+ Add Music\' or insert a meme reaction clip instead.'
      },
      explanation: 'Sound effects (SFX) are currently not available in Fastcutz.ai.'
    };
  }

  // 2. Overlap / Overlay / Layering / PiP
  if (
    /\b(overlap|overlapping|overlay|picture\s*in\s*picture|pip|split\s*screen|blend|layer|layering|double\s*exposure|superimpose)\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Overlap / Overlay Effects',
        message: 'Overlap / overlay effects are currently not available in Fastcutz.ai. Right now you can splice clips sequentially, drag to reorder them, or add Fade/Wipe transitions between clips.'
      },
      explanation: 'Overlap / overlay effects are currently not available in Fastcutz.ai.'
    };
  }

  // 3. Visual Effects & Filters
  // Guard: if user specifies audio noise/sound removal, don't trigger visual background filter
  const isAudioCleaning = /\b(noise|audio|sound|hiss|hum)\b/i.test(lower);
  if (
    /\b(blur|glitch|shake|vignette|black\s*and\s*white|grayscale|vintage|filter|filters|color\s*grade|color\s*grading|lut|brightness|contrast|saturation|green\s*screen|chroma\s*key|3d|glow)\b/i.test(lower) ||
    (!isAudioCleaning && /\bremove\s+background\b/i.test(lower))
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Visual Filters & Color Effects',
        message: 'Visual filters and color/keying effects are currently not available in Fastcutz.ai.'
      },
      explanation: 'Visual filters and color/keying effects are currently not available in Fastcutz.ai.'
    };
  }

  // 4. Text / Titles / Burned-in Captions / Stickers
  // Guard: if user explicitly asks to generate transcript or speech-to-text, allow it
  const isTranscriptRequest = /\b(transcript|speech\s*to\s*text)\b/i.test(lower);
  if (
    !isTranscriptRequest &&
    /\b(add\s*text|text|title|heading|caption|captions|subtitle|subtitles|sticker|stickers|emoji|emojis|watermark|logo)\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Text, Titles & Captions',
        message: 'Adding text, stickers, or burned-in captions is currently not available in Fastcutz.ai.'
      },
      explanation: 'Adding text, stickers, or burned-in captions is currently not available in Fastcutz.ai.'
    };
  }

  // 5. Transform / Framing
  if (
    /\b(zoom|crop|rotate|flip|mirror|pan|resize|aspect\s*ratio|9:16|16:9)\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Transform & Framing',
        message: 'Crop, zoom, rotate, and aspect-ratio transforms are currently not available in Fastcutz.ai.'
      },
      explanation: 'Crop, zoom, rotate, and aspect-ratio transforms are currently not available in Fastcutz.ai.'
    };
  }

  // 6. Speed / Time Effects
  if (
    /\b(slow\s*motion|slow\s*mo|slomo|speed\s*up|fast\s*forward|timelapse|time\s*lapse|reverse|freeze\s*frame|boomerang)\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Speed & Time Effects',
        message: 'Exportable speed changes and reverse/freeze effects are currently not available in Fastcutz.ai (you can preview at 1x/2x/5x using the Speed toggle).'
      },
      explanation: 'Exportable speed changes and reverse/freeze effects are currently not available in Fastcutz.ai.'
    };
  }

  // 7. Voiceover / AI Audio Generation
  if (
    /\b(voiceover|voice\s*over|record\s*voice|text\s*to\s*speech|tts|ai\s*voice|auto\s*duck|reverb|echo\s*effect|dubbing)\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Voiceover & Advanced Audio',
        message: 'Voiceover and advanced audio effects are currently not available in Fastcutz.ai. You can use Voice Enhance, Noise Removal, or \'+ Add Music\' instead.'
      },
      explanation: 'Voiceover and advanced audio effects are currently not available in Fastcutz.ai.'
    };
  }

  // ====================================================================
  // STEP 2: SUPPORTED EDITING ACTIONS
  // ====================================================================

  // 1. TRIM / CUT SECTION (Ranges: "cut from 0:10 to 0:15", "trim 5s to 12s", "delete from 10 to 20")
  const trimRegex = /(?:cut|trim|delete|remove)\s+(?:from|between)?\s*([0-9:.]+\s*s?)\s*(?:to|-|and)\s*([0-9:.]+\s*s?)/i;
  const trimMatch = lower.match(trimRegex);
  if (trimMatch) {
    const startMs = parseTimeStringToMs(trimMatch[1]);
    const endMs = parseTimeStringToMs(trimMatch[2]);
    if (startMs !== null && endMs !== null) {
      return {
        action: 'TRIM_SECTION',
        payload: { startMs, endMs },
        explanation: `Cutting range ${(startMs / 1000).toFixed(1)}s to ${(endMs / 1000).toFixed(1)}s.`
      };
    }
  }

  // Single timestamp cut ("cut at 0:15", "split at 10s")
  const splitRegex = /(?:cut|split|delete|trim)\s+at\s+([0-9:.]+\s*s?)/i;
  const splitMatch = lower.match(splitRegex);
  if (splitMatch) {
    const atMs = parseTimeStringToMs(splitMatch[1]);
    if (atMs !== null) {
      return {
        action: 'TRIM_SECTION',
        payload: { startMs: atMs, endMs: atMs + 1000 },
        explanation: `Splitting and cutting 1-second interval around ${(atMs / 1000).toFixed(1)}s.`
      };
    }
  }

  // 2. REMOVE SILENCE
  if (
    /\b(silence|awkward\s*pause|cut\s*pause|remove\s*pause|dead\s*air)\b/i.test(lower)
  ) {
    return {
      action: 'REMOVE_SILENCE',
      payload: { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 },
      explanation: 'Detecting and removing speech pauses longer than 1.2 seconds.'
    };
  }

  // 3. MEME INSERTION (Strict Intent Rule: only fires on explicit meme/reaction or specific meme alias)
  const hasMemeWord = /\b(meme|reaction)\b/i.test(lower);
  const hasUserClipWord = /\b(my\s+meme|my\s+uploaded\s+clip|uploaded\s+meme|my\s+clip|my\s+custom\s+clip|own\s+meme|custom\s+meme|user\s+clip)\b/i.test(lower);
  const matchedSpecificMeme = MEME_SPECIFIC_MATCHERS.find(m => m.regex.test(lower));

  if (hasUserClipWord) {
    const targetMs = extractTargetTimestamp(lower, currentProjectMs, project);
    return {
      action: 'INSERT_USER_CLIP',
      payload: {
        clipId: 'custom_latest',
        atProjectMs: targetMs
      },
      explanation: `Inserting your uploaded clip at ${(targetMs / 1000).toFixed(1)}s.`
    };
  }

  if (matchedSpecificMeme) {
    const targetMs = extractTargetTimestamp(lower, currentProjectMs, project);
    return {
      action: 'INSERT_LIBRARY_MEME',
      payload: {
        memeId: matchedSpecificMeme.id,
        atProjectMs: targetMs
      },
      explanation: `Inserting "${matchedSpecificMeme.title}" meme reaction at ${(targetMs / 1000).toFixed(1)}s.`
    };
  }

  if (hasMemeWord) {
    // User requested a meme or reaction, but no known library alias matched.
    // Determine whether this is a generic meme request or a request for an unlisted meme name.
    const cleaned = lower
      .replace(/(?:insert|add|put|place|play|drop|include)\s+/gi, '')
      .replace(/(?:at|around|on|near)\s+[0-9:.]+\s*s?/gi, '')
      .replace(/\b(a|an|the|funny|hilarious|random|good|cool|quick|short|video|clip|reaction|meme|reaction clip)\b/gi, ' ')
      .trim();

    const remainingTokens = cleaned.split(/\s+/).filter(Boolean);
    if (remainingTokens.length > 0) {
      const requestedName = remainingTokens.join(' ');
      return {
        action: 'UNSUPPORTED_OPERATION',
        payload: {
          feature: `Meme '${requestedName}'`,
          message: `Meme '${requestedName}' is not in the built-in library. Choose one from 'Choose a Meme' or upload your own .mp4 under 'Insert Your Own'.`
        },
        explanation: `Meme '${requestedName}' is not in the built-in library.`
      };
    }

    // Generic meme request (e.g. "insert a meme at 0:08", "add funny meme at 5s")
    const targetMs = extractTargetTimestamp(lower, currentProjectMs, project);
    const defaultMeme = MEME_LIBRARY[0];
    return {
      action: 'INSERT_LIBRARY_MEME',
      payload: {
        memeId: defaultMeme.id,
        atProjectMs: targetMs
      },
      explanation: `Inserting "${defaultMeme.title}" meme reaction at ${(targetMs / 1000).toFixed(1)}s.`
    };
  }

  // 4. TRANSITIONS
  if (lower.includes('transition') || lower.includes('fade') || lower.includes('wipe') || lower.includes('dissolve')) {
    let type: 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideup' = 'fade';
    if (lower.includes('dissolve')) type = 'dissolve';
    else if (lower.includes('wipeleft') || lower.includes('wipe left')) type = 'wipeleft';
    else if (lower.includes('wiperight') || lower.includes('wipe right')) type = 'wiperight';
    else if (lower.includes('slideup') || lower.includes('slide up')) type = 'slideup';
    else if (lower.includes('fade')) type = 'fade';

    return {
      action: 'ADD_TRANSITION',
      payload: { type, durationMs: 400 },
      explanation: `Adding ${type} transition to current cut point.`
    };
  }

  // 5. RESET AUDIO
  if (
    lower.includes('reset audio') ||
    lower.includes('original audio') ||
    lower.includes('bypass audio') ||
    lower.includes('clear audio') ||
    lower.includes('turn off all audio')
  ) {
    return {
      action: 'RESET_AUDIO',
      payload: {},
      explanation: 'Resetting audio enhancements and noise removal to default (off).'
    };
  }

  // 6. ENHANCE AUDIO (Speaker Voice Enhancement)
  if (
    lower.includes('enhance') ||
    lower.includes('voice') ||
    lower.includes('clearer') ||
    lower.includes('boost audio') ||
    lower.includes('crisp')
  ) {
    const isDisable = lower.includes('disable') || lower.includes('off') || lower.includes('turn off');
    return {
      action: 'ENHANCE_AUDIO',
      payload: { enabled: !isDisable },
      explanation: isDisable
        ? 'Disabling speaker voice enhancement.'
        : 'Activating Speaker Voice Enhancement (80Hz HPF, 250Hz warmth cut, 3kHz presence boost, dynamics leveling).'
    };
  }

  // 7. REMOVE NOISE (Background Noise Removal)
  if (
    lower.includes('noise') ||
    lower.includes('hiss') ||
    lower.includes('hum') ||
    lower.includes('background sound') ||
    lower.includes('clean audio') ||
    lower.includes('rumble')
  ) {
    const isDisable = lower.includes('disable') || lower.includes('off') || lower.includes('turn off');
    return {
      action: 'REMOVE_NOISE',
      payload: { enabled: !isDisable },
      explanation: isDisable
        ? 'Disabling background noise removal.'
        : 'Activating Background Noise Removal (100Hz HPF, 7500Hz LPF, dynamic noise-floor gate).'
    };
  }

  // 8. TRANSCRIPT & TIMESTAMPS
  if (lower.includes('transcript') || lower.includes('speech to text')) {
    return {
      action: 'GENERATE_TRANSCRIPT',
      payload: {},
      explanation: 'Synchronizing word-level transcript to timeline.'
    };
  }

  if (lower.includes('timestamp') || lower.includes('chapter') || lower.includes('marker')) {
    return {
      action: 'GENERATE_TIMESTAMPS',
      payload: {},
      explanation: 'Generating YouTube/Reels video chapter timestamps.'
    };
  }

  // 9. UNDO / REDO HELPER
  if (/\b(undo|redo|revert)\b/i.test(lower)) {
    return {
      action: 'AMBIGUOUS_NEED_CLARIFICATION',
      payload: {
        message: 'To undo or redo changes, use the Undo (Ctrl+Z) and Redo (Ctrl+Y) buttons in the workspace header.',
        suggestedAction: 'Use Ctrl+Z / Ctrl+Y'
      },
      explanation: 'Undo/Redo is available via workspace header buttons and keyboard shortcuts (Ctrl+Z / Ctrl+Y).'
    };
  }

  // ====================================================================
  // STEP 3: GENERIC EDITING-INTENT CATCH-ALL
  // ====================================================================
  // If the query contains editing words but no supported action matched,
  // return a clear unsupported notice instead of a generic "didn't catch that".
  const hasEditIntent =
    /\b(effect|effects|edit|editing|animation|animate|animated|keyframe|keyframes|mask|masking|track|tracking|stabilize|stabilization|upscale|sharpen|highlight)\b/i.test(lower) ||
    /(?:put|add|apply|insert)\s+.+\s+(?:at|around)\s+[0-9:.]+/i.test(lower);

  if (hasEditIntent) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: text,
        message: 'That editing feature is currently not available in Fastcutz.ai. Supported commands: cutting/trimming timestamps, inserting memes, adding Fade/Wipe transitions, and Voice Enhance / Noise Removal.'
      },
      explanation: 'That editing feature is currently not available in Fastcutz.ai.'
    };
  }

  // ====================================================================
  // STEP 4: AMBIGUOUS EDIT PROMPTS (without timestamps)
  // ====================================================================
  const ambiguousTriggers = [
    'boring', 'bad', 'shorter', 'improve', 'fix', 'better', 'cool', 'good', 'clean up'
  ];
  if (ambiguousTriggers.some(t => lower.includes(t))) {
    return {
      action: 'AMBIGUOUS_NEED_CLARIFICATION',
      payload: {
        message: 'Could you please specify exact start and end timestamps? For example: "Cut from 0:10 to 0:25" or "Insert meme at 0:15".',
        suggestedAction: 'Please include timecodes (e.g., 0:15 or 12s).'
      },
      explanation: 'Ambiguous prompt: requested timestamps for precision.'
    };
  }

  // ====================================================================
  // STEP 5: FALLBACK (Strictly for non-editing chat or unrecognized gibberish)
  // ====================================================================
  return {
    action: 'AMBIGUOUS_NEED_CLARIFICATION',
    payload: {
      message: `I didn't quite catch that. Try commands like: "Cut from 0:10 to 0:25", "Remove silence", "Insert meme at 0:15", or "Enhance voice".`
    },
    explanation: 'Unrecognized phrasing: offered suggestions.'
  };
}

/**
 * Primary command parser: attempts /api/command with a 4s timeout,
 * and immediately falls back to parseLocalCommand on any error or missing key.
 */
export async function parseCommandWithFallback(
  rawInput: string,
  currentProjectMs = 0,
  totalDurationMs = 30000,
  project?: ProjectEDL | null
): Promise<AICommand> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: rawInput,
        currentProjectMs,
        totalDurationMs
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (!data.fallback && data.command) {
        const validated = AICommandSchema.safeParse(data.command);
        if (validated.success) {
          return validated.data;
        }
      }
    }
  } catch {
    // Timeout or network error - gracefully fall back
  } finally {
    clearTimeout(timeoutId);
  }

  // Deterministic local regex fallback
  return parseLocalCommand(rawInput, currentProjectMs, totalDurationMs, project);
}
