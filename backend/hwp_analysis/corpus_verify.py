# -*- coding: utf-8 -*-
"""
여러 .hwp 에 대해 동일 검증 파이프라인을 돌리고 집계한다.

단일 예시 파일이 아니라 디렉터리·여러 경로를 돌며
OLE → FileHeader → 레코드 전수·무손실 RT → zlib 층 → (선택) 의미 분석 까지
성공/실패 단계와 버전·미등록 태그·스트림 이름을 누적한다.
"""

from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Iterable

from .engine import analyze_document


def discover_hwp_files(
    root: str,
    *,
    recursive: bool,
    glob_pattern: str = "*.hwp",
    skip_dir_names: frozenset[str] | None = None,
    max_files: int | None = None,
) -> list[str]:
    if skip_dir_names is None:
        skip_dir_names = frozenset(
            {
                "venv",
                ".git",
                "node_modules",
                "__pycache__",
                ".venv",
            }
        )

    root = os.path.abspath(root)
    if os.path.isfile(root):
        return [root] if root.lower().endswith(".hwp") else []
    out: list[str] = []
    if recursive:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in skip_dir_names]
            for fn in filenames:
                if fn.lower().endswith(".hwp"):
                    out.append(os.path.join(dirpath, fn))
    else:
        import glob

        pat = os.path.join(root, glob_pattern)
        out.extend(sorted(glob.glob(pat)))

    out = sorted(set(out))
    if max_files is not None:
        out = out[:max_files]
    return out


def _unknown_tagids_from_record_report(rep: dict[str, Any]) -> list[int]:
    u: set[int] = set()
    if not rep.get("ok"):
        return []
    for s in rep.get("streams", []):
        for name in s.get("tag_counts", {}):
            if name.startswith("HWPTAG_UNKNOWN_"):
                try:
                    u.add(int(name.rsplit("_", 1)[-1]))
                except ValueError:
                    pass
    return sorted(u)


def verify_one(
    path: str,
    *,
    run_semantic: bool = True,
) -> dict[str, Any]:
    """단일 파일 검증 — 범용 엔진(analyze_document) 결과를 코퍼스 행으로 변환."""
    path = os.path.abspath(path)
    row: dict[str, Any] = {
        "path": path,
        "ok": False,
        "failed_stage": None,
        "errors": [],
        "warnings": [],
        "hwp_version": None,
        "file_size_bytes": None,
        "text_storage": None,
        "distributable": None,
        "password": None,
        "ole_stream_count": None,
        "record_total": None,
        "records_roundtrip_all": None,
        "zlib_semantic_all": None,
        "semantic_ok": None,
        "unknown_hwptag_ids": [],
        "stream_paths_sample": [],
    }

    if not os.path.isfile(path):
        row["failed_stage"] = "missing_file"
        row["errors"].append("파일 없음")
        return row

    eng = analyze_document(
        path,
        hex_preview_len=64,
        run_semantic=run_semantic,
    )
    row["warnings"].extend(eng.get("recommendations") or [])
    shape = eng.get("file_shape") or {}
    row["file_size_bytes"] = eng["binary"].get("size_bytes")
    row["text_storage"] = eng.get("text_storage_logical")
    row["distributable"] = shape.get("distributable")
    row["password"] = shape.get("password")

    if not eng["binary"].get("is_ole_compound"):
        row["failed_stage"] = "not_ole"
        row["errors"].append("OLE 시그니처 아님")
        return row

    ole = eng["ole"]
    if ole.get("ok"):
        row["ole_stream_count"] = len(ole.get("streams", []))
        row["stream_paths_sample"] = [s["path"] for s in ole.get("streams", [])[:25]]

    fh = eng["file_header_raw"]
    if not fh.get("ok"):
        row["failed_stage"] = "fileheader"
        row["errors"].append(fh.get("error", "FileHeader 실패"))
        return row

    if not fh.get("signature_matches_hwp5"):
        row["warnings"].append("FileHeader 시그니처가 HWP5 기대와 다름")

    row["hwp_version"] = fh.get("version_tuple")

    rec = eng["records"] or {}
    if not rec.get("ok"):
        row["failed_stage"] = "records"
        row["errors"].append(rec.get("error", "레코드 스캔 실패"))
        return row

    row["record_total"] = rec.get("total_records")
    row["records_roundtrip_all"] = rec.get("all_streams_roundtrip_ok")
    row["unknown_hwptag_ids"] = _unknown_tagids_from_record_report(rec)

    if not rec.get("all_streams_roundtrip_ok"):
        row["failed_stage"] = "record_roundtrip"
        row["errors"].append("레코드 재직렬화 무손실 실패(스트림 중 일부)")
        bad = [
            s["stream"]
            for s in rec.get("streams", [])
            if not s.get("roundtrip_serialize_ok")
        ]
        row["errors"].append(f"대상: {bad}")
        return row

    for s in rec.get("streams", []):
        tg = s.get("trailing_garbage_bytes", 0)
        if tg:
            row["warnings"].append(f"{s['stream']}: 스트림 끝 잔여 {tg} bytes")

    zl = eng.get("zlib_storage") or {}
    if not zl.get("ok"):
        row["failed_stage"] = "zlib_check_skipped"
        row["warnings"].append(f"zlib 검증 스킵: {zl.get('error')}")
        row["zlib_semantic_all"] = None
    else:
        row["zlib_semantic_all"] = zl.get("all_zlib_roundtrip_semantically_ok")
        if not zl.get("all_zlib_roundtrip_semantically_ok"):
            row["failed_stage"] = "zlib_layer"
            row["errors"].append("zlib 재압축·재해제 의미 불일치")
            for r in zl.get("streams", []):
                if not r.get("ok"):
                    row["errors"].append(f"zlib {r.get('path')}: {r.get('error')}")
            return row

    sem = eng.get("semantic")
    if run_semantic:
        row["semantic_ok"] = sem.get("ok") if sem else None
        if sem and not sem.get("ok"):
            row["warnings"].append(f"의미 분석(hwp5): {sem.get('error')}")
    else:
        row["semantic_ok"] = None

    row["ok"] = True
    row["failed_stage"] = None
    return row


