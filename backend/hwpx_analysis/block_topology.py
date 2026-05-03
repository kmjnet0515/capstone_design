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


def _pairwise_slots_from_grid(rows_text: list[list[str]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for abs_y, row in enumerate(rows_text):
        ci = 0
        while ci < len(row) - 1:
            left = row[ci]
            right = row[ci + 1]
            if _is_label_candidate(left) and _is_value_empty(right):
                items.append({
                    "label": _norm_label(left),
                    "abs_x": ci + 1,
                    "abs_y": abs_y,
                    "label_abs_x": ci,
                    "label_abs_y": abs_y,
                    "value_preview": (right or "").strip(),
                    "kind": "pairwise",
                })
                ci += 2
            else:
                ci += 1
    return items


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
            rows_text = ag.get("rows_text") or tbl.get("rows") or []
            conf = ag.get("grid_confidence") or "unknown"
            bid = stable_block_id(sp, ti)

            items = _pairwise_slots_from_grid(rows_text)
            layout = "pairwise"
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
