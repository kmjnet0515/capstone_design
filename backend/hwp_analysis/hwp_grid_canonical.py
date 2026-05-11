# -*- coding: utf-8 -*-
"""
직사각형 rows_text 기반 canonical grid (HWP).

- 우선: LIST_HEADER(TableCell) 의 col,row,colspan,rowspan 이 있으면 그걸로 격자를 채운다(오른쪽 패딩 유령 최소화).
- 보조: TableCell 기하 실패 시 rows_text 만으로 직사각형 패딩.
- 예외: 한 행에 물리 셀이 1개뿐인데 표 전체 열 수보다 좁을 때(제목 한 줄이 전체 폭을 덮는 형태),
  가로 병합 1칸으로 취급해 동일 cell_id·col_span 을 부여한다.
"""

from __future__ import annotations

import re
from typing import Any

from .hwp_cell_id import make_hwp_cell_id

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


def _is_guide_like(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    if len(s) >= 28:
        return True
    return bool(re.search(r"(유의|안내|참고|작성|기재|확인|선택)", s))


def try_build_absolute_grid_from_table_cell_geometry(
    *,
    section_index: int,
    table_index: int,
    rows_text: list[list[str]],
    grouped_rows: list[list[dict[str, Any]]],
) -> dict[str, Any] | None:
    """
    TableCell 의 (table_row, table_col, table_colspan, table_rowspan) 로 점유 격자를 채운다.
    grouped_rows[i][j] 는 rows_text[i][j] 와 같은 셀 순서여야 한다.
    실패 시 None (호출측에서 build_absolute_grid_hwp 로 폴백).
    """
    if len(grouped_rows) != len(rows_text):
        return None
    cells_flat: list[tuple[int, int, dict[str, Any]]] = []
    for gi, row in enumerate(grouped_rows):
        if len(row) != len(rows_text[gi]):
            return None
        for j, d in enumerate(row):
            if (
                d.get("table_col") is None
                or d.get("table_row") is None
                or d.get("table_colspan") is None
                or d.get("table_rowspan") is None
            ):
                return None
            cells_flat.append((gi, j, d))

    n_rows = 0
    n_cols = 0
    for _gi, _j, d in cells_flat:
        tr = int(d["table_row"])
        tc = int(d["table_col"])
        rs = max(1, int(d["table_rowspan"]))
        cs = max(1, int(d["table_colspan"]))
        n_rows = max(n_rows, tr + rs)
        n_cols = max(n_cols, tc + cs)

    if n_rows <= 0 or n_cols <= 0:
        return None
    if n_rows != len(rows_text):
        return None

    grid_matrix: list[list[str | None]] = [
        [None] * n_cols for _ in range(n_rows)
    ]
    cells_by_id: dict[str, dict[str, Any]] = {}

    for gi, j, d in sorted(cells_flat, key=lambda t: (int(t[2]["table_row"]), int(t[2]["table_col"]))):
        tr = int(d["table_row"])
        tc = int(d["table_col"])
        rs = max(1, int(d["table_rowspan"]))
        cs = max(1, int(d["table_colspan"]))
        # cell_id 의 r,c 는 «그룹된 행 인덱스·행 안 셀 인덱스» (apply / parse_hwp_cell_id 와 일치).
        # 논리 격자 좌표(table_row/table_col)는 anchor_abs_* / col_span 에만 둔다.
        cid = make_hwp_cell_id(section_index, table_index, gi, j)
        for dr in range(rs):
            for dc in range(cs):
                yy, xx = tr + dr, tc + dc
                if yy >= n_rows or xx >= n_cols:
                    return None
                cur = grid_matrix[yy][xx]
                if cur is not None and cur != cid:
                    return None
                grid_matrix[yy][xx] = cid
        if cid not in cells_by_id:
            tw = d.get("table_width")
            th = d.get("table_height")
            cell_entry: dict[str, Any] = {
                "cell_id": cid,
                "anchor_abs_x": tc,
                "anchor_abs_y": tr,
                "row_span": rs,
                "col_span": cs,
                "apply_row_index": gi,
                "apply_value_col": j,
                "text": rows_text[gi][j],
                "role_hint": _guess_role(rows_text[gi][j], cs, rs),
                "neighbors": {"up": [], "down": [], "left": [], "right": []},
            }
            if isinstance(tw, int):
                cell_entry["width_hwpu"] = tw
            if isinstance(th, int):
                cell_entry["height_hwpu"] = th
            cells_by_id[cid] = cell_entry

    for r in range(n_rows):
        for c in range(n_cols):
            if grid_matrix[r][c] is None:
                return None

    grid_matrix_str: list[list[str]] = [
        [str(grid_matrix[r][c]) for c in range(n_cols)] for r in range(n_rows)
    ]

    for r in range(n_rows):
        for c in range(n_cols):
            cid = grid_matrix_str[r][c]
            cell = cells_by_id[cid]
            for dr, dc, side in [(-1, 0, "up"), (1, 0, "down"), (0, -1, "left"), (0, 1, "right")]:
                rr, cc = r + dr, c + dc
                if rr < 0 or cc < 0 or rr >= n_rows or cc >= n_cols:
                    continue
                nid = grid_matrix_str[rr][cc]
                if nid != cid and nid not in cell["neighbors"][side]:
                    cell["neighbors"][side].append(nid)

    return {
        "n_rows": n_rows,
        "n_cols": n_cols,
        "grid_confidence": "high",
        "layout_basis": "hwp_table_cell",
        "rows_text": rows_text,
        "grid_matrix": grid_matrix_str,
        "cells_by_id": cells_by_id,
        "cells": [],
    }


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


def build_absolute_grid_hwp(
    *,
    section_index: int,
    table_index: int,
    rows_text: list[list[str]],
) -> dict[str, Any]:
    n_rows = len(rows_text)
    n_cols = max((len(r) for r in rows_text), default=0)
    grid_matrix: list[list[str]] = []
    cells_by_id: dict[str, dict[str, Any]] = {}

    for r, row in enumerate(rows_text):
        row_ids: list[str] = []
        if len(row) == 1 and n_cols > 1:
            cid = make_hwp_cell_id(section_index, table_index, r, 0)
            for _ in range(n_cols):
                row_ids.append(cid)
            if cid not in cells_by_id:
                span_w = n_cols
                cells_by_id[cid] = {
                    "cell_id": cid,
                    "anchor_abs_x": 0,
                    "anchor_abs_y": r,
                    "row_span": 1,
                    "col_span": span_w,
                    "text": row[0] or "",
                    "role_hint": _guess_role(row[0] or "", span_w, 1),
                    "neighbors": {"up": [], "down": [], "left": [], "right": []},
                }
            grid_matrix.append(row_ids)
            continue

        pad = row + [""] * max(0, n_cols - len(row))
        for c in range(n_cols):
            txt = pad[c] if c < len(pad) else ""
            cid = make_hwp_cell_id(section_index, table_index, r, c)
            row_ids.append(cid)
            if cid not in cells_by_id:
                cells_by_id[cid] = {
                    "cell_id": cid,
                    "anchor_abs_x": c,
                    "anchor_abs_y": r,
                    "row_span": 1,
                    "col_span": 1,
                    "text": txt,
                    "role_hint": _guess_role(txt, 1, 1),
                    "neighbors": {"up": [], "down": [], "left": [], "right": []},
                }
        grid_matrix.append(row_ids)

    for r in range(n_rows):
        for c in range(n_cols):
            cid = grid_matrix[r][c]
            cell = cells_by_id[cid]
            for dr, dc, side in [(-1, 0, "up"), (1, 0, "down"), (0, -1, "left"), (0, 1, "right")]:
                rr, cc = r + dr, c + dc
                if rr < 0 or cc < 0 or rr >= n_rows or cc >= n_cols:
                    continue
                nid = grid_matrix[rr][cc]
                if nid != cid and nid not in cell["neighbors"][side]:
                    cell["neighbors"][side].append(nid)

    return {
        "n_rows": n_rows,
        "n_cols": n_cols,
        "grid_confidence": "high",
        "layout_basis": "row_padded",
        "rows_text": rows_text,
        "grid_matrix": grid_matrix,
        "cells_by_id": cells_by_id,
        "cells": [],
    }
