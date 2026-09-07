#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""block_topology: grid_matrix 기반 items + fillable 회귀 (합성 absolute_grid)."""

from __future__ import annotations

import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    os.chdir(BACKEND)
    sys.path.insert(0, BACKEND)
    from hwpx_analysis.block_topology import _build_cell_candidates_from_grid

    ag = {
        "grid_matrix": [["c1", "c2"]],
        "cells_by_id": {
            "c1": {
                "text": "업체명",
                "anchor_abs_x": 0,
                "anchor_abs_y": 0,
                "row_span": 1,
                "col_span": 1,
                "neighbors": {"up": [], "down": [], "left": [], "right": []},
            },
            "c2": {
                "text": "",
                "anchor_abs_x": 1,
                "anchor_abs_y": 0,
                "row_span": 1,
                "col_span": 1,
                "neighbors": {"up": [], "down": [], "left": [], "right": []},
            },
        },
    }
    items = _build_cell_candidates_from_grid(ag)
    if len(items) != 2:
        print("FAIL: expected 2 items, got", len(items))
        return 1
    if items[0]["cell_id"] != "c1" or items[0]["label"] != "업체명" or items[0].get("fillable") is not False:
        print("FAIL: first item", items[0])
        return 1
    if items[1]["cell_id"] != "c2" or items[1]["label"] != "" or items[1].get("fillable") is not True:
        print("FAIL: second item", items[1])
        return 1
    n_fill = sum(1 for it in items if it.get("fillable"))
    if n_fill != 1:
        print("FAIL: fillable count", n_fill)
        return 1

    ag_mask = {
        "grid_matrix": [["m1", "m2"]],
        "cells_by_id": {
            "m1": {
                "text": "사업자등록번호",
                "anchor_abs_x": 0,
                "anchor_abs_y": 0,
                "row_span": 1,
                "col_span": 1,
                "neighbors": {"up": [], "down": [], "left": [], "right": []},
            },
            "m2": {
                "text": "000-00-000(         )",
                "anchor_abs_x": 1,
                "anchor_abs_y": 0,
                "row_span": 1,
                "col_span": 1,
                "neighbors": {"up": [], "down": [], "left": [], "right": []},
            },
        },
    }
    mask_items = _build_cell_candidates_from_grid(ag_mask)
    fill_mask = [it for it in mask_items if it.get("fillable")]
    if fill_mask:
        print("FAIL: mask sample should not be fillable", fill_mask)
        return 1

    # guide/header 셀도 fillable=True (label만 제외, LLM이 판단)
    ag_guide = {
        "grid_matrix": [["lab", "val"]],
        "cells_by_id": {
            "lab": {
                "text": "기업 소개",
                "anchor_abs_x": 0,
                "anchor_abs_y": 0,
                "row_span": 1,
                "col_span": 1,
                "neighbors": {"up": [], "down": [], "left": [], "right": ["val"]},
            },
            "val": {
                "text": "* 기업의 차별성·경쟁력 및 강점 등을 포함하여 기업 소개 (28자 이상 예시문)",
                "anchor_abs_x": 1,
                "anchor_abs_y": 0,
                "row_span": 1,
                "col_span": 4,
                "neighbors": {"up": [], "down": [], "left": ["lab"], "right": []},
            },
        },
    }
    guide_items = _build_cell_candidates_from_grid(ag_guide)
    lab_item = next(it for it in guide_items if it["cell_id"] == "lab")
    val_item = next(it for it in guide_items if it["cell_id"] == "val")
    if lab_item["fillable"]:
        print("FAIL: label should not be fillable", lab_item)
        return 1
    if not val_item["fillable"]:
        print("FAIL: 28+ char example text should be fillable (guide role, LLM decides)", val_item)
        return 1

    # header 셀(span>=3 + text)도 fillable
    ag_header = {
        "grid_matrix": [["hdr"]],
        "cells_by_id": {
            "hdr": {
                "text": "사업계획서",
                "anchor_abs_x": 0,
                "anchor_abs_y": 0,
                "row_span": 1,
                "col_span": 4,
                "neighbors": {"up": [], "down": [], "left": [], "right": []},
            },
        },
    }
    hdr_items = _build_cell_candidates_from_grid(ag_header)
    if not hdr_items[0]["fillable"]:
        print("FAIL: header should be fillable (LLM decides)", hdr_items[0])
        return 1

    print("OK: test_block_topology_grid_items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
