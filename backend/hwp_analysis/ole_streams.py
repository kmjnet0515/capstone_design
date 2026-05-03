# -*- coding: utf-8 -*-
"""OLE 복합문서 스트림 목록 (olefile)."""

from __future__ import annotations

from typing import Any


def list_ole_streams(path: str) -> dict[str, Any]:
    try:
        import olefile
    except ImportError:
        return {
            "ok": False,
            "error": "olefile 미설치 (pip install olefile)",
            "streams": [],
        }

    if not olefile.isOleFile(path):
        return {
            "ok": False,
            "error": "OLE 파일이 아님",
            "streams": [],
        }

    with olefile.OleFileIO(path) as ole:
        streams: list[dict[str, Any]] = []
        for e in ole.listdir(streams=True, storages=False):
            name = "/".join(e)
            try:
                with ole.openstream(e) as s:
                    sz = len(s.read())
            except OSError:
                sz = None
            streams.append({"path": name, "size_bytes": sz})
        streams.sort(key=lambda x: x["path"])

    return {"ok": True, "error": None, "streams": streams}
