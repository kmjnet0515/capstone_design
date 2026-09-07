# -*- coding: utf-8 -*-
"""파일 메타·시그니처·선두 헥스 덤프."""

from __future__ import annotations

import os
from typing import Any

OLE_SIG = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
HWP_SIG_PREFIX = b"HWP Document File"


def peek_binary(path: str, hex_bytes: int = 256) -> dict[str, Any]:
    path = os.path.abspath(path)
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        head = f.read(hex_bytes)

    is_ole = len(head) >= 8 and head[:8] == OLE_SIG
    out: dict[str, Any] = {
        "path": path,
        "size_bytes": size,
        "leading_hex_bytes": hex_bytes,
        "hex_preview": head[:hex_bytes].hex(),
        "is_ole_compound": is_ole,
    }
    return out
