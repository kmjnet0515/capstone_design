#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 0: HWPX 픽스처에 대해 extract_table_grids / list_fillable_cells 회귀 검증.

사용 (backend 디렉터리):
  python3 scripts/phase0_regression.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(BACKEND, "fixtures", "hwpx")
EXPECTED_DIR = os.path.join(FIXTURES, "expected")


def _load_json(name: str) -> dict:
    path = os.path.join(EXPECTED_DIR, name)
    with open(path, encoding="utf-8") as fp:
        return json.load(fp)


def _summarize_grids(result: dict) -> dict:
    """안정적인 부분만 추려 비교 (경로 제외)."""
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error")}
    out_sections = []
    for sec in result.get("sections") or []:
        tabs = []
        for t in sec.get("tables") or []:
            ag = t.get("absolute_grid") or {}
            tabs.append({
                "table_index": t.get("table_index"),
                "rows": t.get("rows"),
                "col_counts": t.get("col_counts"),
                "n_rows": ag.get("n_rows"),
                "n_cols": ag.get("n_cols"),
                "grid_confidence": ag.get("grid_confidence"),
                "rows_text": ag.get("rows_text"),
            })
        out_sections.append({"tables": tabs})
    return {"ok": True, "format": result.get("format"), "sections": out_sections}


def main() -> int:
    os.chdir(BACKEND)
    sys.path.insert(0, BACKEND)

    build_py = os.path.join(FIXTURES, "build_fixtures.py")
    subprocess.run([sys.executable, build_py], check=True)

    from hwpx_analysis.extract_grids import extract_table_grids_in_hwpx
    from hwpx_analysis.list_fillable_cells import list_fillable_cells_in_hwpx

    cases = ["simple", "merged"]
    for name in cases:
        hwpx = os.path.join(FIXTURES, f"{name}.hwpx")
        if not os.path.isfile(hwpx):
            print("FAIL: missing", hwpx)
            return 1
        got = extract_table_grids_in_hwpx(hwpx)
        exp = _load_json(f"{name}_grids_expected.json")
        g = _summarize_grids(got)
        if g != exp:
            print(f"FAIL: {name} grids mismatch")
            print("expected:", json.dumps(exp, ensure_ascii=False, indent=2))
            print("got     :", json.dumps(g, ensure_ascii=False, indent=2))
            return 1
        fill = list_fillable_cells_in_hwpx(hwpx)
        exp_f = _load_json(f"{name}_fillable_expected.json")
        # fillable: fields 수와 첫 항목 라벨만 엄격 비교
        if (fill.get("ok") != exp_f.get("ok")
                or len((fill.get("fields") or [])) != len((exp_f.get("fields") or []))):
            print(f"FAIL: {name} fillable count or ok")
            print("got", fill)
            return 1
        for i, (a, b) in enumerate(zip(fill.get("fields") or [], exp_f.get("fields") or [])):
            if a.get("label_text") != b.get("label_text") or a.get("value_col") != b.get("value_col"):
                print(f"FAIL: {name} fillable field {i}")
                return 1

    print("OK: phase0_regression")
    return 0


if __name__ == "__main__":
    sys.exit(main())
