#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 1 게이트:
- 병합 없는 표에서 absolute_grid.rows_text 가 기존 rows 와 동일한지 검사
- canonical cell_id / grid_matrix 일관성 검사
- merged 샘플에서 cover 슬롯이 anchor cell_id 로 매핑되는지 검사

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
    merged = os.path.join(BACKEND, "fixtures", "hwpx", "merged.hwpx")
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
    gm = ag.get("grid_matrix") or []
    cbi = ag.get("cells_by_id") or {}
    if not gm or not cbi:
        print("FAIL: canonical grid (grid_matrix/cells_by_id) missing")
        return 1
    ids_in_matrix = {cid for row in gm for cid in row if cid}
    if not ids_in_matrix.issubset(set(cbi.keys())):
        print("FAIL: grid_matrix contains unknown cell_id")
        return 1
    for cid, c in cbi.items():
        ay = int(c.get("anchor_abs_y", -1))
        ax = int(c.get("anchor_abs_x", -1))
        if ay < 0 or ax < 0 or ay >= len(gm) or ax >= len(gm[ay]) or gm[ay][ax] != cid:
            print("FAIL: anchor position mismatch for", cid)
            return 1

    m = extract_table_grids_in_hwpx(merged)
    if not m.get("ok"):
        print("FAIL: extract merged", m)
        return 1
    mt = m["sections"][0]["tables"][0]
    mag = mt.get("absolute_grid") or {}
    mgm = mag.get("grid_matrix") or []
    mcells = mag.get("cells") or []
    if not mgm or not mcells:
        print("FAIL: merged canonical grid missing")
        return 1
    for y, row in enumerate(mcells):
        for x, cell in enumerate(row):
            if not cell.get("covered_by_merge"):
                continue
            cid = mgm[y][x] if y < len(mgm) and x < len(mgm[y]) else ""
            ay = int(cell.get("anchor_abs_y", -1))
            ax = int(cell.get("anchor_abs_x", -1))
            if not cid or ay < 0 or ax < 0 or ay >= len(mgm) or ax >= len(mgm[ay]):
                print("FAIL: cover slot mapping invalid")
                return 1
            if mgm[ay][ax] != cid:
                print("FAIL: cover slot not mapped to anchor cell_id")
                return 1
    print("OK: phase1_gate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
