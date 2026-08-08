"""GeminiLLM — Google Gemini provider via plain REST (SPEC_AUTH_ONBOARDING §2).

Selected with ``LLM_PROVIDER=gemini``. Calls
``https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}``
with ``requests`` (no google SDK). Always instructs the model to reply with
strict JSON and parses the result robustly (strips markdown fences).
On ANY failure (missing key, network, HTTP error, parse error) it logs a
warning and falls back to MockLLM — mirroring kimi.py's pattern so the
pipeline never breaks.
"""

from __future__ import annotations

import json
import logging
import re

import requests

from .. import config
from .base import BaseLLM
from .mock import MockLLM

logger = logging.getLogger("swarmtriage.llm.gemini")

STRICT_JSON_INSTRUCTION = (
    "You are a backend component of an enterprise support automation system. "
    "Reply with EXACTLY ONE valid JSON object and nothing else: no markdown "
    "fences, no commentary, no trailing text."
)

REQUEST_TIMEOUT_SECONDS = 30


class GeminiLLM(BaseLLM):
    name = "gemini"

    def __init__(self) -> None:
        self._fallback = MockLLM()

    @property
    def _endpoint(self) -> str:
        return (
            f"{config.GEMINI_API_BASE}/{config.GEMINI_MODEL}:generateContent"
            f"?key={config.GEMINI_API_KEY}"
        )

    def complete_json(self, system: str, prompt: str) -> dict:
        if not config.GEMINI_API_KEY:
            logger.warning("GeminiLLM unavailable (no GEMINI_API_KEY); falling back to MockLLM.")
            return self._fallback.complete_json(system, prompt)
        try:
            response = requests.post(
                self._endpoint,
                headers={"Content-Type": "application/json"},
                json={
                    "system_instruction": {
                        "parts": [{"text": f"{STRICT_JSON_INSTRUCTION}\n\n{system}"}]
                    },
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.3,
                        "responseMimeType": "application/json",
                    },
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            content = (
                response.json()["candidates"][0]["content"]["parts"][0]["text"] or ""
            )
            return self._parse_json(content)
        except Exception as exc:
            logger.warning(
                "GeminiLLM request/parse failed (%s); falling back to MockLLM.", exc
            )
            return self._fallback.complete_json(system, prompt)

    @staticmethod
    def _parse_json(content: str) -> dict:
        content = content.strip()
        # Strip markdown code fences if the model wrapped the JSON anyway.
        fence = re.search(r"```(?:json)?\s*(.*?)```", content, re.DOTALL)
        if fence:
            content = fence.group(1).strip()
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
        # Last resort: extract the outermost {...} block.
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        raise ValueError("GeminiLLM response was not valid JSON")
