# -*- coding: utf-8 -*-
"""
OLE 안에 들어 있는 HWP 바디/DocInfo 스트림(zlib raw deflate) 재압축 검증.

압축 해제 → raw deflate로 다시 압축 → 해제 했을 때 동일 바이트면
“스토리지에 넣을 blob” 교체가 이론상 가능(크기는 달라질 수 있음).
"""

from __future__ import annotations

import os
import zlib
from typing import Any


def _raw_deflate_compress(data: bytes, level: int = 6) -> bytes:
    c = zlib.compressobj(level=level, wbits=-15)
    return c.compress(data) + c.flush()


def zlib_raw_deflate(decompressed: bytes, *, level: int = 6) -> bytes:
    """HWP Section/DocInfo 스트림에 쓰는 raw deflate(-15) 압축."""
    return _raw_deflate_compress(decompressed, level=level)


def verify_ole_zlib_streams(hwp_path: str) -> dict[str, Any]:
    try:
        import olefile
    except ImportError as e:
        return {"ok": False, "error": str(e), "streams": []}

    path = os.path.abspath(hwp_path)
    if not olefile.isOleFile(path):
        return {"ok": False, "error": "OLE 아님", "streams": []}

    candidates: list[list[str]] = []
    with olefile.OleFileIO(path) as ole:
        for entry in ole.listdir(streams=True, storages=False):
            parts = [str(x) for x in entry]
            if parts == ["DocInfo"]:
                candidates.append(parts)
            elif (
                len(parts) == 2
                and parts[0] in ("BodyText", "ViewText")
                and parts[1].startswith("Section")
            ):
                candidates.append(parts)
        candidates.sort(key=lambda p: (p[0], p[1] if len(p) > 1 else ""))

    rows = []
    all_ok = True
    with olefile.OleFileIO(path) as ole:
        for parts in candidates:
            with ole.openstream(parts) as raw_f:
                blob = raw_f.read()
            try:
                dec = zlib.decompress(blob, -15)
            except zlib.error as e:
                rows.append(
                    {
                        "path": "/".join(parts),
                        "ok": False,
                        "error": f"decompress: {e}",
                        "stored_bytes": len(blob),
                    }
                )
                all_ok = False
                continue

            enc = _raw_deflate_compress(dec)
            try:
                dec2 = zlib.decompress(enc, -15)
            except zlib.error as e:
                rows.append(
                    {
                        "path": "/".join(parts),
                        "ok": False,
                        "error": f"re-decompress: {e}",
                        "stored_bytes": len(blob),
                    }
                )
                all_ok = False
                continue

            ok = dec2 == dec
            if not ok:
                all_ok = False
            rows.append(
                {
                    "path": "/".join(parts),
                    "ok": ok,
                    "stored_bytes": len(blob),
                    "recompressed_bytes": len(enc),
                    "decompressed_bytes": len(dec),
                }
            )

    return {
        "ok": True,
        "all_zlib_roundtrip_semantically_ok": all_ok,
        "streams": rows,
    }