def run_corpus(
    paths: Iterable[str],
    *,
    run_semantic: bool = True,
) -> dict[str, Any]:
    paths = list(paths)
    rows = [verify_one(p, run_semantic=run_semantic) for p in paths]

    ok_count = sum(1 for r in rows if r["ok"])
    fail = [r for r in rows if not r["ok"]]
    stage_ctr = Counter(
        r["failed_stage"] for r in fail if r.get("failed_stage")
    )

    ver_ctr: Counter[tuple | str] = Counter()
    for r in rows:
        v = r.get("hwp_version")
        if v is not None:
            ver_ctr[tuple(v) if isinstance(v, list) else v] += 1
        else:
            ver_ctr["(unknown)"] += 1

    unknown_union: set[int] = set()
    for r in rows:
        unknown_union.update(r.get("unknown_hwptag_ids") or [])

    stream_names: set[str] = set()
    for r in rows:
        if r.get("stream_paths_sample"):
            stream_names.update(r["stream_paths_sample"])

    dist_ctr = Counter(str(bool(r.get("distributable"))) for r in rows)
    pwd_ctr = Counter(str(bool(r.get("password"))) for r in rows)

    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "files_total": len(rows),
        "files_fully_ok": ok_count,
        "files_failed": len(fail),
        "failure_by_stage": dict(stage_ctr.most_common()),
        "hwp_version_histogram": {str(k): v for k, v in ver_ctr.items()},
        "distributable_histogram": dict(dist_ctr),
        "password_flag_histogram": dict(pwd_ctr),
        "unknown_hwptag_ids_union": sorted(unknown_union),
        "distinct_stream_pathnames_seen": sorted(stream_names),
        "per_file": rows,
        "failures_detail": fail,
    }


def run_corpus_on_root(
    root: str,
    *,
    recursive: bool,
    glob_pattern: str,
    run_semantic: bool,
    max_files: int | None = None,
) -> dict[str, Any]:
    files = discover_hwp_files(
        root,
        recursive=recursive,
        glob_pattern=glob_pattern,
        max_files=max_files,
    )
    rep = run_corpus(files, run_semantic=run_semantic)
    rep["scan_root"] = os.path.abspath(root)
    rep["recursive"] = recursive
    rep["glob_pattern"] = glob_pattern
    rep["max_files_cap"] = max_files
    return rep


def print_corpus_summary(rep: dict[str, Any]) -> None:
    """터미널용 짧은 요약."""
    print("=== HWP 코퍼스 검증 요약 ===")
    print(f"  스캔 루트: {rep.get('scan_root')}")
    print(f"  recursive: {rep.get('recursive')}, glob: {rep.get('glob_pattern')!r}")
    if rep.get("max_files_cap"):
        print(f"  파일 수 상한: {rep['max_files_cap']}")
    print(f"  발견된 .hwp: {rep['files_total']}")
    print(f"  전체 검증 통과: {rep['files_fully_ok']}")
    print(f"  실패: {rep['files_failed']}")
    print("  실패 단계별:")
    for st, c in (rep.get("failure_by_stage") or {}).items():
        print(f"    · {st}: {c}")
    print("  HWP 버전 분포:")
    for v, c in sorted(
        (rep.get("hwp_version_histogram") or {}).items(),
        key=lambda x: -x[1],
    ):
        print(f"    · {v!r}: {c}")
    u = rep.get("unknown_hwptag_ids_union") or []
    if u:
        print(f"  (주의) 스펙 외 추정 태그 ID 출현: {u}")
    else:
        print("  미등록 HWPTAG ID: 없음(샘플 기준 pyhwp 태그표와 일치)")
    print("  distributable 플래그 분포:", rep.get("distributable_histogram"))
    print("  password 플래그 분포:", rep.get("password_flag_histogram"))
    if rep["files_failed"] and rep.get("failures_detail"):
        print("  실패 파일 (최대 20개):")
        for f in rep["failures_detail"][:20]:
            print(f"    - {f['path']}")
            print(f"      stage={f.get('failed_stage')} {f.get('errors')}")
