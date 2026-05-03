# -*- coding: utf-8 -*-
"""hwp5(pyhwp)로 문단·표 등 의미 레이어 분석 (설치되어 있을 때만)."""

from __future__ import annotations

from contextlib import closing
from typing import Any

_MISSING: dict[str, Any] = {
    "ok": False,
    "error": "hwp5 미설치 또는 import 실패 (pip install pyhwp)",
    "data": None,
}


def analyze_semantic(path: str) -> dict[str, Any]:
    try:
        from hwp5.binmodel import Paragraph, SectionDef, TableControl, Text
        from hwp5.dataio import ParseError
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.filestructure import FileHeader
        from hwp5.treeop import ENDEVENT, STARTEVENT
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        d = dict(_MISSING)
        d["error"] = f"hwp5 import 실패: {e}"
        return d

    import os

    path = os.path.abspath(path)
    if not os.path.isfile(path):
        return {"ok": False, "error": f"파일 없음: {path}", "data": None}

    try:
        data = _run_hwp5(path, Hwp5File, FileHeader, Paragraph, SectionDef,
                        TableControl, Text, STARTEVENT, ENDEVENT)
    except InvalidHwp5FileError as e:
        return {"ok": False, "error": f"HWP 5.x 아님: {e}", "data": None}
    except ParseError as e:
        return {"ok": False, "error": f"파싱 오류: {e}", "data": None}

    return {"ok": True, "error": None, "data": data}


def _run_hwp5(
    path,
    Hwp5File,
    FileHeader,
    Paragraph,
    SectionDef,
    TableControl,
    Text,
    STARTEVENT,
    ENDEVENT,
):
    import os

    with closing(Hwp5File(path)) as hwp:
        header = hwp.header
        version = header.version
        flags_int = header.value.get("flags")
        flags_map = (
            FileHeader.Flags.dictvalue(flags_int) if flags_int is not None else {}
        )

        result: dict[str, Any] = {
            "file": {
                "path": path,
                "size_bytes": os.path.getsize(path),
            },
            "hwp5_header": {
                "version": list(version) if version is not None else None,
                "flags": flags_map,
            },
            "paragraphs": [],
            "tables": [],
        }

        current_section_id = None
        para_stack: list[dict[str, Any]] = []

        for event, item in hwp.events():
            model, attributes, _ctx = item

            if model is SectionDef and event is STARTEVENT:
                current_section_id = attributes.get("section_id")

            elif model is TableControl and event is STARTEVENT:
                result["tables"].append(
                    {
                        "table_id": attributes.get("table_id"),
                        "section_id": current_section_id,
                    }
                )

            elif model is Paragraph and event is STARTEVENT:
                para_stack.append(
                    {
                        "section_id": current_section_id,
                        "paragraph_id": attributes.get("paragraph_id"),
                        "text_parts": [],
                    }
                )

            elif model is Text and event is STARTEVENT and para_stack:
                chunk = attributes.get("text") or ""
                if chunk:
                    para_stack[-1]["text_parts"].append(chunk)

            elif model is Paragraph and event is ENDEVENT and para_stack:
                rec = para_stack.pop()
                text = "".join(rec.pop("text_parts", []))
                rec["text"] = text
                rec["char_count"] = len(text)
                result["paragraphs"].append(rec)

        full_text_parts = [
            p["text"] for p in result["paragraphs"] if p.get("text")
        ]
        result["full_text"] = "\n".join(full_text_parts)
        result["stats"] = {
            "paragraph_count": len(result["paragraphs"]),
            "non_empty_paragraph_count": sum(
                1 for p in result["paragraphs"] if (p.get("text") or "").strip()
            ),
            "table_control_count": len(result["tables"]),
        }

    return result
