# -*- coding: utf-8 -*-
"""CLI: --extract-blocks 결과 요약 출력 (거대 JSON 대신 사람이 읽기 쉬운 형태)."""

from __future__ import annotations

from typing import Any


def print_extract_blocks_summary(grids: dict[str, Any], topology: dict[str, Any], *, preview_rows: int = 6, preview_cols: int = 10) -> None:
    print("=== extract-blocks 요약 ===")
    print(f"grids.ok={grids.get('ok')}  format={grids.get('format')}")
    n_tbl = 0
    for sec in grids.get("sections") or []:
        sp = sec.get("section_path")
        if sp is None and sec.get("section_index") is not None:
            sp = f"sec_index={sec.get('section_index')}"
        for t in sec.get("tables") or []:
            n_tbl += 1
            ti = t.get("table_index")
            rows = t.get("rows") or []
            nr = len(rows)
            nc = max((len(r) for r in rows), default=0)
            ag = t.get("absolute_grid") or {}
            gm = ag.get("grid_matrix") or []
            gc = ag.get("grid_confidence") or ""
            uid = len(ag.get("cells_by_id") or {})
            print(f"  표 #{ti} ({sp}): {nr}행 × {nc}열  unique_cell≈{uid}  grid={gc}")
            if gm:
                print(f"    [Markdown 토큰 미리보기 {min(preview_rows, len(gm))}행 × {min(preview_cols, max((len(r) for r in gm), default=0))}열]")
                id_to_short: dict[str, str] = {}
                n = 1
                for ri in range(min(preview_rows, len(gm))):
                    row = gm[ri]
                    parts = []
                    for ci in range(min(preview_cols, len(row))):
                        cid = row[ci] or ""
                        if not cid:
                            parts.append("")
                            continue
                        if cid not in id_to_short:
                            id_to_short[cid] = f"c{n}"
                            n += 1
                        parts.append(id_to_short[cid])
                    print("      | " + " | ".join(parts) + " |")

    print(f"topology.ok={topology.get('ok')}  blocks={len(topology.get('blocks') or [])}")
    for b in topology.get("blocks") or []:
        items = b.get("items") or []
        n_all = len(items)
        n_fill = sum(1 for it in items if isinstance(it, dict) and it.get("fillable", True))
        print(
            f"  블록 table_index={b.get('table_index')}  layout={b.get('layout')}  "
            f"토폴로지셀(전체)={n_all}  입력후보(fill)={n_fill}  grid_conf={b.get('grid_confidence')}"
        )
    print("=== 끝 (전체 JSON 은 --extract-blocks 만 사용) ===")
