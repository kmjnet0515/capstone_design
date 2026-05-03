# -*- coding: utf-8 -*-
"""HWPX CLI: 분석·언팩·텍스트 치환·재패키지."""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
from typing import Any

from .edit_package import apply_text_replacements
from .table_adjacent_edit import edit_hwpx_table_value_by_label
from .table_adjacent_edit import edit_hwpx_table_value_at_position
from .table_adjacent_edit import edit_hwpx_table_value_absolute
from .engine import analyze_document
from .package_zip import list_package_index
from .list_fillable_cells import list_fillable_cells_in_hwpx
from .extract_grids import extract_table_grids_in_hwpx
from .block_topology import build_document_topology


def _unpack(hwpx_path: str, out_dir: str) -> dict[str, Any]:
    path = os.path.abspath(hwpx_path)
    od = os.path.abspath(out_dir)
    if not zipfile.is_zipfile(path):
        return {"ok": False, "error": "ZIP 아님"}
    os.makedirs(od, exist_ok=True)
    n = 0
    with zipfile.ZipFile(path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            dest = os.path.join(od, info.filename.replace("/", os.sep))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as fp:
                fp.write(zf.read(info.filename))
            n += 1
    return {"ok": True, "out_dir": od, "files_written": n}


def main() -> None:
    parser = argparse.ArgumentParser(description="HWPX 분석·편집(OPC ZIP)")
    parser.add_argument("hwpx_path", nargs="?", help=".hwpx 경로")
    parser.add_argument("--json", action="store_true", help="JSON만 stdout")
    parser.add_argument(
        "--unpack",
        metavar="DIR",
        help="ZIP 내용을 DIR 아래에 풀기",
    )
    parser.add_argument(
        "--replace-out",
        metavar="OUT.hwpx",
        help="본문 section*.xml 텍스트 런에서 부분 치환 후 새 패키지",
    )
    parser.add_argument(
        "--replace",
        action="append",
        metavar="OLD=NEW",
        help="치환 규칙(여러 번 가능). 예: --replace 'foo=bar'",
    )
    parser.add_argument(
        "--edit-table-label-out",
        metavar="OUT.hwpx",
        help="표: 라벨 열로 행 찾아 값 열(tc) 텍스트 수정",
    )
    parser.add_argument(
        "--table-index",
        type=int,
        default=0,
        metavar="N",
        help="section*.xml 안 표 순번(0부터, tbl DFS 순)",
    )
    parser.add_argument(
        "--label-col",
        type=int,
        default=0,
        metavar="N",
        help="라벨 열 인덱스(0부터)",
    )
    parser.add_argument(
        "--value-col",
        type=int,
        default=1,
        metavar="N",
        help="값 열 인덱스(0부터)",
    )
    parser.add_argument(
        "--label-text",
        default="",
        help="라벨 셀과 비교할 문자열(trim)",
    )
    parser.add_argument(
        "--edit-text",
        default="",
        help="값 열에 넣을 문자열 (--edit-table-label-out)",
    )
    parser.add_argument(
        "--list-fillable-cells",
        action="store_true",
        help="모든 표를 훑어 라벨→인접 빈 값 셀 후보를 JSON 으로 stdout 출력 후 종료",
    )
    parser.add_argument(
        "--extract-grids",
        action="store_true",
        help="표 그리드(셀 텍스트 + 위치 메타) JSON 출력. LLM 분류기 입력용.",
    )
    parser.add_argument(
        "--extract-blocks",
        action="store_true",
        help="extract-grids + 블록/슬롯 토폴로지(JSON). 의미 분석 없음.",
    )
    parser.add_argument(
        "--apply-fields-json",
        metavar="PATH",
        help="JSON 파일의 fields[]를 순차 적용. 각 항목 형식: "
             "{section_path?, table_index, label_col, value_col, label_text, value}. "
             "결과는 --apply-fields-out 로 지정",
    )
    parser.add_argument(
        "--apply-fields-out",
        metavar="OUT.hwpx",
        help="--apply-fields-json 결과 출력 .hwpx 경로",
    )
    args = parser.parse_args()

    if not args.hwpx_path:
        print("hwpx_path 가 필요합니다.", file=sys.stderr)
        sys.exit(2)

    if not os.path.isfile(args.hwpx_path):
        print(f"파일 없음: {args.hwpx_path}", file=sys.stderr)
        sys.exit(2)

    if args.list_fillable_cells:
        out = list_fillable_cells_in_hwpx(args.hwpx_path)
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return

    if args.extract_grids:
        out = extract_table_grids_in_hwpx(args.hwpx_path)
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return

    if args.extract_blocks:
        grids = extract_table_grids_in_hwpx(args.hwpx_path)
        topo = build_document_topology(grids)
        out = {"ok": grids.get("ok", False), "grids": grids, "topology": topo}
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return

    if args.apply_fields_json:
        if not args.apply_fields_out:
            print(json.dumps({"ok": False, "error": "--apply-fields-out 가 필요합니다."}, ensure_ascii=False))
            sys.exit(2)
        if not os.path.isfile(args.apply_fields_json):
            print(json.dumps({"ok": False, "error": f"json 없음: {args.apply_fields_json}"}, ensure_ascii=False))
            sys.exit(2)

        with open(args.apply_fields_json, "r", encoding="utf-8") as fp:
            payload = json.load(fp)
        fields = payload.get("fields") or []

        import shutil
        cur_in = args.hwpx_path
        out_path = args.apply_fields_out
        tmp_dir = os.path.dirname(os.path.abspath(out_path)) or "."
        os.makedirs(tmp_dir, exist_ok=True)

        results: list[dict[str, Any]] = []
        applied = 0
        for idx, f in enumerate(fields):
            value = f.get("value")
            if value is None or value == "":
                results.append({"index": idx, "ok": False, "error": "빈 값", "field": f})
                continue
            tmp_out = os.path.join(tmp_dir, f"._apply_{idx}.hwpx")
            row_index = f.get("row_index")
            sec_path = f.get("section_path")
            ed: dict[str, Any] = {"ok": False}
            pos_err: str | None = None
            ti = int(f.get("table_index", 0))
            vc = int(f.get("value_col", 1))
            lc = int(f.get("label_col", 0))
            lbl = str(f.get("label_text", ""))
            abs_x = f.get("absolute_x")
            abs_y = f.get("absolute_y")

            if abs_x is not None and abs_y is not None:
                ed = edit_hwpx_table_value_absolute(
                    cur_in,
                    tmp_out,
                    section_path=sec_path,
                    table_index=ti,
                    absolute_x=int(abs_x),
                    absolute_y=int(abs_y),
                    new_value=str(value),
                )
                if not ed.get("ok") and sec_path:
                    ed = edit_hwpx_table_value_absolute(
                        cur_in,
                        tmp_out,
                        section_path=None,
                        table_index=ti,
                        absolute_x=int(abs_x),
                        absolute_y=int(abs_y),
                        new_value=str(value),
                    )
            if not ed.get("ok") and row_index is not None:
                ed = edit_hwpx_table_value_at_position(
                    cur_in,
                    tmp_out,
                    section_path=sec_path,
                    table_index=ti,
                    row_index=int(row_index),
                    value_col=vc,
                    new_value=str(value),
                )
                if not ed.get("ok") and sec_path:
                    ed = edit_hwpx_table_value_at_position(
                        cur_in,
                        tmp_out,
                        section_path=None,
                        table_index=ti,
                        row_index=int(row_index),
                        value_col=vc,
                        new_value=str(value),
                    )
            if not ed.get("ok"):
                pos_err = ed.get("error")
                ed = edit_hwpx_table_value_by_label(
                    cur_in,
                    tmp_out,
                    section_path=sec_path,
                    table_index=ti,
                    label_text=lbl,
                    label_col=lc,
                    value_col=vc,
                    new_value=str(value),
                )
                if not ed.get("ok") and sec_path:
                    ed = edit_hwpx_table_value_by_label(
                        cur_in,
                        tmp_out,
                        section_path=None,
                        table_index=ti,
                        label_text=lbl,
                        label_col=lc,
                        value_col=vc,
                        new_value=str(value),
                    )
                if ed.get("ok") and pos_err:
                    ed["note"] = "라벨 매칭으로 성공(위치 편집 실패)"
                    ed["position_error"] = pos_err
            if not ed.get("ok"):
                results.append({"index": idx, "ok": False, "error": ed.get("error"), "field": f})
                continue
            applied += 1
            cur_in = tmp_out
            results.append({"index": idx, "ok": True, "field": f})

        if cur_in != args.hwpx_path:
            shutil.move(cur_in, out_path)
        else:
            shutil.copyfile(args.hwpx_path, out_path)

        for i in range(len(fields)):
            tmp = os.path.join(tmp_dir, f"._apply_{i}.hwpx")
            if os.path.isfile(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

        print(json.dumps({
            "ok": True,
            "src": args.hwpx_path,
            "dest": out_path,
            "applied": applied,
            "total": len(fields),
            "results": results,
        }, ensure_ascii=False, indent=2, default=str))
        return

    extra: dict[str, Any] = {}

    if args.unpack:
        u = _unpack(args.hwpx_path, args.unpack)
        if not u.get("ok"):
            print(f"unpack 실패: {u.get('error')}", file=sys.stderr)
            sys.exit(5)
        extra["unpack"] = u
        if args.json:
            out = {**list_package_index(args.hwpx_path), "unpack": u}
            print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        else:
            print(f"unpack 완료: {u['out_dir']} ({u['files_written']} 파일)")
        if not args.replace_out and not args.edit_table_label_out:
            return

    if args.edit_table_label_out:
        if not (args.label_text and args.edit_text):
            print(
                "--edit-table-label-out 는 --label-text 와 --edit-text 가 필요합니다.",
                file=sys.stderr,
            )
            sys.exit(9)
        ed = edit_hwpx_table_value_by_label(
            args.hwpx_path,
            args.edit_table_label_out,
            table_index=args.table_index,
            label_text=args.label_text,
            label_col=args.label_col,
            value_col=args.value_col,
            new_value=args.edit_text,
        )
        if not ed.get("ok"):
            print(f"표 라벨 편집 실패: {ed.get('error')}", file=sys.stderr)
            sys.exit(9)
        extra["table_label_edit"] = ed
        if not args.json:
            print(f"표 라벨→값 편집: {ed['dest']}")
            print(f"  섹션별: {ed.get('per_section')}")

    if args.replace_out:
        pairs: list[tuple[str, str]] = []
        for item in args.replace or []:
            if "=" not in item:
                print(f"--replace 형식 오류 (OLD=NEW): {item!r}", file=sys.stderr)
                sys.exit(6)
            a, b = item.split("=", 1)
            pairs.append((a, b))
        if not pairs:
            print("--replace-out 는 --replace 가 하나 이상 필요합니다.", file=sys.stderr)
            sys.exit(6)
        ed = apply_text_replacements(args.hwpx_path, args.replace_out, pairs)
        if not ed.get("ok"):
            print(f"치환 저장 실패: {ed.get('error')}", file=sys.stderr)
            sys.exit(7)
        extra["edit"] = ed
        if not args.json:
            print(f"치환 저장: {ed['dest']}")
            print(f"  통계: {ed.get('replacement_stats')}")

    analyze_path = args.hwpx_path
    for key in ("table_label_edit", "edit"):
        dest = (extra.get(key) or {}).get("dest")
        if dest:
            analyze_path = dest
            break
    report = analyze_document(analyze_path)
    report["cli_extra"] = extra

    if args.json:
        ft = (report.get("semantic") or {}).get("full_text") or ""
        if len(ft) > 50_000 and report.get("semantic"):
            report["semantic"] = dict(report["semantic"])
            report["semantic"]["full_text"] = ft[:50_000] + "\n... [truncated]"
            report["semantic"]["full_text_truncated"] = True
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        return

    _print_human(report)


def _print_human(report: dict[str, Any]) -> None:
    print("=== HWPX 분석 ===")
    print(f"  경로: {report['input_path']}")
    ex = report.get("cli_extra") or {}
    if ex.get("edit", {}).get("dest"):
        print(f"  (CLI) 치환 결과 파일: {ex['edit']['dest']}")
    if ex.get("table_label_edit", {}).get("dest"):
        print(f"  (CLI) 표 편집 결과 파일: {ex['table_label_edit']['dest']}")
    pk = report.get("package") or {}
    if pk.get("ok"):
        print(f"  ZIP 멤버: {pk.get('entry_count')}개, mimetype: {pk.get('mimetype')!r}")
    else:
        print(f"  패키지: {pk.get('error')}")

    oc = report.get("opcf") or {}
    if oc.get("rootfiles"):
        print(f"  container rootfiles: {oc['rootfiles']}")

    sem = report.get("semantic") or {}
    if sem.get("ok"):
        st = sem.get("stats") or {}
        print(
            f"  섹션 파일: {st.get('section_file_count')}, "
            f"텍스트런: {st.get('text_run_total')}, 글자: {st.get('char_total')}"
        )
        for s in report.get("sections") or []:
            if s.get("ok"):
                pre = (s.get("text_preview") or "")[:120]
                print(f"    · {s.get('path')}: runs={s.get('text_run_count')} preview={pre!r}")

    lim = report.get("inherent_engine_limits") or []
    if lim:
        print(f"  부분 구현 도메인: {', '.join(lim)}")

    rec = report.get("recommendations") or []
    for r in rec:
        print(f"  (참고) {r}")
    print("=== 완료 ===")


if __name__ == "__main__":
    main()
