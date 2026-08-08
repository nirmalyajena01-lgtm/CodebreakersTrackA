"""Embedding backends for swarm memory (SPEC §2.4).

Tries sentence-transformers (all-MiniLM-L6-v2); on ANY failure falls back to a
deterministic 256-dim hashing bag-of-words embedding in pure numpy, so the app
never breaks. The sentence-transformers import is LAZY so the app starts even
when the package (or model weights) is unavailable.
"""

from __future__ import annotations

import hashlib
import logging
import re

import numpy as np

logger = logging.getLogger("swarmtriage.memory.embeddings")

_HASH_DIM = 256


class HashingEmbedder:
    """Deterministic pure-numpy fallback: 256-dim hashing bag-of-words."""

    name = "hashing-bow-256"

    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = np.zeros((len(texts), _HASH_DIM), dtype=np.float32)
        for row, text in enumerate(texts):
            tokens = re.findall(r"[a-z0-9]+", text.lower())
            for token in tokens:
                digest = hashlib.md5(token.encode("utf-8")).digest()
                index = int.from_bytes(digest[:4], "little") % _HASH_DIM
                sign = 1.0 if digest[4] % 2 == 0 else -1.0
                vectors[row, index] += sign
            # Light bigram signal so word order carries some meaning.
            for left, right in zip(tokens, tokens[1:]):
                digest = hashlib.md5(f"{left}_{right}".encode("utf-8")).digest()
                index = int.from_bytes(digest[:4], "little") % _HASH_DIM
                vectors[row, index] += 0.5
            norm = np.linalg.norm(vectors[row])
            if norm > 0:
                vectors[row] /= norm
        return vectors


class SentenceTransformerEmbedder:
    """sentence-transformers all-MiniLM-L6-v2 wrapper (lazy import)."""

    name = "all-MiniLM-L6-v2"

    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer  # lazy import

        self._model = SentenceTransformer("all-MiniLM-L6-v2")

    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = self._model.encode(texts, normalize_embeddings=True)
        return np.asarray(vectors, dtype=np.float32)


class Embedder:
    """Facade: sentence-transformers if available, hashing fallback otherwise."""

    def __init__(self) -> None:
        self._backend = None

    def _get_backend(self):
        if self._backend is None:
            try:
                self._backend = SentenceTransformerEmbedder()
                logger.info("Embedder: using sentence-transformers all-MiniLM-L6-v2.")
            except Exception as exc:
                logger.warning(
                    "Embedder: sentence-transformers unavailable (%s); "
                    "using deterministic hashing fallback.",
                    exc,
                )
                self._backend = HashingEmbedder()
        return self._backend

    @property
    def backend_name(self) -> str:
        return self._get_backend().name

    def encode(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, _HASH_DIM), dtype=np.float32)
        return self._get_backend().encode(texts)

    @staticmethod
    def cosine_similarity(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        """Cosine similarity of one query vector against a matrix of vectors."""
        query_norm = np.linalg.norm(query)
        matrix_norms = np.linalg.norm(matrix, axis=1)
        denom = np.maximum(query_norm * matrix_norms, 1e-9)
        return (matrix @ query) / denom
