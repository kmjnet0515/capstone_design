# -*- coding: utf-8 -*-
"""HWP canonical cell_id: hwp:sec{S}:tbl{T}:r{Y}c{X}

- r, Y: 표 내 «그룹된 행 인덱스» (TableBody rowcols 순서, edit_table_value_at_position 의 row_index).
- c, X: 그 행에서 «몇 번째 셀(0..)»인지 (LIST_HEADER 스트림 순서, edit 의 value_col).

layout_basis=hwp_table_cell 일 때도 동일 규칙이다. HWP TableCell 의 논리 (table_row, table_col) 은
cells_by_id 의 anchor_abs_y / anchor_abs_x 등으로만 보관한다.
"""

from __future__ import annotations

import re
from typing import Any

_CELL_RE = re.compile(r"^hwp:sec(\d+):tbl(\d+):r(\d+)c(\d+)$")


def make_hwp_cell_id(section_index: int, table_index: int, row_index: int, col_index: int) -> str:
    return f"hwp:sec{int(section_index)}:tbl{int(table_index)}:r{int(row_index)}c{int(col_index)}"


def parse_hwp_cell_id(cell_id: str) -> tuple[int, int, int, int] | None:
    m = _CELL_RE.match((cell_id or "").strip())
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))


def section_path_for_index(section_index: int) -> str:
    return f"hwp:sec{int(section_index)}"
