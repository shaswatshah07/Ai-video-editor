/**
 * Vercel Serverless Function Proxy for Gemini API Free Tier
 * Features:
 * - 10 requests / minute per-IP in-memory rate limiting.
 * - Strict JSON response schema enforcement.
 * - Seamless fallback: if GEMINI_API_KEY is not set, or rate-limited (429), or offline,
 *   it returns { fallback: true } so client immediately uses local deterministic parser.
 */

declare const process: { env: Record<string, string | undefined> };

// Simple in-memory rate limiter per IP
const ipRequestMap = new Map<string, { count: number; resetAt: number }>();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || '127.0.0.1';
  const now = Date.now();

  // Rate Limiting (10 req / min)
  const ipData = ipRequestMap.get(clientIp);
  if (ipData) {
    if (now < ipData.resetAt) {
      if (ipData.count >= 10) {
        return res.status(200).json({
          fallback: true,
          reason: 'RATE_LIMIT_EXCEEDED_10_RPM',
          message: 'Free tier rate limit reached. Using instant local parser.'
        });
      }
      ipData.count += 1;
    } else {
      ipRequestMap.set(clientIp, { count: 1, resetAt: now + 60000 });
    }
  } else {
    ipRequestMap.set(clientIp, { count: 1, resetAt: now + 60000 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!apiKey) {
    return res.status(200).json({
      fallback: true,
      reason: 'GEMINI_KEY_NOT_CONFIGURED',
      message: 'Zero-cost offline mode: using deterministic local parser.'
    });
  }

  const { prompt, currentProjectMs, totalDurationMs } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const systemInstruction = `You are a deterministic video editing assistant for Fastcutz.ai. You must parse user editing requests into one of the following operations:
1. TRIM_SECTION { startMs, endMs }
2. REMOVE_SILENCE { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 }
3. INSERT_LIBRARY_MEME { memeId: "damnnnnnnnnnnn" | "mission_passed" | "ohhhhhhhhhhhhh_penguinz0" | "pointing_finger" | "pow_ohhhhhhhhhhhhhhhhh" | "ten_hours_later" | "the_rock_eyebrow_raise" | "wait_who_are_you" | "yeah_boy" | "you_serious_spiderman", atProjectMs }
4. INSERT_USER_CLIP { clipId: "custom_clip", atProjectMs }
5. ADD_TRANSITION { type: "fade" | "dissolve" | "wipeleft" | "wiperight" | "slideup", durationMs: 400 }
6. ENHANCE_AUDIO { enabled: boolean }
7. REMOVE_NOISE { enabled: boolean }
8. RESET_AUDIO {}
9. GENERATE_TRANSCRIPT {}
10. GENERATE_TIMESTAMPS {}
11. AMBIGUOUS_NEED_CLARIFICATION { message: string, suggestedAction?: string }
12. UNSUPPORTED_OPERATION { feature: string, message: string }

STRICT CAPABILITIES & HONESTY RULES:
Fastcutz.ai ONLY supports:
- Cutting/trimming timestamps or ranges (TRIM_SECTION)
- Detecting/removing silences and pauses (REMOVE_SILENCE)
- Inserting library meme reaction clips or user uploaded clips sequentially (INSERT_LIBRARY_MEME, INSERT_USER_CLIP)
- Adding transitions (fade, wipeleft, wiperight, dissolve, slideup) between clips (ADD_TRANSITION)
- Speaker voice enhancement (ENHANCE_AUDIO)
- Background noise removal (REMOVE_NOISE)
- Resetting audio enhancements (RESET_AUDIO)
- Generating word transcript or YouTube chapter timestamps (GENERATE_TRANSCRIPT, GENERATE_TIMESTAMPS)

STRICT RULE: NEVER approximate an unsupported request with a different tool. Never insert a meme when the user asks for a sound effect, overlay, filter, text, or other effect. If the user requests ANY unsupported editing feature, ALWAYS return action: 'UNSUPPORTED_OPERATION' with a polite, specific message stating "<Feature> is currently not available in Fastcutz.ai."

Specific Unsupported Categories:
- Sound effects / SFX (sfx, whoosh, vine boom, ding, sound clip): return UNSUPPORTED_OPERATION with message "Sound effects (SFX) are currently not available in Fastcutz.ai. You can add background music using '+ Add Music' or insert a meme reaction clip instead."
- Overlap / overlay / PiP / split screen / layering: return UNSUPPORTED_OPERATION with message "Overlap / overlay effects are currently not available in Fastcutz.ai. Right now you can splice clips sequentially, drag to reorder them, or add Fade/Wipe transitions between clips."
- Visual filters / blur / color grading / LUT / green screen / chroma key: return UNSUPPORTED_OPERATION with message "Visual filters and color/keying effects are currently not available in Fastcutz.ai."
- Text / titles / subtitles / captions / stickers / emoji / watermark: return UNSUPPORTED_OPERATION with message "Adding text, stickers, or burned-in captions is currently not available in Fastcutz.ai."
- Crop / zoom / rotate / flip / pan / aspect ratio: return UNSUPPORTED_OPERATION with message "Crop, zoom, rotate, and aspect-ratio transforms are currently not available in Fastcutz.ai."
- Speed / slow motion / fast forward / reverse / freeze frame: return UNSUPPORTED_OPERATION with message "Exportable speed changes and reverse/freeze effects are currently not available in Fastcutz.ai (you can preview at 1x/2x/5x using the Speed toggle)."
- Voiceover / TTS / AI voice / reverb: return UNSUPPORTED_OPERATION with message "Voiceover and advanced audio effects are currently not available in Fastcutz.ai. You can use Voice Enhance, Noise Removal, or '+ Add Music' instead."
- Transcript phrase cutting (cutting words or phrases without timestamps): return UNSUPPORTED_OPERATION with message "Transcript phrase cutting is not available in Fastcutz.ai. Please use timestamps instead (for example: 'Cut from 0:10 to 0:25')."
- Unknown/unsupported memes (e.g. "rickroll"): return UNSUPPORTED_OPERATION with message "Meme '<name>' is not in the built-in library. Choose one from 'Choose a Meme' or upload your own .mp4 under 'Insert Your Own'."
- Any other unsupported editing effect: return UNSUPPORTED_OPERATION with message "That editing feature is currently not available in Fastcutz.ai. Supported commands: cutting/trimming timestamps, inserting memes, adding Fade/Wipe transitions, and Voice Enhance / Noise Removal."

Current project time: ${currentProjectMs || 0}ms. Total duration: ${totalDurationMs || 0}ms.
Return ONLY valid JSON with keys: action, payload, explanation.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      return res.status(200).json({ fallback: true, reason: `UPSTREAM_API_${response.status}` });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(200).json({ fallback: true, reason: 'EMPTY_RESPONSE' });
    }

    const parsed = JSON.parse(rawText);
    return res.status(200).json({ fallback: false, command: parsed });
  } catch {
    return res.status(200).json({ fallback: true, reason: 'FETCH_ERROR' });
  }
}
