/**
 * Vercel Serverless Function Proxy for Gemini API Free Tier
 * Features:
 * - 10 requests / minute per-IP in-memory rate limiting.
 * - Strict JSON response schema enforcement.
 * - Model fallback retry: tries GEMINI_MODEL (default 'gemini-2.5-flash'), falls back to 'gemini-2.0-flash'.
 * - Rule A: Smart Contextual Refusals for unsupported operations with real workarounds.
 * - Rule B: In-editor Creator & Background Music Suggestor (ASSISTANT_ADVICE).
 * - Rule C: Action whitelist & project context.
 * - Seamless fallback: returns { fallback: true } so client immediately uses local deterministic parser.
 */

declare const process: { env: Record<string, string | undefined> };

// Simple in-memory rate limiter per IP
const ipRequestMap = new Map<string, { count: number; resetAt: number }>();

async function callGeminiApi(
  modelName: string,
  apiKey: string,
  prompt: string,
  systemInstruction: string
): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
        maxOutputTokens: 320
      }
    })
  });
}

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
  const primaryModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const fallbackModel = 'gemini-2.0-flash';

  if (!apiKey) {
    return res.status(200).json({
      fallback: true,
      reason: 'GEMINI_KEY_NOT_CONFIGURED',
      message: 'Zero-cost offline mode: using deterministic local parser.'
    });
  }

  const {
    prompt,
    currentProjectMs,
    totalDurationMs,
    clipCount,
    hasBgMusic,
    availableMemes
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const systemInstruction = `You are an expert video editing AI assistant for Fastcutz.ai. You parse user editing requests and creator queries into strict JSON.

ALLOWED ACTIONS WHITELIST (RULE C):
1. TRIM_SECTION { startMs: number, endMs: number }
2. REMOVE_SILENCE { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 }
3. INSERT_LIBRARY_MEME { memeId: "damnnnnnnnnnnn" | "mission_passed" | "ohhhhhhhhhhhhh_penguinz0" | "pointing_finger" | "pow_ohhhhhhhhhhhhhhhhh" | "ten_hours_later" | "the_rock_eyebrow_raise" | "wait_who_are_you" | "yeah_boy" | "you_serious_spiderman", atProjectMs: number }
4. INSERT_USER_CLIP { clipId: "custom_clip", atProjectMs: number }
5. ADD_TRANSITION { type: "fade" | "dissolve" | "wipeleft" | "wiperight" | "slideup", durationMs: 400 }
6. ENHANCE_AUDIO { enabled: boolean }
7. REMOVE_NOISE { enabled: boolean }
8. RESET_AUDIO {}
9. GENERATE_TRANSCRIPT {}
10. GENERATE_TIMESTAMPS {}
11. AMBIGUOUS_NEED_CLARIFICATION { message: string, suggestedAction?: string }
12. UNSUPPORTED_OPERATION { feature: string, message: string }
13. ASSISTANT_ADVICE { message: string }

RULE A — SMART CONTEXTUAL REFUSALS (STRICT HONESTY):
Fastcutz.ai runs inside the browser and deliberately does NOT support complex offline canvas transformations.
NEVER approximate an unsupported request with an unrelated feature (e.g., never insert a meme for SFX, never add a transition for a filter).
If the user requests an unsupported feature, ALWAYS return action: 'UNSUPPORTED_OPERATION' with a polite explanation of WHY it cannot be done on the canvas and suggest an exact Fastcutz.ai workaround:
- Sound effects / SFX (whoosh, ding, vine boom): "Sound effects (SFX) are not directly supported on the timeline. Workaround: You can add background music using '+ Add Music' or insert a meme reaction clip."
- Overlap / overlay / PiP / split screen / multi-track layering: "PiP and video layering are not currently available. Workaround: Fastcutz.ai splices clips sequentially; you can arrange clips in sequence or add Fade/Wipe transitions between them."
- Visual filters / color grading / LUT / green screen / blur / face tracking: "Visual filters and color grading are not currently available. Keep your video authentic and clean, or grade footage prior to importing."
- Burned-in captions / text / stickers / watermark: "Adding text overlays or burned-in captions is not currently available. Workaround: Generate a synchronized transcript under the Transcript tab and export it as .txt or .vtt for YouTube / Premiere."
- Speed changes / slow-mo / timelapse / reverse in export: "Speed modifications in export are not currently supported (you can preview at 1x/2x/5x in the player)."
- Voiceover / AI TTS / voice clone / reverb: "Voiceover recording and AI voice generation are not supported. Workaround: Use Voice Enhance or Reduce Low Hum (Basic) to polish existing voice recordings."
- Transcript phrase cutting (cutting words without timestamps): "Transcript phrase cutting is not available. Workaround: Please specify exact timestamps instead (e.g., 'Cut from 0:10 to 0:25')."
- Non-library memes (e.g. 'rickroll'): "That meme is not in the built-in library. Workaround: Choose one from 'Choose a Meme' or upload your own .mp4 under 'Insert Your Own'."

RULE B — CREATOR & BACKGROUND MUSIC SUGGESTOR (ASSISTANT_ADVICE):
If the user asks for creative ideas, background music recommendations, pacing advice, or soundtrack choices (e.g. "Suggest background music for a tech review", "what music should I use for a fast vlog", "give me music ideas", "how should I pace this video"):
Return action: 'ASSISTANT_ADVICE' with payload { "message": string } and an explanation.
The message MUST include:
1. Recommended music genre and target BPM/mood matching their topic (e.g. Tech -> Minimal Ambient Electronic/Chillhop ~90-105 BPM; Vlog -> Chill Lo-Fi or Upbeat Acoustic ~100-115 BPM; Gaming -> Synthwave/EDM ~125-135 BPM; Workout -> Fast Trap/Phonk ~130-145 BPM).
2. Free, royalty-free sources where they can download safe tracks (e.g. YouTube Audio Library, Pixabay Music, Free Music Archive).
3. Concrete Fastcutz.ai tip: Click '+ Add Music' in the top bar to load the audio file, and set the music volume slider to 15–20% so speaker voice stays crisp and prominent.

PROJECT CONTEXT:
- Current playhead: ${currentProjectMs || 0}ms
- Total project duration: ${totalDurationMs || 0}ms
- Number of timeline clips: ${clipCount ?? 1}
- Background music active: ${hasBgMusic ? 'Yes' : 'No'}
- Available library memes: ${availableMemes ? (Array.isArray(availableMemes) ? availableMemes.join(', ') : availableMemes) : '10 built-in memes'}

OUTPUT FORMAT:
Return ONLY a valid JSON object with keys:
{
  "action": "<ONE_OF_13_ACTIONS>",
  "payload": { ... },
  "explanation": "<short explanation>"
}`;

  try {
    let response = await callGeminiApi(primaryModel, apiKey, prompt, systemInstruction);

    // If primary model failed (404 or bad request or server error), retry with fallback model
    if (!response.ok && (response.status === 404 || response.status >= 400) && primaryModel !== fallbackModel) {
      response = await callGeminiApi(fallbackModel, apiKey, prompt, systemInstruction);
    }

    if (!response.ok) {
      return res.status(200).json({ fallback: true, reason: `UPSTREAM_API_${response.status}` });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(200).json({ fallback: true, reason: 'EMPTY_RESPONSE' });
    }

    // Strip markdown code fences if present
    let cleanText = rawText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.slice(7);
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.slice(3);
    }
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.slice(0, -3);
    }
    cleanText = cleanText.trim();

    const parsed = JSON.parse(cleanText);
    return res.status(200).json({ fallback: false, command: parsed });
  } catch {
    return res.status(200).json({ fallback: true, reason: 'FETCH_ERROR' });
  }
}
