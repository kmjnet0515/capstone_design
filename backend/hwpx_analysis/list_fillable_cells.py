# -*- coding: utf-8 -*-
"""
HWPX 패키지 안 ``hp:tbl`` 표에서 «라벨 → 인접 빈 값 셀» 후보를 JSON 으로 출력.
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

from .opc_manifest import discover_section_members
from .table_adjacent_edit import (
    _local_name,
    _tc_plain_text,
    _iter_tbl_depth_first,
    _tr_children,
    _tc_children,
)


_PLACEHOLDER_RE = re.compile(r"^[\s_\-\.·•\(\)\[\]▷▶■□◆◇★☆※]+$")
_LABEL_TRAILING_RE = re.compile(r"[:：\s]+$")
_HAS_LETTER_RE = re.compile(r"[가-힣A-Za-z]")

_UNIT_TOKENS = (
    "원", "백만원", "만원", "천원", "억원",
    "명", "인", "건", "회", "개", "대", "장", "권", "부", "병", "박스",
    "년", "월", "일", "시간", "분", "초", "주", "년차",
    "%", "퍼센트", "kg", "g", "톤", "L", "ml", "m", "cm", "mm", "km",
)
_UNIT_RE = re.compile(r"^(" + "|".join(re.escape(u) for u in _UNIT_TOKENS) + r")$")
_PAREN_HINT_RE = re.compile(r"^\(.{0,120}\)$", re.DOTALL)
_PAREN_FULL_RE = re.compile(r"\([^()]{0,120}\)", re.DOTALL)
_HINT_LEAD_SYMBOLS = ("※", "*", "▶", "▷", "■", "□", "◆", "◇", "★", "☆")


def _looks_like_hint_text(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    if s.startswith(_HINT_LEAD_SYMBOLS):
        return True
    if s.startswith("(") and s.endswith(")") and len(s) <= 200:
        return True
    return False
_SHORT_INSTRUCTION_RE = re.compile(r"^(작성|기재|선택|입력|예시|예|샘플)$")


def _looks_like_unit_or_hint(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    if _UNIT_RE.match(s):
        return True
    if _PAREN_HINT_RE.match(s):
        return True
    if _SHORT_INSTRUCTION_RE.match(s):
        return True
    s_no_paren = _PAREN_FULL_RE.sub(" ", s).strip()
    if s_no_paren == "":
        return True
    parts = re.split(r"[\s\u3000]+", s_no_paren)
    has_unit_or_hint = False
    for p in parts:
        if not p:
            continue
        if _UNIT_RE.match(p) or _SHORT_INSTRUCTION_RE.match(p):
            has_unit_or_hint = True
            continue
        if _PLACEHOLDER_RE.match(p):
            continue
        return False
    return has_unit_or_hint


def _is_value_empty_or_hint(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return True
    if _PLACEHOLDER_RE.match(s):
        return True
    if _looks_like_unit_or_hint(s):
        return True
    if _looks_like_hint_text(s):
        return True
    return False


def _is_label_candidate(text: str) -> bool:
    s = _LABEL_TRAILING_RE.sub("", (text or "").strip())
    if not s or len(s) > 40 or _PLACEHOLDER_RE.match(s):
        return False
    if not _HAS_LETTER_RE.search(s):
        return False
    if _looks_like_unit_or_hint(s):
        return False
    if _looks_like_hint_text(s):
        return False
    return True


def _normalize_label(text: str) -> str:
    return _LABEL_TRAILING_RE.sub("", (text or "").strip())


def _detect_transposed_layout_xml(rows: list[ET.Element]) -> bool:
    if len(rows) < 3:
        return False
    header_cells = _tc_children(rows[0])
    if len(header_cells) < 2:
        return False
    header_labels = [_normalize_label(_tc_plain_text(c)) for c in header_cells]
    if not all(_is_label_candidate(h) for h in header_labels[1:]):
        return False
    label_col = []
    for tr in rows[1:]:
        cells = _tc_children(tr)
        label_col.append(_normalize_label(_tc_plain_text(cells[0])) if cells else "")
    label_like = sum(1 for s in label_col if _is_label_candidate(s))
    return label_like >= max(1, len(label_col) // 2)


def _is_subsection_header_row_xml(cells: list[ET.Element]) -> bool:
    if len(cells) < 3:
        return False
    labels = [_normalize_label(_tc_plain_text(c)) for c in cells]
    return all(_is_label_candidate(s) for s in labels)


def _section_fields(xml_bytes: bytes, section_path: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_bytes)
    out: list[dict[str, Any]] = []
    for ti, tbl in enumerate(_iter_tbl_depth_first(root)):
        rows = _tr_children(tbl)

        if _detect_transposed_layout_xml(rows):
            header_cells = _tc_children(rows[0])
            headers = [_normalize_label(_tc_plain_text(c)) for c in header_cells]
            for ri in range(1, len(rows)):
                cells = _tc_children(rows[ri])
                if not cells:
                    continue
                row_label = _normalize_label(_tc_plain_text(cells[0]))
                if not _is_label_candidate(row_label):
                    continue
                for ci in range(1, len(cells)):
                    val_text = _tc_plain_text(cells[ci])
                    if not _is_value_empty_or_hint(val_text):
                        continue
                    col_header = headers[ci] if ci < len(headers) else f"col{ci}"
                    out.append({
                        "section_path": section_path,
                        "table_index": ti,
                        "row_index": ri,
                        "label_col": 0,
                        "value_col": ci,
                        "label_text": row_label,
                        "composed_label": f"{col_header} {row_label}".strip(),
                        "header_label": col_header,
                        "value_preview": (val_text or "").strip(),
                        "kind": "table_transposed",
                    })
            continue

        used_rows: set[int] = set()
        n = len(rows)
        i = 0
        while i < n:
            cells_i = _tc_children(rows[i])
            if _is_subsection_header_row_xml(cells_i):
                headers = [_normalize_label(_tc_plain_text(c)) for c in cells_i]
                j = i + 1
                data_rows: list[int] = []
                while j < n and not _is_subsection_header_row_xml(_tc_children(rows[j])):
                    drow_cells = _tc_children(rows[j])
                    if drow_cells:
                        first_label = _normalize_label(_tc_plain_text(drow_cells[0]))
                        if _is_label_candidate(first_label):
                            data_rows.append(j)
                    j += 1
                if len(data_rows) >= 2:
                    for ri in data_rows:
                        drow_cells = _tc_children(rows[ri])
                        row_label = _normalize_label(_tc_plain_text(drow_cells[0]))
                        for ci in range(1, len(drow_cells)):
                            val_text = _tc_plain_text(drow_cells[ci])
                            if not _is_value_empty_or_hint(val_text):
                                continue
                            col_header = headers[ci] if ci < len(headers) else f"col{ci}"
                            out.append({
                                "section_path": section_path,
                                "table_index": ti,
                                "row_index": ri,
                                "label_col": 0,
                                "value_col": ci,
                                "label_text": row_label,
                                "composed_label": f"{col_header} {row_label}".strip(),
                                "header_label": col_header,
                                "value_preview": (val_text or "").strip(),
                                "kind": "table_transposed",
                            })
                        used_rows.add(ri)
                    used_rows.add(i)
                    i = j
                    continue
            i += 1

        n_rows = len(rows)
        ri = 0
        while ri < n_rows - 1:
            if ri in used_rows or (ri + 1) in used_rows:
                ri += 1
                continue
            cur_cells = _tc_children(rows[ri])
            nxt_cells = _tc_children(rows[ri + 1])
            if len(cur_cells) == 1 and nxt_cells:
                label = _normalize_label(_tc_plain_text(cur_cells[0]))
                if (
                    _is_label_candidate(label)
                    and len(label) <= 20
                    and not any(
                        _is_label_candidate(_normalize_label(_tc_plain_text(c))) for c in nxt_cells
                    )
                ):
                    candidates = []
                    for ci, cell in enumerate(nxt_cells):
                        val_text = _tc_plain_text(cell)
                        if _is_value_empty_or_hint(val_text):
                            candidates.append((ci, val_text))
                    if candidates:
                        for k, (ci, val_text) in enumerate(candidates):
                            composed = label if len(candidates) == 1 else f"{label} ({k + 1})"
                            out.append({
                                "section_path": section_path,
                                "table_index": ti,
                                "row_index": ri + 1,
                                "label_col": 0,
                                "value_col": ci,
                                "label_text": label,
                                "composed_label": composed if composed != label else None,
                                "value_preview": (val_text or "").strip(),
                                "kind": "table_label_vertical",
                            })
                        used_rows.add(ri)
                        used_rows.add(ri + 1)
                        ri += 2
                        continue
            ri += 1

        for ri, tr in enumerate(rows):
            if ri in used_rows:
                continue
            cells = _tc_children(tr)
            ci = 0
            while ci < len(cells) - 1:
                label_text = _tc_plain_text(cells[ci])
                value_text = _tc_plain_text(cells[ci + 1])
                if (
                    _is_label_candidate(label_text)
                    and _is_value_empty_or_hint(value_text)
                ):
                    out.append({
                        "section_path": section_path,
                        "table_index": ti,
                        "row_index": ri,
                        "label_col": ci,
                        "value_col": ci + 1,
                        "label_text": _normalize_label(label_text),
                        "value_preview": (value_text or "").strip(),
                        "kind": "table_label",
                    })
                    ci += 2
                else:
                    ci += 1
    return out


def list_fillable_cells_in_hwpx(hwpx_path: str) -> dict[str, Any]:
    path = os.path.abspath(hwpx_path)
    if not zipfile.is_zipfile(path):
        return {"ok": False, "error": "ZIP 아님"}

    out_fields: list[dict[str, Any]] = []
    sections_summary: list[dict[str, Any]] = []

    with zipfile.ZipFile(path, "r") as zf:
        names = zf.namelist()
        sections = discover_section_members(names)
        for sec in sections:
            try:
                raw = zf.read(sec)
                fields = _section_fields(raw, sec)
            except Exception as exc:
                sections_summary.append({"section_path": sec, "ok": False, "error": str(exc)})
                continue
            sections_summary.append({
                "section_path": sec,
                "ok": True,
                "fillable_count": len(fields),
            })
            out_fields.extend(fields)

    return {
        "ok": True,
        "format": "hwpx",
        "path": path,
        "sections": sections_summary,
        "fields": out_fields,
    }
