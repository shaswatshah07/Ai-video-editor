import { AICommand, AICommandSchema } from '../types/commands';

/**
 * Parses time strings like "0:15", "1:20", "15s", "2.5s", "10" into integer milliseconds.
 */
function parseTimeStringToMs(raw: string): number | null {
  const clean = raw.trim().toLowerCase();
  
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

  // Format with "s" suffix like "15s" or "2.5s"
  if (clean.endsWith('s')) {
    const val = parseFloat(clean.slice(0, -1));
    return isNaN(val) ? null : Math.round(val * 1000);
  }

  // Pure number as seconds
  const val = parseFloat(clean);
  return isNaN(val) ? null : Math.round(val * 1000);
}

/**
 * Deterministic local regex parser matching the 9 approved operations.
 * Guaranteed 100% offline reliability with zero network dependencies.
 */
export function parseLocalCommand(
  rawInput: string,
  currentProjectMs = 0,
  _totalDurationMs = 30000
): AICommand {
  const text = rawInput.trim();
  const lower = text.toLowerCase();

  // 1. UNSUPPORTED FEATURES CHECK
  const unsupportedTriggers = [
    '3d', 'glow', 'speed', 'slow motion', 'fast forward', 'green screen',
    'chroma key', 'reverse', 'motion tracking', 'face blur', 'color grade',
    'lut', 'ai avatar', 'deepfake', 'subtitle translation', 'dubbing', 'zoom in and out'
  ];
  if (unsupportedTriggers.some(t => lower.includes(t)) || lower.includes('overlapping effect')) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: text,
        message: 'This feature is not currently supported. Our team is working on adding it in a future update!'
      },
      explanation: 'Unsupported video editing effect requested.'
    };
  }

  // 2. TRIM / CUT SECTION
  // Matches: "cut from 0:10 to 0:25", "trim 5s to 12s", "delete from 0:15 to 0:30", "cut between 10 and 20"
  const trimRegex = /(?:cut|trim|delete|remove)\s+(?:from|between)?\s*([0-9:.]+s?)\s*(?:to|-|and)\s*([0-9:.]+s?)/i;
  const trimMatch = lower.match(trimRegex);
  if (trimMatch) {
    const startMs = parseTimeStringToMs(trimMatch[1]);
    const endMs = parseTimeStringToMs(trimMatch[2]);
    if (startMs !== null && endMs !== null && startMs < endMs) {
      return {
        action: 'TRIM_SECTION',
        payload: { startMs, endMs },
        explanation: `Cutting range ${(startMs / 1000).toFixed(1)}s to ${(endMs / 1000).toFixed(1)}s.`
      };
    }
  }

  // Single timestamp cut ("cut at 0:15", "split at 10s")
  const splitRegex = /(?:cut|split)\s+at\s+([0-9:.]+s?)/i;
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

  // 3. REMOVE SILENCE
  if (
    lower.includes('silence') ||
    lower.includes('awkward pause') ||
    lower.includes('cut pause') ||
    lower.includes('remove pause') ||
    lower.includes('dead air')
  ) {
    return {
      action: 'REMOVE_SILENCE',
      payload: { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 },
      explanation: 'Detecting and removing speech pauses longer than 1.2 seconds.'
    };
  }

  // 4. MEME INSERTION (LIBRARY)
  if (lower.includes('meme') || lower.includes('funny clip') || lower.includes('reaction')) {
    // Check for user clip
    if (lower.includes('my uploaded') || lower.includes('my custom') || lower.includes('user clip')) {
      const atMatch = lower.match(/(?:at|around)\s+([0-9:.]+s?)/i);
      const atMs = atMatch ? parseTimeStringToMs(atMatch[1]) : currentProjectMs;
      return {
        action: 'INSERT_USER_CLIP',
        payload: {
          clipId: 'custom_latest',
          atProjectMs: atMs ?? currentProjectMs
        },
        explanation: `Inserting user clip at ${((atMs ?? currentProjectMs) / 1000).toFixed(1)}s.`
      };
    }

    // Determine meme ID
    let memeId: 'fail_trombone' | 'wait_what' | 'victory_cheer' | 'shocked_blink' = 'wait_what';
    if (lower.includes('fail') || lower.includes('sad') || lower.includes('trombone')) {
      memeId = 'fail_trombone';
    } else if (lower.includes('win') || lower.includes('victory') || lower.includes('cheer') || lower.includes('celebrat')) {
      memeId = 'victory_cheer';
    } else if (lower.includes('shock') || lower.includes('blink') || lower.includes('surpris') || lower.includes('gasp')) {
      memeId = 'shocked_blink';
    } else if (lower.includes('what') || lower.includes('confus') || lower.includes('wait')) {
      memeId = 'wait_what';
    }

    const atMatch = lower.match(/(?:at|around)\s+([0-9:.]+s?)/i);
    const atMs = atMatch ? parseTimeStringToMs(atMatch[1]) : currentProjectMs;

    return {
      action: 'INSERT_LIBRARY_MEME',
      payload: {
        memeId,
        atProjectMs: atMs ?? currentProjectMs
      },
      explanation: `Inserting "${memeId}" meme reaction at ${((atMs ?? currentProjectMs) / 1000).toFixed(1)}s.`
    };
  }

  // 5. TRANSITIONS
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

  // 6. ENHANCE AUDIO
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
      explanation: isDisable ? 'Disabling voice enhancement filter.' : 'Activating 80Hz HPF + 3kHz peak EQ voice enhancement.'
    };
  }

  // 7. REMOVE NOISE
  if (
    lower.includes('noise') ||
    lower.includes('hiss') ||
    lower.includes('hum') ||
    lower.includes('background sound') ||
    lower.includes('clean audio')
  ) {
    const isDisable = lower.includes('disable') || lower.includes('off') || lower.includes('turn off');
    return {
      action: 'REMOVE_NOISE',
      payload: { enabled: !isDisable },
      explanation: isDisable ? 'Disabling low-cut filter.' : 'Activating low-cut audio filter (80-120Hz high-pass) to attenuate rumble and AC hum.'
    };
  }

  // 8. TRANSCRIPT & TIMESTAMPS
  if (lower.includes('transcript') || lower.includes('subtitles') || lower.includes('captions') || lower.includes('speech to text')) {
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

  // 9. AMBIGUOUS PROMPTS NEEDING CLARIFICATION
  // Example: "remove the boring part", "cut the bad part", "make it shorter", "fix video"
  const ambiguousTriggers = [
    'boring', 'bad', 'shorter', 'improve', 'fix', 'better', 'cool', 'good', 'edit this', 'clean up'
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

  // Default clarification if unmapped
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
  totalDurationMs = 30000
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
  return parseLocalCommand(rawInput, currentProjectMs, totalDurationMs);
}
