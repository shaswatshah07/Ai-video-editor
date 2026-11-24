import { AICommand, AICommandSchema } from '../types/commands';
import { MEME_LIBRARY } from './memeLibrary';
import { ProjectEDL } from '../types/edl';

/**
 * Parses time strings like "0:15", "1:20", "15s", "2.5s", "3 s", "10" into integer milliseconds.
 */
function parseTimeStringToMs(raw: string): number | null {
  let clean = raw.trim().toLowerCase().replace(/\s+/g, '');

  // Strip optional trailing units: seconds, second, secs, sec, se, s
  clean = clean.replace(/(?:seconds?|secs?|se|s)$/i, '');

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

  // Pure number as seconds
  const val = parseFloat(clean);
  return isNaN(val) ? null : Math.round(val * 1000);
}

/**
 * Extracts target timestamp from an explicit time ("at 0:15", "at 10s", "at 3 s", "around 10s", "at 0:04 sec").
 */
function extractTargetTimestamp(lower: string, currentProjectMs: number, _project?: ProjectEDL | null): number {
  const atMatch = lower.match(/(?:at|around|on|near)\s+([0-9:.]+\s*(?:seconds?|secs?|se|s)?)/i);
  if (atMatch) {
    const parsed = parseTimeStringToMs(atMatch[1]);
    if (parsed !== null) return parsed;
  }

  return currentProjectMs;
}

/**
 * Explicit regex matchers for each built-in meme in MEME_LIBRARY.
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
 * Detects whether the query is asking for creative creator, BGM, or video pacing advice.
 */
function checkCreatorAdvice(lower: string): AICommand | null {
  const isMusicAdvice =
    /\b(music|bgm|soundtrack|song|beat|track|audio\s*track)\b/i.test(lower) &&
    /\b(suggest|suggestion|recommend|recommendation|idea|ideas|what|best|good|which|choose|pick|advice|find|need|suitable|trendy|trending|popular)\b/i.test(lower);
  const isDirectBgmQuery =
    /^(?:suggest|recommend|find|what)\s+(?:a\s+|some\s+)?(?:trendy\s+|popular\s+)?(?:bgm|music|song|beat)\b/i.test(lower) ||
    /\b(?:bgm|music|song)\s+for\b/i.test(lower) ||
    /\b(?:pacing|tempo)\s+advice\b/i.test(lower);

  if (!isMusicAdvice && !isDirectBgmQuery) {
    return null;
  }

  let tracks: string[] = [];

  if (/\b(meesho|haul|unboxing|fashion|outfit|grwm|styling|shopping|clothing|jewellery|makeup|beauty|finds)\b/i.test(lower)) {
    tracks = [
      '1. Tauba Tauba (catchy beat for stylish product reveals)',
      '2. Aaj Ki Raat (glamorous vibe for jewellery/accessories)',
      '3. Laal Peeli Akhiyaan (upbeat energetic unboxing transitions)',
      '4. What Jhumka? (playful cute finds energy)'
    ];
  } else if (/\b(gaming|gameplay|action|streamer|stream|shooter|rpg|fps|montage|speedrun|stream\s*intro)\b/i.test(lower)) {
    tracks = [
      '1. Metamorphosis (Interworld) / Brazilian Phonk',
      '2. Aarambh Hai Prachand (Trap/Phonk Remix)',
      '3. Kalaastar / Brown Munde (high-hype beat drop)',
      '4. NCS — On & On / Mortals (classic stream hype)'
    ];
  } else if (/\b(travel|vlog|college|campus|daily|story|lifestyle|chill|aesthetic|trip|cafe|friends|roadtrip)\b/i.test(lower)) {
    tracks = [
      '1. Husn (Anuv Jain) or Ilahi (warm aesthetic/travel feel)',
      '2. Sajni / Choo Lo (chill montage vibe)',
      '3. Kasoor / Safarnama (upbeat road-trip/campus energy)'
    ];
  } else if (/\b(comedy|funny|tech|review|tutorial|talking|interview|podcast|coding|explain|guide)\b/i.test(lower)) {
    tracks = [
      '1. Sneaky Snitch / quirky funk groove',
      '2. Desi Lo-Fi instrumental (clean under voice)',
      '3. Badtameez Dil (instrumental intro hook)'
    ];
  } else {
    tracks = [
      '1. Tauba Tauba / Aaj Ki Raat (trending high-energy beats for short-form clips)',
      '2. Husn / Sajni (soulful warm vibe for lifestyle and vlogs)',
      '3. NCS / Brazilian Phonk (driving energetic tracks for fast edits)'
    ];
  }

  const tip = "Tip: Use Trending Audio inside Instagram/YouTube for copyright safety, or add an MP3 via '+ Music' at 15% volume under your voice.";
  const message = `• Trending Bollywood & Reels Tracks:\n${tracks.join('\n')}\n\n• ${tip}`;

  return {
    action: 'ASSISTANT_ADVICE',
    payload: {
      message,
      source: 'local'
    },
    explanation: 'Creator & Background Music recommendation for your video.'
  };
}

