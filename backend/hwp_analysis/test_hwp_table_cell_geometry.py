# -*- coding: utf-8 -*-
"""TableCell 기하 기반 absolute_grid (합성 데이터)."""

from __future__ import annotations

import struct

from hwp_analysis.hwp_grid_canonical import try_build_absolute_grid_from_table_cell_geometry
from hwp_analysis.table_label_edit import unpack_table_cell_list_header_payload


def test_geometry_two_row_colspan():
    rows_text = [
        ["업종", "", "종목", ""],
        ["사업장 주소", ""],
    ]
    grouped_rows = [
        [
            {"table_row": 0, "table_col": 0, "table_colspan": 1, "table_rowspan": 1, "text": "업종"},
            {"table_row": 0, "table_col": 1, "table_colspan": 1, "table_rowspan": 1, "text": ""},
            {"table_row": 0, "table_col": 2, "table_colspan": 1, "table_rowspan": 1, "text": "종목"},
            {"table_row": 0, "table_col": 3, "table_colspan": 1, "table_rowspan": 1, "text": ""},
        ],
        [
            {"table_row": 1, "table_col": 0, "table_colspan": 1, "table_rowspan": 1, "text": "사업장 주소"},
            {"table_row": 1, "table_col": 1, "table_colspan": 3, "table_rowspan": 1, "text": ""},
        ],
    ]
    g = try_build_absolute_grid_from_table_cell_geometry(
        section_index=0,
        table_index=0,
        rows_text=rows_text,
        grouped_rows=grouped_rows,
    )
    assert g is not None
    assert g["layout_basis"] == "hwp_table_cell"
    assert g["n_rows"] == 2 and g["n_cols"] == 4
    row1 = g["grid_matrix"][1]
    assert len(set(row1)) == 2
    wide_id = row1[3]
    assert row1[1] == wide_id and row1[2] == wide_id
    assert g["cells_by_id"][wide_id]["col_span"] == 3
    assert wide_id == "hwp:sec0:tbl0:r1c1"
    assert g["cells_by_id"]["hwp:sec0:tbl0:r0c0"]["anchor_abs_x"] == 0
    assert g["cells_by_id"]["hwp:sec0:tbl0:r1c1"]["apply_value_col"] == 1


def test_geometry_overlap_returns_none():
    rows_text = [["a", "b"]]
    grouped_rows = [
        [
            {"table_row": 0, "table_col": 0, "table_colspan": 2, "table_rowspan": 1},
            {"table_row": 0, "table_col": 1, "table_colspan": 1, "table_rowspan": 1},
        ]
    ]
    assert (
        try_build_absolute_grid_from_table_cell_geometry(
            section_index=0,
            table_index=0,
            rows_text=rows_text,
            grouped_rows=grouped_rows,
        )
        is None
    )


def test_unpack_table_cell_minimal_payload():
    buf = bytearray(40)
    struct.pack_into("<HHI", buf, 0, 1, 0, 0)
    struct.pack_into("<HHHHiiHHHHHi", buf, 8, 2, 3, 2, 1, 100, 50, 0, 0, 0, 0, 0, 0)
    g = unpack_table_cell_list_header_payload(bytes(buf))
    assert g is not None
    assert g["table_col"] == 2 and g["table_row"] == 3
    assert g["table_colspan"] == 2 and g["table_rowspan"] == 1


def test_unpack_zero_span_normalized():
    buf = bytearray(40)
    struct.pack_into("<HHI", buf, 0, 0, 0, 0)
    struct.pack_into("<HHHHiiHHHHHi", buf, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    g = unpack_table_cell_list_header_payload(bytes(buf))
    assert g["table_colspan"] == 1 and g["table_rowspan"] == 1
