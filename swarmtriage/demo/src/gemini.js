// ============================================================================
// Gemini REST client for the demo variant (SPEC_AUTH_ONBOARDING §2).
//
// The demo runs its mock agent pipeline in-browser; when this module succeeds
// it upgrades classification/sentiment/drafts with real Gemini output. ANY
// failure (network, HTTP, parse, timeout, missing key) must produce a silent
// fallback to the existing mock path — callers wrap everything in try/catch.
//
// Key: module-level trial constant below, overridable via localStorage
// "swarmtriage_gemini_key". No UI anywhere mentions providers or models.
// ============================================================================

// Trial key — rotate after hackathon.
const GEMINI_API_KEY = 'AQ.Ab8RN6JbZRiGedaxQ8PVeYMSAAQfyRl02Oj6S4n8yH94Aj9quQ';

const GEMINI_MODEL = 'gemini-2.0-flash';
const TIMEOUT_MS = 8000;

function apiKey() {
  try {
    const override = localStorage.getItem('swarmtriage_gemini_key');
    if (override && override.trim()) return override.trim();
  } catch {
    // localStorage unavailable — fall through to the trial key
  }
  return GEMINI_API_KEY;
}

// Extract the first balanced JSON object from an LLM text response, tolerant
// of markdown fences and surrounding prose.
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty response');
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to brace matching
  }
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('no JSON object in response');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
  }
  throw new Error('unbalanced JSON in response');
}

// Raw generateContent call with an 8 s AbortController timeout.
export async function geminiComplete(system, prompt) {
  const key = apiKey();
  if (!key) throw new Error('no Gemini API key configured');
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('Gemini returned no text');
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}
