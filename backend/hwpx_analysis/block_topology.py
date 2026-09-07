# -*- coding: utf-8 -*-
"""
표 절대 격자(Phase 1) 위에서 블록·입력 슬롯 후보를 만든다 (LLM 없음).

게이트 실패 시 폴백: 표당 단일 블록(table_singleton), 슬롯은 pairwise 없으면 빈 배열.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

_LABEL_TRAIL = re.compile(r"[:：\s]+$")
_PLACEHOLDER_RE = re.compile(r"^[\s_\-\.·•\(\)\[\]▷▶■□◆◇★☆※]+$")
_HAS_LETTER = re.compile(r"[가-힣A-Za-z]")
# 명백한 사업자번호 더미·이름 마스크(○만) — LLM 전 얇은 안전망
_BIZ_MASK_DUMMY = re.compile(r"000[-－.]?00[-－.]?000", re.I)
_OOO_MASK_DUMMY = re.compile(r"ooo[-－.]?oo[-－.]?ooo", re.I)


def _looks_like_mask_or_sample(text: str) -> bool:
    """사업자번호 형 더미·○○○ 성명 등. 휴리스틱 최소: 패턴이 명백할 때만 True."""
    s = (text or "").strip()
    if not s:
        return False
    compact = re.sub(r"[\s　]+", "", s)
    if _BIZ_MASK_DUMMY.search(compact) or _OOO_MASK_DUMMY.search(compact):
        return True
    core = re.sub(r"[\s_·.\-]+", "", s)
    if len(core) >= 2 and re.fullmatch(r"[○〇]+", core):
        return True
    return False


def _norm_label(s: str) -> str:
    return _LABEL_TRAIL.sub("", (s or "").strip())


def _is_label_candidate(text: str) -> bool:
    s = _norm_label(text)
    if not s or len(s) > 40:
        return False
    if _PLACEHOLDER_RE.match(s):
        return False
    if not _HAS_LETTER.search(s):
        return False
    return True


def _is_value_empty(text: str) -> bool:
    s = (text or "").strip()
    if not s or _PLACEHOLDER_RE.match(s):
        return True
    return False


def stable_block_id(section_path: str, table_index: int) -> str:
    raw = f"{section_path}#{table_index}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def _is_guide_like(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    if len(s) >= 28:
        return True
    return bool(re.search(r"(유의|안내|참고|작성|기재|확인|선택)", s))


def _guess_role(text: str, span_w: int, span_h: int) -> str:
    s = (text or "").strip()
    if _is_guide_like(s):
        return "guide"
    if span_w >= 3 and span_h >= 1 and len(s) > 0:
        return "header"
    if _is_label_candidate(s):
        return "label"
    if _is_value_empty(s):
        return "value"
    return "value"


def _build_cell_candidates_from_grid(ag: dict[str, Any]) -> list[dict[str, Any]]:
    """
    grid_matrix 를 행 우선으로 순회해 고유 cell_id 마다 한 항목씩 만든다.
    - label: 해당 셀의 text (Grid-First 정의 줄에 그대로 사용)
    - fillable: label 전용 셀만 False, 나머지(guide/header/value)는 True → LLM이 판단
    """
    cells_by_id = ag.get("cells_by_id") or {}
    grid_matrix = ag.get("grid_matrix") or []
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    for row in grid_matrix:
        if not isinstance(row, (list, tuple)):
            continue
        for cell_id in row:
            if not cell_id or not isinstance(cell_id, str):
                continue
            if cell_id in seen:
                continue
            seen.add(cell_id)
            c = cells_by_id.get(cell_id)
            if not c:
                continue
            text = (c.get("text") or "").strip()
            cs = int(c.get("col_span", 1))
            rs = int(c.get("row_span", 1))
            role = _guess_role(text, cs, rs)
            fillable = role != "label" and not _looks_like_mask_or_sample(text)
            out.append({
                "cell_id": cell_id,
                "label": text,
                "abs_x": int(c.get("anchor_abs_x", 0)),
                "abs_y": int(c.get("anchor_abs_y", 0)),
                "role_hint": role,
                "row_span": rs,
                "col_span": cs,
                "neighbors": c.get("neighbors") or {"up": [], "down": [], "left": [], "right": []},
                "fillable": fillable,
            })
    return out


def build_document_topology(extract_result: dict[str, Any]) -> dict[str, Any]:
    """
    extract_table_grids_in_hwpx 의 결과(JSON-serializable)를 입력으로 받는다.
    """
    if not extract_result.get("ok"):
        return {"ok": False, "error": extract_result.get("error"), "blocks": []}

    blocks: list[dict[str, Any]] = []
    for sec in extract_result.get("sections") or []:
        sp = sec.get("section_path") or ""
        for tbl in sec.get("tables") or []:
            ti = int(tbl.get("table_index", 0))
            ag = tbl.get("absolute_grid") or {}
            conf = ag.get("grid_confidence") or "unknown"
            bid = stable_block_id(sp, ti)
            grid_matrix = ag.get("grid_matrix") or []
            cells_by_id = ag.get("cells_by_id") or {}

            items = _build_cell_candidates_from_grid(ag)
            layout = "cell_graph"
            if not items:
                layout = "table_singleton"
                items = []

            blocks.append({
                "block_id": bid,
                "section_path": sp,
                "table_index": ti,
                "layout": layout,
                "grid_confidence": conf,
                "parent_label": None,
                "grid_matrix": grid_matrix,
                "cells_by_id": cells_by_id,
                "items": items,
            })

    return {
        "ok": True,
        "format": extract_result.get("format"),
        "blocks": blocks,
    }


def apply_minimal_block_fallback(topology: dict[str, Any]) -> dict[str, Any]:
    """게이트 실패 시: 각 블록을 table_singleton 으로 표시하고 items 비움."""
    if not topology.get("ok"):
        return topology
    out = []
    for b in topology.get("blocks") or []:
        out.append({
            **b,
            "layout": "table_singleton",
            "items": [],
            "fallback": "minimal",
        })
    return {**topology, "blocks": out}
