# -*- coding: utf-8 -*-
"""FileHeader 스트림 바이너리만 읽어 버전·시그니처 확인 (hwp5 없이 1차 검증)."""

from __future__ import annotations

import struct
from typing import Any

from .binary_peek import HWP_SIG_PREFIX


def decode_file_header_stream(raw: bytes) -> dict[str, Any]:
    if len(raw) < 40:
        return {"ok": False, "error": f"FileHeader 너무 짧음: {len(raw)} bytes"}

    sig = raw[:32].split(b"\x00")[0]
    v = raw[32:36]
    ver = (v[3], v[2], v[1], v[0])
    flags = struct.unpack("<I", raw[36:40])[0]

    ok_sig = sig.startswith(HWP_SIG_PREFIX)
    return {
        "ok": True,
        "signature_ascii_prefix": sig.decode("latin-1", errors="replace")[:24],
        "signature_matches_hwp5": ok_sig,
        "version_tuple": list(ver),
        "flags_u32": flags,
        "raw_header_hex_64": raw[:64].hex(),
    }


def read_file_header_from_ole(path: str) -> dict[str, Any]:
    try:
        import olefile
    except ImportError:
        return {"ok": False, "error": "olefile 없음"}

    if not olefile.isOleFile(path):
        return {"ok": False, "error": "OLE 아님"}

    with olefile.OleFileIO(path) as ole:
        if not ole.exists("FileHeader"):
            return {"ok": False, "error": "FileHeader 스트림 없음"}
        with ole.openstream("FileHeader") as fh:
            raw = fh.read()

    info = decode_file_header_stream(raw)
    info["stream_size_bytes"] = len(raw)
    return info
