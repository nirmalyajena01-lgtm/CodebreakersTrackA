"""ZaiLLM — z-ai GLM provider via the OpenAI-compatible client.

Selected with ``LLM_PROVIDER=zai``. Uses the ``openai`` python package
against the OpenAI-compatible z-ai chat-completions endpoint (base URL from
``ZAI_BASE_URL``, default ``https://api.z.ai/api/paas/v4``; model from
``ZAI_MODEL``, default ``glm-5.2``; key from ``ZAI_API_KEY``).

Always instructs the model to reply with strict JSON and parses the result
robustly (strips markdown fences). On ANY failure (missing key, client
init, network, HTTP error, parse error) it logs a warning and falls back
to MockLLM — mirroring kimi.py's pattern so the pipeline never breaks.
"""

from __future__ import annotations

import json
import logging
import re

from .. import config
from .base import BaseLLM
from .mock import MockLLM

logger = logging.getLogger("swarmtriage.llm.zai")

STRICT_JSON_INSTRUCTION = (
    "You are a backend component of an enterprise support automation system. "
    "Reply with EXACTLY ONE valid JSON object and nothing else: no markdown "
    "fences, no commentary, no trailing text."
)


class ZaiLLM(BaseLLM):
    name = "zai"

    def __init__(self) -> None:
        self._fallback = MockLLM()
        self._client = None
        try:
            from openai import OpenAI

            self._client = OpenAI(
                base_url=config.ZAI_BASE_URL,
                api_key=config.ZAI_API_KEY,
            )
        except Exception as exc:  # pragma: no cover - import/config issues
            logger.warning("ZaiLLM: could not init OpenAI client (%s); using mock.", exc)

    def complete_json(self, system: str, prompt: str) -> dict:
        if self._client is None or not config.ZAI_API_KEY:
            logger.warning("ZaiLLM unavailable (no client/API key); falling back to MockLLM.")
            return self._fallback.complete_json(system, prompt)
        try:
            response = self._client.chat.completions.create(
                model=config.ZAI_MODEL,
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
            logger.warning("ZaiLLM request/parse failed (%s); falling back to MockLLM.", exc)
            return self._fallback.complete_json(system, prompt)

    @staticmethod
    def _parse_json(content: str) -> dict:
        content = content.strip()
        # Strip markdown fences (```json ... ```) if present.
        fence = re.search(r"```(?:json)?\s*(.*?)```", content, re.DOTALL | re.IGNORECASE)
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
        raise ValueError("ZaiLLM response was not valid JSON")
