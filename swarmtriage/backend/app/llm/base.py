"""LLM provider interface (SPEC §2.3)."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseLLM(ABC):
    """Pluggable LLM provider. All providers return parsed JSON dicts."""

    name: str = "base"

    @abstractmethod
    def complete_json(self, system: str, prompt: str) -> dict:
        """Complete a prompt and return a parsed JSON object.

        Implementations MUST always return a dict; on any model/parse failure
        they fall back to deterministic behavior rather than raising.
        """
        raise NotImplementedError
