"""LLM factory — reads LLM_PROVIDER (default "mock"), cached singleton (SPEC §2.3)."""

from __future__ import annotations

import threading

from .. import config
from .base import BaseLLM

_lock = threading.Lock()
_instance: BaseLLM | None = None


def get_llm() -> BaseLLM:
    """Return the configured LLM provider singleton."""
    global _instance
    with _lock:
        if _instance is not None:
            return _instance
        if config.LLM_PROVIDER == "kimi":
            from .kimi import KimiLLM

            _instance = KimiLLM()
        elif config.LLM_PROVIDER == "gemini":
            from .gemini import GeminiLLM

            _instance = GeminiLLM()
        elif config.LLM_PROVIDER == "zai":
            from .zai import ZaiLLM

            _instance = ZaiLLM()
        else:
            from .mock import MockLLM

            _instance = MockLLM()
        return _instance


def reset_llm() -> None:
    """Drop the cached singleton (used by tests)."""
    global _instance
    with _lock:
        _instance = None
