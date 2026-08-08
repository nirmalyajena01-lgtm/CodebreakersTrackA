"""Adaptive swarm memory (SPEC §2.4).

Stores every human rejection reason with an embedding so the Drafter (Agent D)
can retrieve relevant past feedback BEFORE drafting (the Adaptive Rejection
Learning Loop). Persisted to `backend/data/swarm_memory.json` so feedback
survives restarts.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

import numpy as np

from .. import config
from ..state import utc_now
from .embeddings import Embedder

logger = logging.getLogger("swarmtriage.memory")

_lock = threading.Lock()
_embedder = Embedder()

# In-memory store: list of entries {ticket_id, category, reason, free_text,
# text, timestamp}. Embeddings are computed on demand and cached per entry.
_entries: list[dict[str, Any]] = []


def _entry_text(reason: str, free_text: str | None) -> str:
    return f"{reason}. {free_text}".strip() if free_text else reason


def _persist() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = config.SWARM_MEMORY_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump({"entries": _entries}, fh, indent=2, ensure_ascii=False)
    tmp_path.replace(config.SWARM_MEMORY_PATH)


def load() -> None:
    """Load persisted swarm memory on startup."""
    path = config.SWARM_MEMORY_PATH
    if not path.exists():
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return
    with _lock:
        _entries.clear()
        _entries.extend(payload.get("entries", []))
    logger.info("Swarm memory: loaded %d feedback entries.", len(_entries))


def update_swarm_memory(
    ticket_id: str, category: str, reason: str, free_text: str | None
) -> None:
    """Store a rejection reason with its embedding (SPEC §2.4)."""
    entry = {
        "ticket_id": ticket_id,
        "category": category or "Unknown",
        "reason": reason,
        "free_text": free_text,
        "text": _entry_text(reason, free_text),
        "timestamp": utc_now(),
    }
    with _lock:
        _entries.append(entry)
        _persist()
    logger.info(
        "Swarm memory updated: ticket=%s category=%s reason=%r (backend=%s)",
        ticket_id,
        category,
        reason,
        _embedder.backend_name,
    )


def retrieve_relevant_feedback(
    category: str, query_text: str, top_k: int = 3
) -> list[str]:
    """Return the most relevant past rejection reasons for this draft.

    Same-category entries are the strongest relevance signal and are ranked by
    cosine similarity against the query; remaining slots are filled with
    cross-category entries whose similarity clears a small threshold.
    """
    with _lock:
        snapshot = list(_entries)
    if not snapshot or top_k <= 0:
        return []

    texts = [entry["text"] for entry in snapshot]
    query = f"{category}. {query_text}"
    try:
        matrix = _embedder.encode(texts)
        query_vec = _embedder.encode([query])[0]
        sims = Embedder.cosine_similarity(query_vec, matrix)
    except Exception as exc:  # never let retrieval break the pipeline
        logger.warning("Swarm memory retrieval embedding failed (%s); recency order.", exc)
        sims = np.zeros(len(snapshot), dtype=np.float32)

    same_category = [
        (i, float(sims[i]))
        for i, entry in enumerate(snapshot)
        if entry["category"] == category
    ]
    cross_category = [
        (i, float(sims[i]))
        for i, entry in enumerate(snapshot)
        if entry["category"] != category and float(sims[i]) > 0.1
    ]
    same_category.sort(key=lambda item: item[1], reverse=True)
    cross_category.sort(key=lambda item: item[1], reverse=True)

    chosen = [snapshot[i] for i, _ in (same_category + cross_category)[:top_k]]
    return [entry["text"] for entry in chosen]


def all_entries() -> list[dict[str, Any]]:
    """Snapshot of the full memory store (diagnostics/tests)."""
    with _lock:
        return list(_entries)