/**
 * Checks if query explicitly triggers strict unsupported feature guards.
 */
function isUnsupportedFeatureQuery(lower: string, text: string): AICommand | null {
  // 1. Sound Effects / SFX
  if (
    /\b(sound\s*effect|sfx|whoosh|vine\s*boom|boom\s*sound|ding|audio\s*effect|sound\s*clip)s?\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Sound Effects (SFX)',
        message: "Sound effects (SFX) are currently not available in Fastcutz.ai. You can add background music using '+ Add Music' or insert a meme reaction clip instead."
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
  const isTranscriptRequest = /\b(transcript|speech\s*to\s*text)\b/i.test(lower);
  if (
    !isTranscriptRequest &&
    /\b(add\s*text|text|title|heading|caption|captions|subtitle|subtitles|sticker|stickers|emoji|emojis|watermark|logo)\b/i.test(lower)
  ) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'Text, Titles & Captions',
        message: 'Adding text, stickers, or burned-in captions is currently not available in Fastcutz.ai. You can export a synchronized transcript from the Transcript tab.'
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
        message: "Voiceover and advanced audio effects are currently not available in Fastcutz.ai. You can use Voice Enhance, Reduce Low Hum (Basic), or '+ Add Music' instead."
      },
      explanation: 'Voiceover and advanced audio effects are currently not available in Fastcutz.ai.'
    };
  }

  // 8. Transcript phrase cutting without timestamps
  const hasDigit = /\d/.test(lower);
  const isCutWord = /\b(cut|trim|delete|remove|splice)\b/i.test(lower);
  const hasPhraseCutMarkers =
    /(?:cut|trim|delete|remove)\s+(?:from|between|when|where|after|the\s+part|the\s+words?|the\s+sentence|the\s+phrase|word|phrase)\b/i.test(lower) ||
    (/(?:cut|trim|delete|remove)\b/i.test(lower) && /\b(?:saying|said|words?|phrase|sentence)\b/i.test(lower)) ||
    (/(?:cut|trim|delete|remove)\s+["'][^"']+["']/i.test(lower));

  if (isCutWord && !hasDigit && hasPhraseCutMarkers) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: 'transcript_phrase_cut',
        message: "Transcript phrase cutting is not available in Fastcutz.ai. Please use timestamps instead (for example: 'Cut from 0:10 to 0:25')."
      },
      explanation: "Transcript phrase cutting is not available in Fastcutz.ai. Please use timestamps instead (for example: 'Cut from 0:10 to 0:25')."
    };
  }

  // 9. Unknown/unsupported meme request (e.g. "insert meme rickroll")
  const hasMemeWord = /\b(meme|reaction)\b/i.test(lower);
  const hasUserClipWord = /\b(my\s+meme|my\s+uploaded\s+clip|uploaded\s+meme|my\s+clip|my\s+custom\s+clip|own\s+meme|custom\s+meme|user\s+clip)\b/i.test(lower);
  const matchedSpecificMeme = MEME_SPECIFIC_MATCHERS.some((m) => m.regex.test(lower));

  if (hasMemeWord && !hasUserClipWord && !matchedSpecificMeme) {
    const cleaned = lower
      .replace(/(?:insert|add|put|place|play|drop|include)\s+/gi, '')
      .replace(/(?:at|around|on|near)\s+[0-9:.]+\s*(?:seconds?|secs?|se|s)?/gi, '')
      .replace(/\b(a|an|the|funny|hilarious|random|good|cool|quick|short|video|clip|reaction|meme|reaction clip|here|there|now|this|spot|point)\b/gi, ' ')
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
  }

  // 10. Generic editing effects catch-all
  const hasEditIntent =
    /\b(effect|effects|animation|animate|animated|keyframe|keyframes|mask|masking|track|tracking|stabilize|stabilization|upscale|sharpen|highlight)\b/i.test(lower);
  if (hasEditIntent) {
    return {
      action: 'UNSUPPORTED_OPERATION',
      payload: {
        feature: text,
        message: 'That editing feature is currently not available in Fastcutz.ai. Supported commands: cutting/trimming timestamps, inserting memes, adding Fade transitions, Voice Enhance, and Reduce Low Hum (Basic).'
      },
      explanation: 'That editing feature is currently not available in Fastcutz.ai.'
    };
  }

  return null;
}

