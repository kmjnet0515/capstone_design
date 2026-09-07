# -*- coding: utf-8 -*-
"""
HWPX 문서에서 표 그리드 추출 (LLM 분류기용).
- section*.xml 안 모든 표(중첩 포함)를 깊이 우선 순회.
- 각 셀의 평문 텍스트 + 첫 ``<hp:t>`` 노드 핸들(서버 적용용 메타)만 따로 보관.
"""

from __future__ import annotations

import os
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

from .opc_manifest import discover_section_members
from .grid_absolute import attach_absolute_grids_to_tables
from .table_adjacent_edit import (
    _local_name,
    _tc_plain_text,
    _iter_tbl_depth_first,
    _tr_children,
    _tc_children,
)

MAX_CELL_CHARS = 200


def _truncate(s: str) -> str:
    if not s:
        return ""
    return s if len(s) <= MAX_CELL_CHARS else s[: MAX_CELL_CHARS - 1] + "…"


def _has_t_node(tc: ET.Element) -> bool:
    for el in tc.iter():
        if _local_name(el.tag) == "t":
            return True
    return False


def _extract_section_grids(xml_bytes: bytes, section_path: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_bytes)
    out: list[dict[str, Any]] = []
    for ti, tbl in enumerate(_iter_tbl_depth_first(root)):
        rows = _tr_children(tbl)
        rows_grid: list[list[str]] = []
        rows_meta: list[list[dict[str, Any]]] = []
        for tr in rows:
            cells = _tc_children(tr)
            row_text: list[str] = []
            row_meta: list[dict[str, Any]] = []
            for tc in cells:
                text = _tc_plain_text(tc)
                row_text.append(_truncate(text))
                row_meta.append({"has_t": _has_t_node(tc)})
            rows_grid.append(row_text)
            rows_meta.append(row_meta)
        out.append({
            "table_index": ti,
            "row_count": len(rows_grid),
            "col_counts": [len(r) for r in rows_grid],
            "rows": rows_grid,
            "_cell_meta": rows_meta,
        })
    return out


def extract_table_grids_in_hwpx(hwpx_path: str) -> dict[str, Any]:
    if not os.path.isfile(hwpx_path):
        return {"ok": False, "error": f"파일 없음: {hwpx_path}"}
    if not zipfile.is_zipfile(hwpx_path):
        return {"ok": False, "error": "ZIP/HWPX 아님"}

    try:
        with zipfile.ZipFile(hwpx_path, "r") as zf:
            names = zf.namelist()
            sections = discover_section_members(names)
            sections_out: list[dict[str, Any]] = []
            for sp in sections:
                xml_bytes = zf.read(sp)
                tables = _extract_section_grids(xml_bytes, sp)
                try:
                    attach_absolute_grids_to_tables(tables, xml_bytes, section_path=sp)
                except (ET.ParseError, ValueError):
                    for t in tables:
                        t.setdefault("absolute_grid", {"grid_confidence": "degraded", "error": "absolute_grid_failed"})
                sections_out.append({
                    "section_path": sp,
                    "table_count": len(tables),
                    "tables": tables,
                })
        return {
            "ok": True,
            "format": "hwpx",
            "sections": sections_out,
        }
    except (ET.ParseError, ValueError, KeyError) as e:
        return {"ok": False, "error": str(e)}
