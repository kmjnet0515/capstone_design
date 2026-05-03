# -*- coding: utf-8 -*-
"""
범용 HWPX 분석 엔진 — 특정 샘플에 고정되지 않음.

ZIP(OPC) 열거, container/version 힌트, Contents/section*.xml 텍스트 런·평문 통계.
편집 API는 ``edit_package`` 모듈.
"""

from __future__ import annotations

import os
import zipfile
from typing import Any

from .knowledge_domains import REQUIRED_KNOWLEDGE, knowledge_summary
from .opc_manifest import discover_section_members, parse_container_rootfile, read_version_xml
from .package_zip import is_probably_hwpx, list_package_index
from .section_xml import collect_text_runs, section_plain_text


def _limits_from_knowledge() -> list[str]:
    return [
        d["id"]
        for d in REQUIRED_KNOWLEDGE
        if d.get("implementation") not in ("complete", "external", "out_of_scope")
    ]


def analyze_document(
    hwpx_path: str,
    *,
    text_preview_max: int = 8000,
) -> dict[str, Any]:
    path = os.path.abspath(hwpx_path)
    out: dict[str, Any] = {
        "engine": {
            "name": "hwpx_analysis.universal",
            "description": "OPC ZIP + OWPML section*.xml 텍스트 수집·패치 지원",
        },
        "input_path": path,
        "knowledge_base": knowledge_summary(),
        "inherent_engine_limits": _limits_from_knowledge(),
        "package": None,
        "opcf": None,
        "version": None,
        "sections": [],
        "semantic": None,
        "recommendations": [],
    }

    if not os.path.isfile(path):
        out["recommendations"].append("파일 없음")
        return out

    pk = list_package_index(path)
    out["package"] = pk
    if not pk.get("ok"):
        out["recommendations"].append(pk.get("error", "패키지 읽기 실패"))
        return out

    mt = (pk.get("mimetype") or "").lower()
    if mt and "hwpx" not in mt and "hwp" not in mt:
        out["recommendations"].append(
            f"mimetype 이 한컴 HWPX 계통이 아님: {pk.get('mimetype')!r}"
        )

    out["opcf"] = parse_container_rootfile(path)
    out["version"] = read_version_xml(path)

    if not zipfile.is_zipfile(path):
        return out

    sections_detail = []
    runs_total = 0
    full_chunks: list[str] = []
    with zipfile.ZipFile(path, "r") as zf:
        names = zf.namelist()
        sec_paths = discover_section_members(names)
        for sp in sec_paths:
            try:
                raw = zf.read(sp)
            except Exception as e:
                sections_detail.append({"path": sp, "ok": False, "error": str(e)})
                continue
            try:
                runs = collect_text_runs(raw)
                plain = section_plain_text(raw)
            except Exception as e:
                sections_detail.append({"path": sp, "ok": False, "error": str(e)})
                continue
            runs_total += len(runs)
            preview = plain if len(plain) <= text_preview_max else plain[:text_preview_max] + "…"
            full_chunks.append(plain)
            sections_detail.append(
                {
                    "path": sp,
                    "ok": True,
                    "text_run_count": len(runs),
                    "char_count": len(plain),
                    "text_preview": preview,
                }
            )

    full_text = "\n".join(full_chunks)
    out["sections"] = sections_detail
    out["semantic"] = {
        "ok": bool(sec_paths),
        "full_text": full_text,
        "stats": {
            "section_file_count": len(sec_paths),
            "text_run_total": runs_total,
            "char_total": len(full_text),
        },
    }
    if not sec_paths:
        out["recommendations"].append("Contents/section*.xml 없음 — 본문 파트 확인")

    out["file_shape"] = {
        "extension_hwpx": path.lower().endswith(".hwpx"),
        "zip": zipfile.is_zipfile(path),
        "probably_hwpx_by_extension": is_probably_hwpx(path),
    }

    return out