/**
 * Parses directly supported timeline edits.
 */
function parseSupportedAction(
  rawInput: string,
  currentProjectMs = 0,
  _totalDurationMs = 30000,
  project?: ProjectEDL | null
): AICommand | null {
  const lower = rawInput.trim().toLowerCase();

  // 1. TRIM / CUT SECTION (Ranges: "cut from 0:10 to 0:15", "trim 5s to 12s", "delete from 10 to 20", "cut from 0:05 to 0:10 s", "cut from 0:05 to 0:10 sec")
  const trimRegex = /(?:cut|trim|delete|remove)\s+(?:from|between)?\s*([0-9:.]+\s*(?:seconds?|secs?|se|s)?)\s*(?:to|-|and)\s*([0-9:.]+\s*(?:seconds?|secs?|se|s)?)/i;
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

  // Single timestamp split clarification ("split at 10s", "split at 0:05 sec")
  const splitCheckRegex = /\bsplit\s+at\s+([0-9:.]+\s*(?:seconds?|secs?|se|s)?)/i;
  const splitCheckMatch = lower.match(splitCheckRegex);
  if (splitCheckMatch) {
    const atMs = parseTimeStringToMs(splitCheckMatch[1]);
    const atSecStr = atMs !== null ? `${(atMs / 1000).toFixed(1)}s` : splitCheckMatch[1];
    return {
      action: 'AMBIGUOUS_NEED_CLARIFICATION',
      payload: {
        message: `To split at ${atSecStr}, scrub the playhead to that point and tap the Split (S) button or press the 'S' key.`,
        suggestedAction: `Move playhead to ${atSecStr} and press 'S'`
      },
      explanation: `Split command at a single timestamp requires manual playhead placement and Split (S).`
    };
  }

  // Single timestamp cut ("cut at 0:15", "delete at 10s", "trim at 5s", "cut at 0:05 sec")
  const splitRegex = /(?:cut|delete|trim)\s+at\s+([0-9:.]+\s*(?:seconds?|secs?|se|s)?)/i;
  const splitMatch = lower.match(splitRegex);
  if (splitMatch) {
    const atMs = parseTimeStringToMs(splitMatch[1]);
    if (atMs !== null) {
      return {
        action: 'TRIM_SECTION',
        payload: { startMs: atMs, endMs: atMs + 1000 },
        explanation: `Cutting 1-second interval around ${(atMs / 1000).toFixed(1)}s.`
      };
    }
  }

  // 2. REMOVE SILENCE (support plurals: silences?, pauses?)
  if (
    /\b(silences?|awkward\s*pauses?|cut\s*pauses?|remove\s*pauses?|pauses?|dead\s*air)\b/i.test(lower)
  ) {
    return {
      action: 'REMOVE_SILENCE',
      payload: { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 },
      explanation: 'Detecting and removing speech pauses longer than 1.2 seconds.'
    };
  }

  // 3. MEME INSERTION
  const hasMemeWord = /\b(meme|reaction)\b/i.test(lower);
  const hasUserClipWord = /\b(my\s+meme|my\s+uploaded\s+clip|uploaded\s+meme|my\s+clip|my\s+custom\s+clip|own\s+meme|custom\s+meme|user\s+clip)\b/i.test(lower);
  const matchedSpecificMeme = MEME_SPECIFIC_MATCHERS.find((m) => m.regex.test(lower));

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
  if (lower.includes('transition') || lower.includes('fade') || lower.includes('wipe') || lower.includes('dissolve') || lower.includes('slide') || lower.includes('spin') || lower.includes('zoom')) {
    // Requests explicitly asking for dissolve, wipe, wipeleft, wiperight, slide, slideup, zoom transition, or spin -> return UNSUPPORTED
    const unsupportedMatch = lower.match(/\b(dissolve|wipe\s*left|wipe\s*right|wipe|slide\s*up|slide|zoom\s*transition|spin)\b/i);
    if (unsupportedMatch && !lower.includes('fade')) {
      return {
        action: 'UNSUPPORTED_OPERATION',
        payload: {
          feature: 'transition_style',
          message: "Only Fade transitions are currently supported in Fastcutz.ai (and baked into your MP4 export). Try 'Add fade transition at 0:11'."
        },
        explanation: 'Only Fade transitions are currently supported in Fastcutz.ai (and baked into your MP4 export).'
      };
    }

    // Generic transition or fade prompts -> ADD_TRANSITION with type 'fade'
    const type = 'fade';

    // Parse optional target timestamps: "at 0:11 sec", "at 0:11", "at 11s", "at 11.5 seconds"
    let targetMs: number | undefined = undefined;
    const timeMatch = lower.match(/(?:at|around|on|near|to)\s+([0-9:.]+\s*(?:seconds?|secs?|se|s)?)/i) ||
                      lower.match(/\b([0-9]+:[0-9]{2}(?:\.[0-9]+)?\s*(?:seconds?|secs?|se|s)?)\b/i) ||
                      lower.match(/\b([0-9]+(?:\.[0-9]+)?\s*(?:seconds?|secs?|se|s))\b/i);
    if (timeMatch) {
      const parsed = parseTimeStringToMs(timeMatch[1]);
      if (parsed !== null && !isNaN(parsed)) {
        targetMs = parsed;
      }
    }

    // Detect explicit playhead words
    const usePlayhead = /\b(here|at marker|at playhead|current position|playhead position|current playhead)\b/i.test(lower);

    return {
      action: 'ADD_TRANSITION',
      payload: {
        type,
        durationMs: 400,
        ...(targetMs !== undefined ? { targetMs } : {}),
        ...(usePlayhead ? { usePlayhead: true } : {})
      } as any,
      explanation: targetMs !== undefined
        ? `Adding Fade transition at ${(targetMs / 1000).toFixed(1)}s (included in MP4 export).`
        : usePlayhead
        ? 'Adding Fade transition at current playhead (included in MP4 export).'
        : 'Adding Fade transition to cut point (included in MP4 export).'
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
      explanation: 'Resetting audio enhancements and hum filter to default (off).'
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

  // 7. REMOVE NOISE (Reduce Low Hum Basic)
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
        ? 'Disabling Reduce Low Hum (Basic).'
        : 'Activating Reduce Low Hum (Basic) (Cascaded 180Hz HPF + 6.2kHz LPF + Noise Gate).'
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
        message: 'To undo or redo changes, tap the Undo or Redo buttons in the workspace header.',
        suggestedAction: 'Use the Undo / Redo buttons in the header'
      },
      explanation: 'Undo/Redo is available via the Undo and Redo buttons in the workspace header.'
    };
  }

  return null;
}

