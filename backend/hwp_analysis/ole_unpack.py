# -*- coding: utf-8 -*-
"""OLE 복합문서에서 스트림을 원시 바이트 그대로 디렉터리 트리로 풀어냄 (검사·diff용)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def unpack_ole_streams(hwp_path: str, out_dir: str) -> dict[str, Any]:
    try:
        import olefile
    except ImportError as e:
        return {"ok": False, "error": str(e), "files": []}

    hwp_path = os.path.abspath(hwp_path)
    out_path = Path(out_dir).resolve()
    if not olefile.isOleFile(hwp_path):
        return {"ok": False, "error": "OLE 파일 아님", "files": []}

    out_path.mkdir(parents=True, exist_ok=True)
    written: list[str] = []

    with olefile.OleFileIO(hwp_path) as ole:
        for entry in ole.listdir(streams=True, storages=False):
            parts = [str(p) for p in entry]
            rel = Path(*parts) if parts else Path("unknown")
            dest = out_path / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            with ole.openstream(entry) as src, open(dest, "wb") as dst:
                dst.write(src.read())
            written.append(str(dest.relative_to(out_path)))

    return {"ok": True, "error": None, "out_dir": str(out_path), "streams_written": len(written), "files": sorted(written)}
