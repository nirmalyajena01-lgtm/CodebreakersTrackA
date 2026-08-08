// ============================================================================
// z-ai GLM REST client for the demo variant.
//
// Same role as gemini.js: the demo runs its mock agent pipeline in-browser;
// when this module succeeds it upgrades classification/sentiment/drafts with
// real GLM output. ANY failure (network, HTTP, parse, timeout, missing key)
// must produce a silent fallback — callers wrap everything in try/catch.
//
// The endpoint is OpenAI-compatible: POST {base}/chat/completions with a
// Bearer key. Key: module-level trial constant below, overridable via
// localStorage "swarmtriage_zai_key". No UI anywhere mentions providers
// or models.
// ============================================================================

// Trial key — rotate after hackathon.
const ZAI_API_KEY =
  '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';

const ZAI_BASE_URL = 'https://api.z.ai/api/paas/v4';
const ZAI_MODEL = 'glm-5.2';
const TIMEOUT_MS = 8000;

function apiKey() {
  try {
    const override = localStorage.getItem('swarmtriage_zai_key');
    if (override && override.trim()) return override.trim();
  } catch {
    // localStorage unavailable — fall through to the trial key
  }
  return ZAI_API_KEY;
}

// Raw OpenAI-compatible chat-completions call with an 8 s AbortController
// timeout. Reuses gemini.js's robust JSON extraction (fences, prose, brace
// balancing) — the model is instructed to reply with strict JSON.
export async function zaiComplete(system, prompt, extractJson) {
  const key = apiKey();
  if (!key) throw new Error('no z-ai API key configured');
  const url = `${ZAI_BASE_URL}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
      }),
    });
    if (!res.ok) throw new Error(`z-ai HTTP ${res.status}`);
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('z-ai returned no text');
    return extractJson(text);
  } finally {
    clearTimeout(timer);
  }
}
