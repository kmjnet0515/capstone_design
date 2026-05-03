# -*- coding: utf-8 -*-
"""META-INF/container.xml, version.xml, Contents/content.hpf 등 OPC 힌트."""

from __future__ import annotations

import os
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Any


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def parse_container_rootfile(hwpx_path: str) -> dict[str, Any]:
    path = os.path.abspath(hwpx_path)
    if not zipfile.is_zipfile(path):
        return {"ok": False, "error": "ZIP 아님", "rootfiles": []}

    with zipfile.ZipFile(path, "r") as zf:
        cands = [n for n in zf.namelist() if n.replace("\\", "/").endswith("META-INF/container.xml")]
        if not cands:
            return {"ok": True, "error": None, "rootfiles": [], "note": "container.xml 없음"}
        xml_bytes = zf.read(cands[0])

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        return {"ok": False, "error": f"container.xml 파싱: {e}", "rootfiles": []}

    rootfiles = []
    for el in root.iter():
        if _local_name(el.tag) == "rootfile" and el.get("full-path"):
            rootfiles.append(
                {
                    "full_path": el.get("full-path"),
                    "media_type": el.get("media-type"),
                }
            )
    return {"ok": True, "error": None, "rootfiles": rootfiles}


def read_version_xml(hwpx_path: str) -> dict[str, Any]:
    path = os.path.abspath(hwpx_path)
    if not zipfile.is_zipfile(path):
        return {"ok": False, "error": "ZIP 아님"}

    with zipfile.ZipFile(path, "r") as zf:
        names = zf.namelist()
        ver = [n for n in names if re.search(r"(^|/)version\.xml$", n.replace("\\", "/"))]
        if not ver:
            return {"ok": True, "version_text": None, "note": "version.xml 없음"}
        text = zf.read(ver[0]).decode("utf-8", errors="replace")
    return {"ok": True, "member": ver[0], "version_text_preview": text[:800]}


_SECTION_RE = re.compile(r"^Contents/section\d+\.xml$", re.I)


def discover_section_members(namelist: list[str]) -> list[str]:
    norm = [n.replace("\\", "/") for n in namelist]
    secs = [n for n in norm if _SECTION_RE.match(n)]
    return sorted(secs, key=lambda s: (len(s), s.lower()))


def resolve_section_member(requested: str, sections: list[str]) -> str | None:
    """
    ZIP 엔트리명은 제작기/OS에 따라 대소문자만 다른 경우가 있어,
    Linux(Docker)에서 exact match 가 실패할 수 있음 — canonical 멤버명을 돌려줌.
    """
    if not requested:
        return None
    if requested in sections:
        return requested
    r = requested.replace("\\", "/").lower()
    for s in sections:
        if s.replace("\\", "/").lower() == r:
            return s
    return None
