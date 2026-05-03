# -*- coding: utf-8 -*-
"""
HWP 5.x OLE 패키지 재작성: 스트림 바이트·트리 구조를 유지한 채 새 .hwp 파일 생성.

- 내용(레코드) 변경 없이 olefile 로 읽은 그대로 쓰면, 한글에서 열리는지 검증용 라운드트립.
- compoundfiles(warlomak fork) 의 CompoundFileWriter 사용 (MIT).

서비스 전제는 비암호 HWP 만. FileHeader password 플래그가 있으면 재조립을 거부한다.
"""

from __future__ import annotations

import os
from typing import Any

try:
    import olefile
except ImportError:
    olefile = None  # type: ignore


def _try_import_writer():
    try:
        from compoundfiles.writer import CompoundFileWriter

        return CompoundFileWriter
    except ImportError:
        return None


def repack_hwp_preserving_streams(
    src_hwp: str,
    dest_hwp: str,
    *,
    verify_open: bool = True,
) -> dict[str, Any]:
    """
    원본과 동일한 스토리지/스트림 경로·바이트(저장 형태 그대로)로 새 복합문서 작성.
    """
    src_hwp = os.path.abspath(src_hwp)
    dest_hwp = os.path.abspath(dest_hwp)

    if olefile is None:
        return {"ok": False, "error": "olefile 미설치"}

    CompoundFileWriter = _try_import_writer()
    if CompoundFileWriter is None:
        return {
            "ok": False,
            "error": "compoundfiles.writer 없음 — requirements-hwp-analysis.txt 참고해 fork 설치",
        }

    if not os.path.isfile(src_hwp):
        return {"ok": False, "error": f"없음: {src_hwp}"}

    if not olefile.isOleFile(src_hwp):
        return {"ok": False, "error": "OLE 아님"}

    # FileHeader 에서 암호 플래그(직접 읽기)
    from .file_header_raw import read_file_header_from_ole

    fh = read_file_header_from_ole(src_hwp)
    if fh.get("ok"):
        try:
            from hwp5.filestructure import FileHeader

            fd = FileHeader.Flags.dictvalue(fh["flags_u32"])
            if fd.get("password"):
                return {"ok": False, "error": "암호 문서는 repack 지원 안 함"}
        except Exception:
            pass

    stream_paths: list[tuple] = []
    with olefile.OleFileIO(src_hwp) as ole:
        for entry in ole.listdir(streams=True, storages=False):
            stream_paths.append(tuple(entry))

    if not stream_paths:
        return {"ok": False, "error": "스트림 없음"}

    storages: set[tuple] = set()
    for parts in stream_paths:
        for i in range(1, len(parts)):
            storages.add(tuple(parts[:i]))

    storages_sorted = sorted(storages, key=lambda p: (len(p), p))

    writer = CompoundFileWriter(dest_hwp, sector_size=512)
    root = writer.root
    storage_map: dict[tuple, Any] = {(): root}

    for spath in storages_sorted:
        parent_key = tuple(spath[:-1])
        name = spath[-1]
        parent = storage_map[parent_key]
        st = writer.create_storage(parent, name)
        storage_map[spath] = st

    copied = 0
    total_bytes = 0
    with olefile.OleFileIO(src_hwp) as ole:
        for parts in sorted(stream_paths, key=lambda p: (len(p), p)):
            parent_key = tuple(parts[:-1])
            leaf = parts[-1]
            parent = storage_map[parent_key]
            raw = ole.openstream(list(parts)).read()
            writer.create_stream(parent, leaf, raw)
            copied += 1
            total_bytes += len(raw)

    writer.close()

    result: dict[str, Any] = {
        "ok": True,
        "src": src_hwp,
        "dest": dest_hwp,
        "streams_copied": copied,
        "total_payload_bytes": total_bytes,
        "verify_ole_open": None,
        "verify_records_roundtrip": None,
    }

    if verify_open:
        result["verify_ole_open"] = olefile.isOleFile(dest_hwp)
        if result["verify_ole_open"]:
            from .record_inventory import build_record_report

            a = build_record_report(src_hwp)
            b = build_record_report(dest_hwp)
            result["verify_records_roundtrip"] = (
                a.get("ok")
                and b.get("ok")
                and a.get("total_records") == b.get("total_records")
                and a.get("all_streams_roundtrip_ok")
                and b.get("all_streams_roundtrip_ok")
            )

    return result