/**
 * Evaluates whether a command is an instant, deterministic timeline edit (<5ms).
 * Excludes queries that ask for advice or trigger unsupported features.
 */
function parseInstantSupportedCommand(
  rawInput: string,
  currentProjectMs = 0,
  totalDurationMs = 30000,
  project?: ProjectEDL | null
): AICommand | null {
  const lower = rawInput.trim().toLowerCase();

  // If the query asks for creator/BGM advice, it should pass to Tier 2 (Gemini) or Tier 3
  if (checkCreatorAdvice(lower)) {
    return null;
  }

  // If the query touches an unsupported feature, it should pass to Tier 2 (Gemini) or Tier 3
  if (isUnsupportedFeatureQuery(lower, rawInput.trim())) {
    return null;
  }

  // Check supported timeline edits
  return parseSupportedAction(rawInput, currentProjectMs, totalDurationMs, project);
}

/**
 * Deterministic local parser matching approved operations, creator advice, and unsupported guards.
 */
export function parseLocalCommand(
  rawInput: string,
  currentProjectMs = 0,
  totalDurationMs = 30000,
  project?: ProjectEDL | null
): AICommand {
  const text = rawInput.trim();
  const lower = text.toLowerCase();

  // 1. Creator & BGM advice check
  const adviceCmd = checkCreatorAdvice(lower);
  if (adviceCmd) {
    return adviceCmd;
  }

  // 2. Unsupported feature guards
  const unsupportedCmd = isUnsupportedFeatureQuery(lower, text);
  if (unsupportedCmd) {
    return unsupportedCmd;
  }

  // 3. Supported timeline actions
  const supportedCmd = parseSupportedAction(rawInput, currentProjectMs, totalDurationMs, project);
  if (supportedCmd) {
    return supportedCmd;
  }

  // 4. Ambiguous edit prompts
  const ambiguousTriggers = [
    'boring', 'bad', 'shorter', 'improve', 'fix', 'better', 'cool', 'good', 'clean up'
  ];
  if (ambiguousTriggers.some((t) => lower.includes(t))) {
    return {
      action: 'AMBIGUOUS_NEED_CLARIFICATION',
      payload: {
        message: 'Could you please specify exact start and end timestamps? For example: "Cut from 0:10 to 0:25" or "Insert meme at 0:15".',
        suggestedAction: 'Please include timecodes (e.g., 0:15 or 12s).'
      },
      explanation: 'Ambiguous prompt: requested timestamps for precision.'
    };
  }

  // 5. Fallback for unrecognized phrasing
  return {
    action: 'AMBIGUOUS_NEED_CLARIFICATION',
    payload: {
      message: 'I didn\'t quite catch that. Try commands like: "Cut from 0:10 to 0:25", "Remove silence", "Suggest BGM for a vlog", or "Enhance voice".'
    },
    explanation: 'Unrecognized phrasing: offered suggestions.'
  };
}

