# -*- coding: utf-8 -*-
"""
HWP 문서에서 표 그리드를 «순수 구조» 형태로 추출.

LLM 분류기에 넘기기 위한 입력 포맷.
- 셀 텍스트 그대로 (+ 위치 메타)
- 휴리스틱 분류 없음 (라벨/값 판정은 LLM 담당)
- 적용 단계에 필요한 PARA_TEXT/PARA_HEADER seqno 는 _meta 로만 보관(LLM 미노출)
"""

from __future__ import annotations

import os
from contextlib import closing
from typing import Any

from .paragraph_edit import _read_records
from .table_label_edit import (
    _TBL,
    _iter_table_cells_full,
    _parse_table_body_rowcols,
    _group_rows,
)

MAX_CELL_CHARS = 200


def _truncate(text: str) -> str:
    if not text:
        return ""
    if len(text) <= MAX_CELL_CHARS:
        return text
    return text[: MAX_CELL_CHARS - 1] + "…"


def extract_table_grids_in_file(hwp_path: str) -> dict[str, Any]:
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        return {"ok": False, "error": f"hwp5 라이브러리 없음: {e}"}

    if not os.path.isfile(hwp_path):
        return {"ok": False, "error": f"파일 없음: {hwp_path}"}

    try:
        with closing(Hwp5File(hwp_path)) as hwp:
            ver = hwp.header.version
            sec_indexes = list(hwp.text.section_indexes())
            sections_out: list[dict[str, Any]] = []

            for si in sec_indexes:
                dec = hwp.text.section(si).open().read()
                records = _read_records(dec)
                body_indices = [i for i, r in enumerate(records) if r["tagid"] == _TBL]
                tables: list[dict[str, Any]] = []
                for ti, body_i in enumerate(body_indices):
                    rowcols = _parse_table_body_rowcols(records[body_i], ver)
                    if not rowcols:
                        continue
                    flat_full = _iter_table_cells_full(records, body_i)
                    if sum(rowcols) != len(flat_full):
                        # 병합/파싱 불일치 시 한 줄로 뭉개면 LLM 입력이 완전히 왜곡됨.
                        # 셀 순서는 유지한 채 1열 N행으로 두어 텍스트 단위 추론만 가능하게 한다.
                        rows_grid = [[_truncate(c["text"])] for c in flat_full]
                        rows_meta = [[{
                            "first_pt": c["first_pt"],
                            "first_para_hdr": c["first_para_hdr"],
                        }] for c in flat_full]
                        col_counts_eff = [1] * len(rows_grid)
                        grid_integrity = "degraded_rowcol_mismatch"
                    else:
                        meta_pairs = [(c["text"], c) for c in flat_full]
                        grouped = _group_rows(meta_pairs, rowcols)
                        rows_grid = []
                        rows_meta = []
                        for row in grouped:
                            rows_grid.append([_truncate(t) for (t, _) in row])
                            rows_meta.append([
                                {"first_pt": c["first_pt"], "first_para_hdr": c["first_para_hdr"]}
                                for (_, c) in row
                            ])
                        col_counts_eff = rowcols
                        grid_integrity = "ok"

                    tables.append({
                        "table_index": ti,
                        "row_count": len(rows_grid),
                        "col_counts": col_counts_eff,
                        "rows": rows_grid,
                        "_cell_meta": rows_meta,  # 서버 보관, LLM 노출 금지
                        "grid_layout_integrity": grid_integrity,
                    })
                sections_out.append({
                    "section_index": si,
                    "table_count": len(tables),
                    "tables": tables,
                })

        return {
            "ok": True,
            "format": "hwp",
            "sections": sections_out,
        }

    except (InvalidHwp5FileError, ValueError, TypeError, IndexError) as e:
        return {"ok": False, "error": str(e)}
