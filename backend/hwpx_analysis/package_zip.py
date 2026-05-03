# -*- coding: utf-8 -*-
"""HWPX ZIP 패키지 열거·재작성(mimetype 우선·순서 보존)."""

from __future__ import annotations

import os
import zipfile
from typing import Any


def is_probably_hwpx(path: str) -> bool:
    p = path.lower()
    if not p.endswith(".hwpx"):
        return False
    if not zipfile.is_zipfile(path):
        return False
    return True


def list_package_index(hwpx_path: str) -> dict[str, Any]:
    path = os.path.abspath(hwpx_path)
    if not os.path.isfile(path):
        return {"ok": False, "error": f"파일 없음: {path}", "entries": []}
    if not zipfile.is_zipfile(path):
        return {"ok": False, "error": "ZIP 아님", "entries": []}

    entries = []
    with zipfile.ZipFile(path, "r") as zf:
        mimetype_content: str | None = None
        for info in zf.infolist():
            row = {
                "name": info.filename,
                "file_size": info.file_size,
                "compress_type": info.compress_type,
                "is_dir": info.filename.endswith("/"),
            }
            entries.append(row)
        try:
            if "mimetype" in zf.namelist():
                mimetype_content = zf.read("mimetype").decode("utf-8", errors="replace").strip()
        except Exception:
            mimetype_content = None

    return {
        "ok": True,
        "path": path,
        "entry_count": len(entries),
        "mimetype": mimetype_content,
        "entries": entries,
    }


def read_member(hwpx_path: str, member: str) -> bytes:
    with zipfile.ZipFile(hwpx_path, "r") as zf:
        return zf.read(member)


def repackage_with_overrides(
    src_hwpx: str,
    dest_hwpx: str,
    overrides: dict[str, bytes],
) -> dict[str, Any]:
    """
    원본 ZIP 엔트리 순서를 유지한 채, 지정 멤버만 내용 교체하여 새 .hwpx 작성.
    mimetype 이 있으면 첫 번째로 넣고 STORED 로 쓴다.
    """
    src_hwpx = os.path.abspath(src_hwpx)
    dest_hwpx = os.path.abspath(dest_hwpx)

    if not zipfile.is_zipfile(src_hwpx):
        return {"ok": False, "error": "소스가 ZIP 아님"}

    replaced = 0
    with zipfile.ZipFile(src_hwpx, "r") as zin:
        infos = zin.infolist()
        order = [i.filename for i in infos]
        data_cache: dict[str, bytes] = {}
        for info in infos:
            name = info.filename
            if name in overrides:
                data_cache[name] = overrides[name]
                replaced += 1
            else:
                data_cache[name] = zin.read(name)

    ordered_names = list(order)
    if "mimetype" in ordered_names:
        ordered_names = ["mimetype"] + [n for n in ordered_names if n != "mimetype"]

    with zipfile.ZipFile(dest_hwpx, "w") as zout:
        for name in ordered_names:
            raw = data_cache[name]
            if name == "mimetype":
                zi = zipfile.ZipInfo("mimetype")
                zi.compress_type = zipfile.ZIP_STORED
                zout.writestr(zi, raw)
            else:
                zout.writestr(name, raw, compress_type=zipfile.ZIP_DEFLATED)

    return {
        "ok": True,
        "src": src_hwpx,
        "dest": dest_hwpx,
        "members_replaced": replaced,
        "total_members": len(order),
    }
