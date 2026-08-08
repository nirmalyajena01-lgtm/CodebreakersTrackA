"""KimiLLM — Moonshot AI provider via the OpenAI-compatible client (SPEC §2.3).

Always instructs the model to reply with strict JSON and parses the result.
On ANY API or parse failure it logs a warning and falls back to MockLLM so
the pipeline never breaks.
"""

from __future__ import annotations

import json
import logging
import re

from .. import config
from .base import BaseLLM
from .mock import MockLLM

logger = logging.getLogger("swarmtriage.llm.kimi")

STRICT_JSON_INSTRUCTION = (
    "You are a backend component of an enterprise support automation system. "
    "Reply with EXACTLY ONE valid JSON object and nothing else: no markdown "
    "fences, no commentary, no trailing text."
)


class KimiLLM(BaseLLM):
    name = "kimi"

    def __init__(self) -> None:
        self._fallback = MockLLM()
        self._client = None
        try:
            from openai import OpenAI

            self._client = OpenAI(
                base_url=config.KIMI_BASE_URL,
                api_key=config.KIMI_API_KEY,
            )
        except Exception as exc:  # pragma: no cover - import/config issues
            logger.warning("KimiLLM: could not init OpenAI client (%s); using mock.", exc)

    def complete_json(self, system: str, prompt: str) -> dict:
        if self._client is None or not config.KIMI_API_KEY:
            logger.warning("KimiLLM unavailable (no client/API key); falling back to MockLLM.")
            return self._fallback.complete_json(system, prompt)
        try:
            response = self._client.chat.completions.create(
                model=config.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": f"{STRICT_JSON_INSTRUCTION}\n\n{system}"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content or ""
            return self._parse_json(content)
        except Exception as exc:
            logger.warning("KimiLLM request/parse failed (%s); falling back to MockLLM.", exc)
            return self._fallback.complete_json(system, prompt)

    @staticmethod
    def _parse_json(content: str) -> dict:
        content = content.strip()
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
        raise ValueError("KimiLLM response was not valid JSON")
