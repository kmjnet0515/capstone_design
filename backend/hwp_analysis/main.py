# -*- coding: utf-8 -*-
"""전체 분석 파이프라인 오케스트레이션."""

from __future__ import annotations

import argparse
import json
import os
import sys
from contextlib import closing
from typing import Any

from .ole_unpack import unpack_ole_streams
from .rebuild_note import REBUILD_STATUS
from .record_inventory import build_record_report, dump_records_json
from .zlib_layer import verify_ole_zlib_streams
from .corpus_verify import print_corpus_summary, run_corpus_on_root
from .engine import analyze_document
from .hwp_repack import repack_hwp_preserving_streams
from .paragraph_edit import edit_simple_paragraph_text_file
from .paragraph_edit import inject_paratext_into_empty_paragraph_file
from .table_label_edit import edit_table_value_by_label
from .table_label_edit import edit_table_value_at_position
from .list_fillable_cells import list_fillable_cells_in_file
from .extract_grids import extract_table_grids_in_file


def _hwp_section_indexes(hwp_path: str) -> list[int]:
    """저장된 section_index 가 어긋날 때 다른 본문 섹션에서 재시도."""
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError:
        return [0]
    try:
        with closing(Hwp5File(os.path.abspath(hwp_path))) as hwp:
            return list(hwp.text.section_indexes())
    except (InvalidHwp5FileError, OSError):
        return [0]


def default_hwp_path() -> str:
    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(backend, "testhwp.hwp")


def run_pipeline(hwp_path: str, hex_preview_len: int = 256) -> dict[str, Any]:
    eng = analyze_document(
        hwp_path,
        hex_preview_len=hex_preview_len,
        run_semantic=True,
    )
    return {
        "input": eng["input_path"],
        "binary": eng["binary"],
        "ole": eng["ole"],
        "file_header_raw": eng["file_header_raw"],
        "file_header_flags": eng["file_header_flags"],
        "semantic": eng["semantic"],
        "records": eng["records"],
        "zlib_storage": eng["zlib_storage"],
        "engine_meta": {
            "file_shape": eng.get("file_shape"),
            "text_storage_logical": eng.get("text_storage_logical"),
            "inherent_engine_limits": eng.get("inherent_engine_limits"),
            "external_dependency_domains": eng.get("external_dependency_domains"),
            "recommendations": eng.get("recommendations"),
            "knowledge_base": eng.get("knowledge_base"),
        },
        "rebuild": {
            "status": REBUILD_STATUS,
        },
    }


def _format_hex_spaced(hex_str: str, width: int = 32) -> str:
    """연속 hex 문자열을 2자리씩 공백으로 끊기."""
    parts = [str(hex_str[i : i + 2]) for i in range(0, len(hex_str), 2)]
    lines = []
    for i in range(0, len(parts), 16):
        chunk = parts[i : i + 16]
        lines.append(" ".join(chunk))
    return "\n".join(lines)


