#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 1 게이트: 병합 없는 표에서 absolute_grid.rows_text 가 기존 rows 와 동일한지 검사.

  python3 scripts/phase1_gate.py
"""

from __future__ import annotations

import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    os.chdir(BACKEND)
    sys.path.insert(0, BACKEND)
    subprocess_run = __import__("subprocess").run
    subprocess_run([sys.executable, os.path.join(BACKEND, "fixtures", "hwpx", "build_fixtures.py")], check=True)

    from hwpx_analysis.extract_grids import extract_table_grids_in_hwpx

    simple = os.path.join(BACKEND, "fixtures", "hwpx", "simple.hwpx")
    r = extract_table_grids_in_hwpx(simple)
    if not r.get("ok"):
        print("FAIL: extract", r)
        return 1
    t0 = r["sections"][0]["tables"][0]
    rows = t0["rows"]
    ag = t0.get("absolute_grid") or {}
    rt = ag.get("rows_text")
    if rt != rows:
        print("FAIL: simple.hwpx rows != absolute_grid.rows_text")
        print("rows", rows)
        print("abs ", rt)
        return 1
    if ag.get("grid_confidence") != "high":
        print("FAIL: grid_confidence expected high for simple")
        return 1
    print("OK: phase1_gate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