def repack_hwp_with_stream_overrides(
    src_hwp: str,
    dest_hwp: str,
    stream_overrides: dict[tuple[str, ...], bytes],
    *,
    verify_open: bool = True,
) -> dict[str, Any]:
    """
    OLE 경로·나머지 스트림은 유지하고, 지정 경로만 바이트를 교체한 새 .hwp 작성.

    ``stream_overrides`` 키는 ('BodyText', 'Section0') 처럼 str 튜플 (ole 경로 정규화).
    """
    src_hwp = os.path.abspath(src_hwp)
    dest_hwp = os.path.abspath(dest_hwp)

    if olefile is None:
        return {"ok": False, "error": "olefile 미설치"}

    CompoundFileWriter = _try_import_writer()
    if CompoundFileWriter is None:
        return {
            "ok": False,
            "error": "compoundfiles.writer 없음 — requirements-hwp-analysis.txt 참고해 fork 설치",
        }

    if not os.path.isfile(src_hwp):
        return {"ok": False, "error": f"없음: {src_hwp}"}

    if not olefile.isOleFile(src_hwp):
        return {"ok": False, "error": "OLE 아님"}

    from .file_header_raw import read_file_header_from_ole

    fh = read_file_header_from_ole(src_hwp)
    if fh.get("ok"):
        try:
            from hwp5.filestructure import FileHeader

            fd = FileHeader.Flags.dictvalue(fh["flags_u32"])
            if fd.get("password"):
                return {"ok": False, "error": "암호 문서는 repack 지원 안 함"}
        except Exception:
            pass

    norm_overrides = {tuple(str(p) for p in k): v for k, v in stream_overrides.items()}
    replaced = 0

    stream_paths: list[tuple] = []
    with olefile.OleFileIO(src_hwp) as ole:
        for entry in ole.listdir(streams=True, storages=False):
            stream_paths.append(tuple(entry))

    if not stream_paths:
        return {"ok": False, "error": "스트림 없음"}

    storages: set[tuple] = set()
    for parts in stream_paths:
        for i in range(1, len(parts)):
            storages.add(tuple(parts[:i]))

    storages_sorted = sorted(storages, key=lambda p: (len(p), p))

    writer = CompoundFileWriter(dest_hwp, sector_size=512)
    root = writer.root
    storage_map: dict[tuple, Any] = {(): root}

    for spath in storages_sorted:
        parent_key = tuple(spath[:-1])
        name = spath[-1]
        parent = storage_map[parent_key]
        st = writer.create_storage(parent, name)
        storage_map[spath] = st

    copied = 0
    total_bytes = 0
    with olefile.OleFileIO(src_hwp) as ole:
        for parts in sorted(stream_paths, key=lambda p: (len(p), p)):
            parent_key = tuple(parts[:-1])
            leaf = parts[-1]
            parent = storage_map[parent_key]
            key = tuple(str(x) for x in parts)
            if key in norm_overrides:
                raw = norm_overrides[key]
                replaced += 1
            else:
                raw = ole.openstream(list(parts)).read()
            writer.create_stream(parent, leaf, raw)
            copied += 1
            total_bytes += len(raw)

    writer.close()

    result: dict[str, Any] = {
        "ok": True,
        "src": src_hwp,
        "dest": dest_hwp,
        "streams_copied": copied,
        "streams_replaced": replaced,
        "total_payload_bytes": total_bytes,
        "verify_ole_open": None,
        "verify_records_roundtrip": None,
    }

    if verify_open:
        result["verify_ole_open"] = olefile.isOleFile(dest_hwp)
        if result["verify_ole_open"]:
            from .record_inventory import build_record_report

            b = build_record_report(dest_hwp)
            result["verify_records_roundtrip"] = (
                b.get("ok") and b.get("all_streams_roundtrip_ok", False)
            )

    return result
