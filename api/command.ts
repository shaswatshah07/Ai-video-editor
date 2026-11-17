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

  const systemInstruction = `You are a deterministic video editing assistant. You must parse user editing requests into one of the following operations:
1. TRIM_SECTION { startMs, endMs }
2. REMOVE_SILENCE { minDurationMs: 1200, paddingPreMs: 150, paddingPostMs: 200 }
3. INSERT_LIBRARY_MEME { memeId: "fail_trombone" | "wait_what" | "victory_cheer" | "shocked_blink", atProjectMs }
4. INSERT_USER_CLIP { clipId: "custom_clip", atProjectMs }
5. ADD_TRANSITION { type: "fade" | "dissolve" | "wipeleft" | "wiperight" | "slideup", durationMs: 400 }
6. ENHANCE_AUDIO { enabled: true }
7. REMOVE_NOISE { enabled: true }
8. GENERATE_TRANSCRIPT {}
9. GENERATE_TIMESTAMPS {}
10. AMBIGUOUS_NEED_CLARIFICATION { message }
11. UNSUPPORTED_OPERATION { feature, message: "This feature is not currently supported. Our team is working on adding it in a future update!" }

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
