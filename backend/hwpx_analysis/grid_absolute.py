# -*- coding: utf-8 -*-
"""
HWPX OWPML 표를 논리 격자(Absolute Grid)로 전개.

- ``hp:tc`` 의 colSpan/rowSpan (및 네임스페이스 변형) 지원.
- 병합으로 가려진 슬롯은 ``covered_by_merge`` 로 표시.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from .table_adjacent_edit import (
    _local_name,
    _tc_plain_text,
    _iter_tbl_depth_first,
    _tr_children,
    _tc_children,
)


def _parse_int_attr(el: ET.Element, *keys: str, default: int = 1) -> int:
    for k in keys:
        v = el.get(k)
        if v is not None and str(v).strip() != "":
            try:
                return max(1, int(v))
            except ValueError:
                continue
    for ak, av in el.attrib.items():
        ln = ak.split("}", 1)[-1] if ak.startswith("{") else ak
        if ln in keys:
            try:
                return max(1, int(av))
            except ValueError:
                continue
        lnl = ln.lower()
        for kk in keys:
            if lnl == kk.lower():
                try:
                    return max(1, int(av))
                except ValueError:
                    continue
    return default


def build_absolute_grid_for_tbl(tbl: ET.Element) -> dict[str, Any]:
    """단일 hp:tbl → 논리 격자."""
    rows_el = _tr_children(tbl)
    if not rows_el:
        return {
            "n_rows": 0,
            "n_cols": 0,
            "grid_confidence": "high",
            "cells": [],
            "rows_text": [],
        }

    # slot[r][c] = None | dict
    slot: list[list[Any]] = []
    degraded = False

    def ensure_cell(r: int, c: int) -> None:
        while len(slot) <= r:
            slot.append([])
        row = slot[r]
        while len(row) <= c:
            row.append(None)

    n_logical_cols = 0

    for ri, tr in enumerate(rows_el):
        ensure_cell(ri, 0)
        tcs = _tc_children(tr)
        ci = 0
        for tc in tcs:
            while True:
                ensure_cell(ri, ci)
                if slot[ri][ci] is None:
                    break
                ci += 1

            col_span = _parse_int_attr(tc, "colSpan", "colspan", "gridSpan", default=1)
            row_span = _parse_int_attr(tc, "rowSpan", "rowspan", default=1)
            text = _tc_plain_text(tc)
            has_t = any(_local_name(x.tag) == "t" for x in tc.iter())

            for dy in range(row_span):
                for dx in range(col_span):
                    r, c = ri + dy, ci + dx
                    ensure_cell(r, c)
                    if slot[r][c] is not None:
                        degraded = True
                        continue
                    if dy == 0 and dx == 0:
                        slot[r][c] = {
                            "kind": "anchor",
                            "tc": tc,
                            "text": text,
                            "has_t": has_t,
                            "col_span": col_span,
                            "row_span": row_span,
                        }
                    else:
                        slot[r][c] = {
                            "kind": "cover",
                            "anchor_y": ri,
                            "anchor_x": ci,
                        }
            ci += col_span
            n_logical_cols = max(n_logical_cols, ci)

        n_logical_cols = max(n_logical_cols, len(slot[ri]) if ri < len(slot) else 0)

    n_rows = len(slot)
    n_cols = 0
    for r in slot:
        n_cols = max(n_cols, len(r))

    # 정방형 확장 (trailing None)
    for r in range(n_rows):
        ensure_cell(r, max(n_cols - 1, 0))
        n_cols = max(n_cols, len(slot[r]))

    grid_meta: list[list[dict[str, Any]]] = []
    grid_text: list[list[str]] = []

    for r in range(n_rows):
        row_m: list[dict[str, Any]] = []
        row_txt: list[str] = []
        width = max(n_cols, len(slot[r]) if r < len(slot) else 0)
        for c in range(width):
            if r >= len(slot) or c >= len(slot[r]):
                row_txt.append("")
                row_m.append({
                    "text": "",
                    "abs_x": c,
                    "abs_y": r,
                    "covered_by_merge": False,
                    "anchor_abs_x": c,
                    "anchor_abs_y": r,
                    "col_span": 1,
                    "row_span": 1,
                    "has_t": False,
                    "hole": True,
                })
                degraded = True
                continue

            cell = slot[r][c]
            if cell is None:
                row_txt.append("")
                row_m.append({
                    "text": "",
                    "abs_x": c,
                    "abs_y": r,
                    "covered_by_merge": False,
                    "anchor_abs_x": c,
                    "anchor_abs_y": r,
                    "col_span": 1,
                    "row_span": 1,
                    "has_t": False,
                    "hole": True,
                })
                degraded = True
                continue

            if cell["kind"] == "anchor":
                tc_el = cell["tc"]
                txt = cell["text"]
                cs = cell["col_span"]
                rs = cell["row_span"]
                row_txt.append(txt)
                row_m.append({
                    "text": txt,
                    "abs_x": c,
                    "abs_y": r,
                    "covered_by_merge": False,
                    "anchor_abs_x": c,
                    "anchor_abs_y": r,
                    "col_span": cs,
                    "row_span": rs,
                    "has_t": cell["has_t"],
                })
            else:
                ay, ax = cell["anchor_y"], cell["anchor_x"]
                row_txt.append("")
                row_m.append({
                    "text": "",
                    "abs_x": c,
                    "abs_y": r,
                    "covered_by_merge": True,
                    "anchor_abs_x": ax,
                    "anchor_abs_y": ay,
                    "col_span": 1,
                    "row_span": 1,
                    "has_t": False,
                })
        grid_text.append(row_txt)
        grid_meta.append(row_m)

    conf = "degraded" if degraded else "high"
    return {
        "n_rows": len(grid_text),
        "n_cols": max((len(x) for x in grid_text), default=0),
        "grid_confidence": conf,
        "cells": grid_meta,
        "rows_text": grid_text,
    }


def attach_absolute_grids_to_tables(section_tables: list[dict[str, Any]], xml_bytes: bytes) -> None:
    """in-place: 각 table dict 에 absolute_grid 필드 추가 (Element는 직렬화 불가 → 메타만)."""
    root = ET.fromstring(xml_bytes)
    tbls = list(_iter_tbl_depth_first(root))
    for i, tdict in enumerate(section_tables):
        if i >= len(tbls):
            continue
        ag = build_absolute_grid_for_tbl(tbls[i])
        # cells 에 ET 참조 제거 — JSON 안전
        clean_cells: list[list[dict[str, Any]]] = []
        for row in ag.get("cells", []):
            clean_row: list[dict[str, Any]] = []
            for cell in row:
                d = {k: v for k, v in cell.items() if k != "tc"}
                clean_row.append(d)
            clean_cells.append(clean_row)
        ag_out = {**ag, "cells": clean_cells}
        tdict["absolute_grid"] = ag_out