def print_human_report(report: dict[str, Any]) -> None:
    em = report.get("engine_meta") or {}
    if em.get("file_shape"):
        fs = em["file_shape"]
        print("=== [0] 범용 엔진 · 파일 형태 (플래그 기반) ===")
        print(f"  Body/View 분기: 본문 스토리지 = {em.get('text_storage_logical')}")
        print(
            f"  distributable={fs.get('distributable')} password={fs.get('password')} "
            f"compressed={fs.get('compressed')}"
        )
        lim = em.get("inherent_engine_limits") or []
        ext = em.get("external_dependency_domains") or []
        print(f"  미완 능력 영역(domains): {lim}")
        print(f"  외부 의존 레이어: {ext}")
        print()
    b = report["binary"]
    print("=== [1] 바이너리 개요 ===")
    print(f"  경로: {b['path']}")
    print(f"  크기: {b['size_bytes']} bytes")
    print(f"  OLE 복합문서 시그니처: {b['is_ole_compound']}")
    print("  선두 hex 미리보기:")
    print(_format_hex_spaced(b["hex_preview"]))
    print()

    ole = report["ole"]
    print("=== [2] OLE 스트림 목록 ===")
    if not ole.get("ok"):
        print(f"  (건너뜀) {ole.get('error')}")
    else:
        for s in ole.get("streams", []):
            sz = s["size_bytes"]
            print(f"  - {s['path']!r}  ({sz} bytes)")
    print()

    fh = report["file_header_raw"]
    print("=== [3] FileHeader 스트림 (raw) ===")
    if not fh.get("ok"):
        print(f"  (실패) {fh.get('error')}")
    else:
        print(f"  스트림 크기: {fh.get('stream_size_bytes')} bytes")
        print(f"  시그니처(HWP5): {fh.get('signature_matches_hwp5')}")
        print(f"  버전 튜플: {fh.get('version_tuple')}")
        print(f"  flags (u32): {fh.get('flags_u32')}")
        print("  헤더 앞 64바이트 hex:")
        print("   ", fh.get("raw_header_hex_64"))
    print()

    sem = report["semantic"]
    print("=== [4] 의미 분석 (hwp5) ===")
    if not sem.get("ok"):
        print(f"  (건너뜀) {sem.get('error')}")
    else:
        data = sem["data"]
        h = data["hwp5_header"]
        st = data["stats"]
        print(f"  버전: {h.get('version')}")
        print(
            f"  문단: {st['paragraph_count']} "
            f"(비어 있지 않음: {st['non_empty_paragraph_count']})"
        )
        print(f"  표(TableControl): {st['table_control_count']}")
        print("  문단 미리보기 (최대 25줄):")
        for p in data["paragraphs"][:25]:
            pid = p.get("paragraph_id")
            sid = p.get("section_id")
            t = p.get("text", "")
            preview = t if len(t) <= 100 else t[:97] + "..."
            print(f"    [s={sid} p={pid}] {preview!r}")
        if len(data["paragraphs"]) > 25:
            print(f"    ... 외 {len(data['paragraphs']) - 25} 문단")
    print()

    rec = report.get("records") or {}
    print("=== [5] 레코드 전수 스캔 (DocInfo + BodyText/Section*) ===")
    if not rec.get("ok"):
        print(f"  (실패) {rec.get('error')}")
    else:
        print(f"  HWP 버전: {rec.get('hwp_version')}")
        print(f"  스트림 수: {rec.get('streams_scanned')}")
        print(f"  레코드 총개수: {rec.get('total_records')}")
        print(f"  스트림 레코드 무손실 재직렬화 전부 성공: {rec.get('all_streams_roundtrip_ok')}")
        for s in rec.get("streams", []):
            print(
                f"  · {s['stream']}: 레코드 {s['record_count']}개, "
                f"decompressed {s['decompressed_size_bytes']} B, "
                f"roundtrip={s['roundtrip_serialize_ok']}"
            )
            if s.get("trailing_garbage_bytes"):
                print(f"      경고: 스트림 끝 잔여 바이트 {s['trailing_garbage_bytes']}")
    print()

    zl = report.get("zlib_storage") or {}
    print("=== [6] OLE 내 zlib(raw deflate) 스트림 재압축 검증 ===")
    if not zl.get("ok"):
        print(f"  (건너뜀) {zl.get('error')}")
    else:
        print(
            f"  스트림 전부 semantic 일치: {zl.get('all_zlib_roundtrip_semantically_ok')}"
        )
        for row in zl.get("streams", []):
            if row.get("ok"):
                print(
                    f"  · {row['path']}: stored {row['stored_bytes']} B → "
                    f"repacked {row['recompressed_bytes']} B "
                    f"(payload {row['decompressed_bytes']} B)"
                )
            else:
                print(f"  · {row.get('path')}: 실패 {row.get('error')}")
    print()

    rb = report.get("rebuild") or {}
    print("=== [7] 재구성(뷰어 재오픈) 진행 상태 ===")
    print(f"  {rb.get('status', '미정')}")
    print()
    print("=== 완료 ===")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HWP 파일 전체 분석: 바이너리·OLE·FileHeader·hwp5 의미",
    )
    parser.add_argument(
        "hwp_path",
        nargs="?",
        default=default_hwp_path(),
        help="분석할 .hwp (기본: backend/testhwp.hwp)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="통합 리포트만 JSON으로 stdout",
    )
    parser.add_argument(
        "--hex-bytes",
        type=int,
        default=256,
        help="선두 hex 미리보기 바이트 수 (기본 256)",
    )
    parser.add_argument(
        "--unpack",
        metavar="DIR",
        help="OLE 스트림을 원시 바이트로 DIR 아래에 전부 풀기",
    )
    parser.add_argument(
        "--dump-records",
        metavar="JSON_PATH",
        help="모든 레코드 메타(+ payload_hex_head)를 JSON 파일로 저장",
    )
    parser.add_argument(
        "--dump-records-full-payload-hex",
        action="store_true",
        help="--dump-records 시 payload 전체 hex 포함 (파일 매우 큼)",
    )
    parser.add_argument(
        "--corpus",
        metavar="DIR_OR_FILE",
        help="디렉터리(또는 .hwp 한 개) 아래 모든 HWP에 검증 파이프라인 일괄 실행",
    )
    parser.add_argument(
        "--corpus-recursive",
        action="store_true",
        help="--corpus 가 디렉터리일 때 하위 폴더까지 (venv 등은 자동 제외)",
    )
    parser.add_argument(
        "--corpus-glob",
        default="*.hwp",
        help="recursive 가 아닐 때만 사용 (기본 *.hwp)",
    )
    parser.add_argument(
        "--corpus-json-out",
        metavar="PATH",
        help="코퍼스 집계 결과 JSON 저장 경로",
    )
    parser.add_argument(
        "--corpus-fast",
        action="store_true",
        help="코퍼스 검사 시 의미 분석(hwp5 이벤트) 생략 — 레코드·zlib 중심",
    )
    parser.add_argument(
        "--corpus-max-files",
        type=int,
        default=None,
        help="처리할 .hwp 개수 상한(정렬 후 앞쪽만)",
    )
    parser.add_argument(
        "--repack-out",
        metavar="OUT.hwp",
        help="스트림을 그대로 옮겨 새 OLE/HWP 파일 작성(내용 무편집 라운드트립)",
    )
    parser.add_argument(
        "--edit-simple-para-out",
        metavar="OUT.hwp",
        help="MVP 의미 편집: 단순 문단(가시텍스트+P_BREAK만) ParaText/Header 갱신 후 저장",
    )
    parser.add_argument(
        "--edit-section",
        type=int,
        default=0,
        metavar="N",
        help="--edit-simple-para-out 시 Section 인덱스 (기본 0)",
    )
    parser.add_argument(
        "--edit-para-text-seq",
        type=int,
        default=None,
        metavar="SEQ",
        help="편집할 HWPTAG_PARA_TEXT 레코드 seqno(record_inventory·dump-records와 동일)",
    )
    parser.add_argument(
        "--edit-text",
        default="",
        help="삽입할 가시 문자열(UTF-8). ParaText 끝 0x0d는 자동 추가",
    )
    parser.add_argument(
        "--edit-table-label-out",
        metavar="OUT.hwp",
        help="표: 라벨 열로 행 찾아 값 열 첫 ParaText 를 편집(단순 문단 MVP와 동일 제약)",
    )
    parser.add_argument(
        "--table-index",
        type=int,
        default=0,
        metavar="N",
        help="본문 안 표 순번(0부터, HWPTAG_TABLE 출현 순)",
    )
    parser.add_argument(
        "--label-col",
        type=int,
        default=0,
        metavar="N",
        help="라벨이 있는 열(0부터)",
    )
    parser.add_argument(
        "--value-col",
        type=int,
        default=1,
        metavar="N",
        help="바꿀 값 열(0부터)",
    )
    parser.add_argument(
        "--label-text",
        default="",
        help="매칭할 라벨 셀 텍스트(앞뒤 공백 무시)",
    )
    parser.add_argument(
        "--list-fillable-cells",
        action="store_true",
        help="모든 표를 훑어 라벨→인접 빈 값 셀 후보를 JSON 으로 stdout 출력하고 종료",
    )
    parser.add_argument(
        "--extract-grids",
        action="store_true",
        help="표 그리드(셀 텍스트 + 위치 메타) JSON 출력. LLM 분류기 입력용.",
    )
    parser.add_argument(
        "--apply-fields-json",
        metavar="PATH",
        help="JSON 파일의 fields[]를 순차 적용. 각 항목 형식: "
             "{section_index, table_index, label_col, value_col, label_text, value}. "
             "결과 .hwp 는 --apply-fields-out 로 지정",
    )
    parser.add_argument(
        "--apply-fields-out",
        metavar="OUT.hwp",
        help="--apply-fields-json 결과 출력 .hwp 경로",
    )
    args = parser.parse_args()

    if args.list_fillable_cells:
        if not os.path.isfile(args.hwp_path):
            print(json.dumps({"ok": False, "error": f"파일 없음: {args.hwp_path}"}, ensure_ascii=False))
            sys.exit(2)
        out = list_fillable_cells_in_file(args.hwp_path)
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
        return

    if args.extract_grids:
        if not os.path.isfile(args.hwp_path):
            print(json.dumps({"ok": False, "error": f"파일 없음: {args.hwp_path}"}, ensure_ascii=False))
            sys.exit(2)
        out = extract_table_grids_in_file(args.hwp_path)
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
        cur_in = args.hwp_path
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
            tmp_out = os.path.join(tmp_dir, f"._apply_{idx}.hwp")
            row_index = f.get("row_index")
            ed: dict[str, Any] = {"ok": False}
            pos_err: str | None = None
            si = int(f.get("section_index", 0))
            ti = int(f.get("table_index", 0))
            vc = int(f.get("value_col", 1))
            lc = int(f.get("label_col", 0))
            lbl = str(f.get("label_text", ""))

            if row_index is not None:
                ed = edit_table_value_at_position(
                    cur_in,
                    tmp_out,
                    section_index=si,
                    table_index=ti,
                    row_index=int(row_index),
                    value_col=vc,
                    new_visible_text=str(value),
                )
                if not ed.get("ok"):
                    for alt_si in _hwp_section_indexes(cur_in):
                        if alt_si == si:
                            continue
                        ed = edit_table_value_at_position(
                            cur_in,
                            tmp_out,
                            section_index=alt_si,
                            table_index=ti,
                            row_index=int(row_index),
                            value_col=vc,
                            new_visible_text=str(value),
                        )
                        if ed.get("ok"):
                            break
            if not ed.get("ok"):
                pos_err = ed.get("error")
                ed = edit_table_value_by_label(
                    cur_in,
                    tmp_out,
                    section_index=si,
                    table_index=ti,
                    label_text=lbl,
                    label_col=lc,
                    value_col=vc,
                    new_visible_text=str(value),
                )
                if not ed.get("ok"):
                    for alt_si in _hwp_section_indexes(cur_in):
                        if alt_si == si:
                            continue
                        ed = edit_table_value_by_label(
                            cur_in,
                            tmp_out,
                            section_index=alt_si,
                            table_index=ti,
                            label_text=lbl,
                            label_col=lc,
                            value_col=vc,
                            new_visible_text=str(value),
                        )
                        if ed.get("ok"):
                            break
                if ed.get("ok") and pos_err:
                    ed["note"] = "라벨 매칭으로 성공(위치 편집 실패)"
                    ed["position_error"] = pos_err
            if not ed.get("ok"):
                results.append({"index": idx, "ok": False, "error": ed.get("error"), "field": f})
                continue
            applied += 1
            cur_in = tmp_out
            results.append({"index": idx, "ok": True, "field": f})

        if cur_in != args.hwp_path:
            shutil.move(cur_in, out_path)
        else:
            shutil.copyfile(args.hwp_path, out_path)

        for i in range(len(fields)):
            tmp = os.path.join(tmp_dir, f"._apply_{i}.hwp")
            if os.path.isfile(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

        print(json.dumps({
            "ok": True,
            "src": args.hwp_path,
            "dest": out_path,
            "applied": applied,
            "total": len(fields),
            "results": results,
        }, ensure_ascii=False, indent=2, default=str))
        return

    if args.corpus:
        target = args.corpus
        if not os.path.isdir(target) and not (
            os.path.isfile(target) and target.lower().endswith(".hwp")
        ):
            print(
                f"--corpus 경로가 디렉터리 또는 .hwp 파일이 아님: {target}",
                file=sys.stderr,
            )
            sys.exit(2)

        corp = run_corpus_on_root(
            target,
            recursive=args.corpus_recursive,
            glob_pattern=args.corpus_glob,
            run_semantic=not args.corpus_fast,
            max_files=args.corpus_max_files,
        )
        if args.corpus_json_out:
            with open(args.corpus_json_out, "w", encoding="utf-8") as fp:
                json.dump(corp, fp, ensure_ascii=False, indent=2, default=str)

        if args.json:
            print(json.dumps(corp, ensure_ascii=False, indent=2, default=str))
        else:
            print_corpus_summary(corp)
        return

    if not os.path.isfile(args.hwp_path):
        print(f"파일 없음: {args.hwp_path}", file=sys.stderr)
        sys.exit(2)

    if args.unpack:
        u = unpack_ole_streams(args.hwp_path, args.unpack)
        if not u.get("ok"):
            print(f"unpack 실패: {u.get('error')}", file=sys.stderr)
            sys.exit(5)
        print(f"OLE 풀기 완료: {u['out_dir']} ({u['streams_written']} 스트림)")

    if args.dump_records:
        d = dump_records_json(
            args.hwp_path,
            args.dump_records,
            full_payload_hex=args.dump_records_full_payload_hex,
        )
        if not d.get("ok"):
            print(f"dump-records 실패: {d.get('error')}", file=sys.stderr)
            sys.exit(6)
        print(f"레코드 덤프 저장: {d['wrote']} ({d['streams']} 스트림)")

    if args.repack_out:
        rp = repack_hwp_preserving_streams(
            args.hwp_path,
            args.repack_out,
            verify_open=True,
        )
        if not rp.get("ok"):
            print(f"repack 실패: {rp.get('error')}", file=sys.stderr)
            sys.exit(7)
        print(f"repack 완료: {rp['dest']}")
        print(
            f"  스트림 {rp['streams_copied']}개, OLE검증={rp.get('verify_ole_open')}, "
            f"레코드 일치·RT={rp.get('verify_records_roundtrip')}"
        )

    if args.edit_simple_para_out:
        if args.edit_para_text_seq is None:
            print(
                "--edit-simple-para-out 는 --edit-para-text-seq 가 필요합니다.",
                file=sys.stderr,
            )
            sys.exit(8)
        ed = edit_simple_paragraph_text_file(
            args.hwp_path,
            args.edit_simple_para_out,
            section_index=args.edit_section,
            para_text_seqno=args.edit_para_text_seq,
            new_visible_text=args.edit_text,
            verify_repack=True,
        )
        if not ed.get("ok"):
            print(f"단순 문단 편집 실패: {ed.get('error')}", file=sys.stderr)
            sys.exit(8)
        print(f"단순 문단 편집 저장: {ed['dest']}")
        print(f"  스트림 {ed.get('stream_path')}, seq={args.edit_para_text_seq}, 편집: {ed.get('edit')}")
        rpk = ed.get("repack") or {}
        print(
            f"  repack 교체 스트림 {rpk.get('streams_replaced')}개, "
            f"OLE={rpk.get('verify_ole_open')}, 레코드RT={rpk.get('verify_records_roundtrip')}"
        )

    if args.edit_table_label_out:
        if not (args.label_text and args.edit_text):
            print(
                "--edit-table-label-out 는 --label-text 와 --edit-text 가 필요합니다.",
                file=sys.stderr,
            )
            sys.exit(9)
        ed = edit_table_value_by_label(
            args.hwp_path,
            args.edit_table_label_out,
            section_index=args.edit_section,
            table_index=args.table_index,
            label_text=args.label_text,
            label_col=args.label_col,
            value_col=args.value_col,
            new_visible_text=args.edit_text,
        )
        if not ed.get("ok"):
            print(f"표 라벨 편집 실패: {ed.get('error')}", file=sys.stderr)
            sys.exit(9)
        print(f"표 라벨→값 편집 저장: {ed['dest']}")
        m = ed.get("table_label_match") or {}
        print(
            f"  표#{args.table_index} row={m.get('matched_row_index')} "
            f"ParaText seq={m.get('para_text_seqno')}"
        )

    report = run_pipeline(args.hwp_path, hex_preview_len=args.hex_bytes)

    if args.json:
        if report.get("semantic", {}).get("ok") and report["semantic"].get("data"):
            ft = report["semantic"]["data"].get("full_text", "")
            if len(ft) > 50_000:
                report["semantic"]["data"] = dict(report["semantic"]["data"])
                report["semantic"]["data"]["full_text"] = (
                    ft[:50_000] + "\n... [truncated]"
                )
                report["semantic"]["data"]["full_text_truncated"] = True

        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        return

    print_human_report(report)


if __name__ == "__main__":
    main()
