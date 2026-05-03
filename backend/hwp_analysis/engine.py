# -*- coding: utf-8 -*-
"""
범용 HWP 5.x 분석 엔진 — 특정 샘플 파일에 종속되지 않음.

입력: 임의의 경로의 .hwp
출력: 파일마다 플래그·저장소 종류를 탐지하고, 동일 파이프라인으로 레코드·zlib·(가능 시) 의미 분석.

한글/뷰어 수준의 완전 재구성은 knowledge_domains 의 missing/partial 항목이 남아 있음을
analysis_gaps 에 명시한다.
"""

from __future__ import annotations

import os
from typing import Any

from .binary_peek import peek_binary
from .file_header_raw import read_file_header_from_ole
from .hwp5_semantic import analyze_semantic
from .knowledge_domains import REQUIRED_KNOWLEDGE, knowledge_summary
from .ole_streams import list_ole_streams
from .record_inventory import build_record_report
from .zlib_layer import verify_ole_zlib_streams


def _header_flags_dict(hwp_path: str) -> dict[str, Any]:
    """ole 직접 읽기만 사용해 flags 비트를 사람이 읽을 형태로."""
    fh = read_file_header_from_ole(hwp_path)
    if not fh.get("ok"):
        return {"ok": False, "error": fh.get("error"), "bits": {}}
    # file_header_raw 는 flags_u32 만 줌 — 비트 이름은 hwp5 가 있으면 사용
    bits: dict[str, Any] = {"flags_u32": fh.get("flags_u32")}
    try:
        from hwp5.filestructure import FileHeader

        bits.update(FileHeader.Flags.dictvalue(fh["flags_u32"]))
    except Exception:
        bits["named_bits"] = None
    return {"ok": True, "error": None, "bits": bits, "version_tuple": fh.get("version_tuple")}


def _text_storage_label_from_flags(distributable: bool) -> str:
    return "ViewText" if distributable else "BodyText"


def analyze_document(
    hwp_path: str,
    *,
    hex_preview_len: int = 256,
    run_semantic: bool = True,
) -> dict[str, Any]:
    """
    임의 HWP 1개에 대한 정규화된 분석 결과.
    """
    path = os.path.abspath(hwp_path)
    out: dict[str, Any] = {
        "engine": {
            "name": "hwp_analysis.universal",
            "not_tied_to_single_sample": True,
            "description": "임의 HWP 5.x; FileHeader 플래그에 따라 본문 스토리지 탐지",
        },
        "input_path": path,
        "knowledge_base": knowledge_summary(),
        "inherent_engine_limits": [
            d["id"]
            for d in REQUIRED_KNOWLEDGE
            if d.get("implementation")
            not in ("complete", "external", "out_of_scope")
        ],
        "external_dependency_domains": [
            d["id"]
            for d in REQUIRED_KNOWLEDGE
            if d.get("implementation") == "external"
        ],
        "binary": peek_binary(path, hex_bytes=hex_preview_len),
        "ole": list_ole_streams(path),
        "file_header_raw": read_file_header_from_ole(path),
        "file_header_flags": _header_flags_dict(path),
        "records": None,
        "zlib_storage": None,
        "semantic": None,
        "text_storage_logical": None,
        "recommendations": [],
    }

    hdr = out["file_header_raw"]
    if not hdr.get("ok"):
        out["recommendations"].append("FileHeader 를 읽지 못함 — HWP 5.x OLE 인지 확인")
        return out

    distributable = bool(out["file_header_flags"]["bits"].get("distributable"))
    password = bool(out["file_header_flags"]["bits"].get("password"))
    compressed = bool(out["file_header_flags"]["bits"].get("compressed"))

    out["text_storage_logical"] = _text_storage_label_from_flags(distributable)
    out["file_shape"] = {
        "distributable": distributable,
        "password": password,
        "compressed": compressed,
        "primary_body_streams_expected_prefix": out["text_storage_logical"],
    }

    if password:
        out["recommendations"].append(
            "FileHeader 에 password 플래그 — 서비스 전제는 비암호 HWP 만. 업로드 검증에서 걸러야 함"
        )

    out["records"] = build_record_report(path)
    out["zlib_storage"] = verify_ole_zlib_streams(path)

    if run_semantic:
        out["semantic"] = analyze_semantic(path)
        if not out["semantic"].get("ok"):
            out["recommendations"].append(
                f"의미 분석 스킵/실패: {out['semantic'].get('error')} — 레코드 층은 별개"
            )

    rec = out["records"] or {}
    if rec.get("ok") and rec.get("text_storage"):
        if rec["text_storage"] != out["text_storage_logical"]:
            out["recommendations"].append(
                f"내부 불일치: records.text_storage={rec['text_storage']!r} "
                f"vs 플래그 기대 {out['text_storage_logical']!r}"
            )

    return out


def analyze_document_minimal(path: str) -> dict[str, Any]:
    """의미 분석 없이 레코드·zlib 위주 (코퍼스 대량용)."""
    return analyze_document(path, run_semantic=False)