/**
 * Primary 3-Tier command parser:
 * - Tier 1: Instant local supported edits (<5ms) without network latency
 * - Tier 2: Live Gemini API (/api/command) with 8000ms timeout for smart refusals and creator advice
 * - Tier 3: Local fallback for offline / localhost / timeout
 */
export async function parseCommandWithFallback(
  rawInput: string,
  currentProjectMs = 0,
  totalDurationMs = 30000,
  project?: ProjectEDL | null,
  hasBgMusic = false
): Promise<AICommand> {
  // ====================================================================
  // TIER 1: INSTANT LOCAL SUPPORTED EDITS (<5ms)
  // ====================================================================
  const instantCmd = parseInstantSupportedCommand(rawInput, currentProjectMs, totalDurationMs, project);
  if (instantCmd) {
    return instantCmd;
  }

  // ====================================================================
  // TIER 2: LIVE GEMINI API (/api/command with 8000ms timeout)
  // ====================================================================
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: rawInput,
        currentProjectMs,
        totalDurationMs,
        clipCount: project?.items?.length || 0,
        hasBgMusic,
        availableMemes: MEME_LIBRARY.map((m) => m.id)
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
    // Timeout or network error - proceed seamlessly to Tier 3
  } finally {
    clearTimeout(timeoutId);
  }

  // ====================================================================
  // TIER 3: LOCAL FALLBACK
  // ====================================================================
  return parseLocalCommand(rawInput, currentProjectMs, totalDurationMs, project);
}
