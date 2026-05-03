# -*- coding: utf-8 -*-
"""HWPX 패키지 단위 편집: 섹션 XML 텍스트 치환 후 ZIP 재작성."""

from __future__ import annotations

import os
import zipfile
from typing import Any, Callable

from .opc_manifest import discover_section_members
from .package_zip import repackage_with_overrides
from .section_xml import patch_text_runs, replace_all_substrings_in_sections


def load_section_xml_map(hwpx_path: str) -> dict[str, bytes]:
    path = os.path.abspath(hwpx_path)
    if not zipfile.is_zipfile(path):
        raise ValueError("HWPX 가 ZIP 이 아님")
    with zipfile.ZipFile(path, "r") as zf:
        names = zf.namelist()
        sections = discover_section_members(names)
        if not sections:
            raise ValueError("Contents/section*.xml 을 찾지 못함")
        return {s: zf.read(s) for s in sections}


def apply_run_patch_fn(
    hwpx_in: str,
    hwpx_out: str,
    fn: Callable[[int, str], str],
    *,
    restrict_to_members: set[str] | None = None,
) -> dict[str, Any]:
    """
    모든 섹션 XML에 대해 텍스트 런 콜백 ``fn(idx, old) -> new`` 적용.
    ``restrict_to_members`` 에 ``Contents/section0.xml`` 형태로 제한 가능.
    """
    hwpx_in = os.path.abspath(hwpx_in)
    hwpx_out = os.path.abspath(hwpx_out)

    with zipfile.ZipFile(hwpx_in, "r") as zin:
        names = zin.namelist()
        sections = discover_section_members(names)
        to_patch = [s for s in sections if restrict_to_members is None or s in restrict_to_members]
        if not to_patch:
            return {"ok": False, "error": "패치할 section*.xml 없음"}
        overrides: dict[str, bytes] = {}
        meta_sec = {}
        global_idx = 0

        for sec in to_patch:
            raw = zin.read(sec)
            off = global_idx

            def make_fn(offset: int):
                return lambda i, old: fn(offset + i, old)

            new_raw, meta = patch_text_runs(raw, make_fn(off))
            global_idx += meta.get("runs_seen", 0)
            overrides[sec] = new_raw
            meta_sec[sec] = meta

    rp = repackage_with_overrides(hwpx_in, hwpx_out, overrides)
    if not rp.get("ok"):
        return rp
    return {
        "ok": True,
        "src": hwpx_in,
        "dest": hwpx_out,
        "sections_patched": list(to_patch),
        "per_section": meta_sec,
        "repackage": rp,
    }


def apply_text_replacements(
    hwpx_in: str,
    hwpx_out: str,
    replacements: list[tuple[str, str]],
) -> dict[str, Any]:
    """모든 section*.xml 안의 텍스트 런에 부분 문자열 치환을 순차 적용."""
    if not replacements:
        return {"ok": False, "error": "replacements 비어 있음"}
    hwpx_in = os.path.abspath(hwpx_in)
    hwpx_out = os.path.abspath(hwpx_out)
    try:
        sec_map = load_section_xml_map(hwpx_in)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    new_sections, stats = replace_all_substrings_in_sections(sec_map, replacements)
    rp = repackage_with_overrides(hwpx_in, hwpx_out, new_sections)
    if not rp.get("ok"):
        return rp
    return {
        "ok": True,
        "src": hwpx_in,
        "dest": hwpx_out,
        "replacement_stats": stats,
        "repackage": rp,
    }


def apply_member_overrides(hwpx_in: str, hwpx_out: str, overrides: dict[str, bytes]) -> dict[str, Any]:
    """임의 ZIP 멤버 전체 바이트 교체(고급·XML 직접 편집 결과 등)."""
    return repackage_with_overrides(
        os.path.abspath(hwpx_in),
        os.path.abspath(hwpx_out),
        overrides,
    )
