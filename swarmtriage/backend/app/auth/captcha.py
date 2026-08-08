"""Captcha generation + verification (SPEC_AUTH_ONBOARDING §1).

Pure-Python SVG captcha: a 5-char code rendered as an SVG string with
per-character rotation/position jitter and 2–3 noise lines. No external
imaging libraries (no Pillow / captcha packages).

Codes use A–Z and 0–9 excluding the ambiguous characters 0/O and 1/I.
Each captcha is valid for 10 minutes and is single-use: the code hash is
stored in memory and removed on the first verification attempt. Captchas
are intentionally NOT persisted — a restart simply invalidates them.
"""

from __future__ import annotations

import hashlib
import random
import threading
import time
import uuid
from html import escape

# 5-char codes from A-Z0-9 without ambiguous 0/O/1/I (SPEC_AUTH_ONBOARDING §1).
CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 5
CAPTCHA_TTL_SECONDS = 10 * 60  # 10 minutes

SVG_WIDTH = 220
SVG_HEIGHT = 64

# Dark, readable glyph palette (works on the light captcha background).
_GLYPH_COLORS = ["#1f2933", "#3e4c59", "#52606d", "#7b341e", "#234e52", "#44337a"]
_NOISE_COLORS = ["#9aa5b1", "#cbd2d9", "#a0aec0"]

_lock = threading.Lock()
# captcha_id -> {"hash": sha256(code), "expires": epoch seconds}
_captchas: dict[str, dict] = {}


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def _purge_expired(now: float) -> None:
    expired = [cid for cid, entry in _captchas.items() if entry["expires"] < now]
    for cid in expired:
        del _captchas[cid]


def _char_svg(char: str, index: int) -> str:
    """One glyph with per-char rotation/position jitter."""
    x = 26 + index * 38 + random.uniform(-5, 5)
    y = 42 + random.uniform(-7, 7)
    angle = random.uniform(-28, 28)
    size = random.randint(28, 34)
    color = random.choice(_GLYPH_COLORS)
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" '
        f'transform="rotate({angle:.1f} {x:.1f} {y:.1f})" '
        f'font-family="monospace" font-size="{size}" font-weight="bold" '
        f'fill="{color}">{escape(char)}</text>'
    )


def _noise_line_svg() -> str:
    color = random.choice(_NOISE_COLORS)
    x1, y1 = random.uniform(0, 40), random.uniform(8, SVG_HEIGHT - 8)
    x2, y2 = random.uniform(SVG_WIDTH - 40, SVG_WIDTH), random.uniform(8, SVG_HEIGHT - 8)
    cx, cy = random.uniform(60, SVG_WIDTH - 60), random.uniform(0, SVG_HEIGHT)
    width = random.uniform(1.0, 2.2)
    return (
        f'<path d="M {x1:.1f} {y1:.1f} Q {cx:.1f} {cy:.1f} {x2:.1f} {y2:.1f}" '
        f'stroke="{color}" stroke-width="{width:.1f}" fill="none"/>'
    )


def generate_captcha() -> dict[str, str]:
    """Create a new captcha. Returns {"captcha_id": str, "svg": str}."""
    code = "".join(random.choice(CHARSET) for _ in range(CODE_LENGTH))
    captcha_id = uuid.uuid4().hex

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_WIDTH}" '
        f'height="{SVG_HEIGHT}" viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}">',
        f'<rect width="{SVG_WIDTH}" height="{SVG_HEIGHT}" fill="#f5f1ea" rx="6"/>',
    ]
    for _ in range(random.randint(2, 3)):  # 2–3 noise lines
        parts.append(_noise_line_svg())
    for i, char in enumerate(code):
        parts.append(_char_svg(char, i))
    parts.append("</svg>")
    svg = "".join(parts)

    with _lock:
        _purge_expired(time.time())
        _captchas[captcha_id] = {
            "hash": _hash_code(code),
            "expires": time.time() + CAPTCHA_TTL_SECONDS,
        }
    return {"captcha_id": captcha_id, "svg": svg}


def verify_captcha(captcha_id: str, captcha_text: str) -> bool:
    """Verify a captcha attempt. Case-insensitive, single-use, 10-min expiry."""
    if not captcha_id or not captcha_text:
        return False
    with _lock:
        _purge_expired(time.time())
        entry = _captchas.pop(captcha_id, None)  # single-use: consumed either way
    if entry is None or entry["expires"] < time.time():
        return False
    return entry["hash"] == _hash_code(captcha_text)
