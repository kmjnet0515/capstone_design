# -*- coding: utf-8 -*-
"""
HWP 5.x 레코드 전수 스캔 (DocInfo + 본문 Section*; 본문은 BodyText 또는 ViewText).

- 스트림을 연 후 압축 해제된 바이트 체인에 대해 (tagid, level, size, payload) 전부 순회
- 레코드 재직렬화 바이트 == 원본 스트림 바이트 여부로 라운드트립 검증
"""

from __future__ import annotations

import hashlib
import json
import os
from contextlib import closing
from io import BytesIO
from typing import Any, Callable

_TAG_NAME: Callable[[int], str] | None = None


def _tag_name(tagid: int) -> str:
    global _TAG_NAME
    if _TAG_NAME is None:
        from hwp5.tagids import tagnames

        def fn(tid: int) -> str:
            return tagnames.get(tid, f"HWPTAG_UNKNOWN_{tid}")

        _TAG_NAME = fn
    return _TAG_NAME(tagid)


def _serialize_records(records: list[dict[str, Any]]) -> bytes:
    from hwp5.recordstream import dump_record

    buf = BytesIO()
    for rec in records:
        dump_record(buf, rec)
    return buf.getvalue()


def _scan_decompressed_stream(raw: bytes, stream_label: str) -> dict[str, Any]:
    from hwp5.recordstream import read_record

    f = BytesIO(raw)
    records: list[dict[str, Any]] = []
    seq = 0
    while True:
        rec = read_record(f, seq)
        if rec is None:
            break
        records.append(rec)
        seq += 1

    trailing = f.read()
    counts: dict[str, int] = {}
    payload_bytes = 0
    for rec in records:
        name = _tag_name(rec["tagid"])
        counts[name] = counts.get(name, 0) + 1
        payload_bytes += len(rec["payload"])

    rebuilt = _serialize_records(records)
    roundtrip_ok = rebuilt == raw and len(trailing) == 0

    return {
        "stream": stream_label,
        "record_count": len(records),
        "decompressed_size_bytes": len(raw),
        "payload_bytes_total": payload_bytes,
        "trailing_garbage_bytes": len(trailing),
        "tag_counts": dict(sorted(counts.items(), key=lambda x: (-x[1], x[0]))),
        "roundtrip_serialize_ok": roundtrip_ok,
        "records": records,
        "trailing_hex_preview": trailing[:64].hex() if trailing else "",
    }


def _records_to_summaries(records: list[dict[str, Any]], payload_hex_max: int) -> list[dict[str, Any]]:
    out = []
    for rec in records:
        p = rec["payload"]
        h = hashlib.sha256(p).hexdigest()
        item = {
            "seqno": rec.get("seqno"),
            "tagid": rec["tagid"],
            "tagname": _tag_name(rec["tagid"]),
            "level": rec["level"],
            "payload_size": len(p),
            "payload_sha256": h,
        }
        if payload_hex_max > 0:
            item["payload_hex"] = p[:payload_hex_max].hex()
            if len(p) > payload_hex_max:
                item["payload_hex_truncated"] = True
        out.append(item)
    return out


def build_record_report(
    hwp_path: str,
    *,
    include_summaries: bool = False,
    payload_hex_max: int = 0,
) -> dict[str, Any]:
    """
    :param include_summaries: True면 각 레코드 요약(seq, tag, level, sha256) 전부 포함
    :param payload_hex_max: >0 이면 요약에 앞 N바이트 hex 추가
    """
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        return {"ok": False, "error": f"hwp5 import 실패: {e}"}

    path = os.path.abspath(hwp_path)
    if not os.path.isfile(path):
        return {"ok": False, "error": f"파일 없음: {path}"}

    try:
        with closing(Hwp5File(path)) as hwp:
            if hwp.header.flags.password:
                return {
                    "ok": False,
                    "error": "암호 보호 문서는 레코드 스캔 생략 (hwp5 미복호화)",
                }

            version = list(hwp.header.version)
            streams_out: list[dict[str, Any]] = []

            distributable = bool(hwp.header.flags.distributable)
            text_storage = "ViewText" if distributable else "BodyText"

            # DocInfo
            di_raw = hwp.docinfo.open().read()
            di_scan = _scan_decompressed_stream(di_raw, "DocInfo")
            recs = di_scan.pop("records")
            if include_summaries:
                di_scan["record_summaries"] = _records_to_summaries(recs, payload_hex_max)
            else:
                di_s = _records_to_summaries(recs, 0)
                di_scan["record_index_sample"] = di_s[: min(30, len(di_s))]
            streams_out.append(di_scan)

            # 본문: 일반 문서 BodyText, 배포용(distributable) ViewText — hwp5 가 hwp.text로 통일
            text = hwp.text
            sec_indexes = text.section_indexes()
            for idx in sec_indexes:
                section = text.section(idx)
                label = f"{text_storage}/Section{idx}"
                raw = section.open().read()
                sec_scan = _scan_decompressed_stream(raw, label)
                recs = sec_scan.pop("records")
                if include_summaries:
                    sec_scan["record_summaries"] = _records_to_summaries(recs, payload_hex_max)
                else:
                    ssum = _records_to_summaries(recs, 0)
                    sec_scan["record_index_sample"] = ssum[:15]
                    sec_scan["record_index_tail_sample"] = (
                        ssum[-5:] if len(ssum) > 20 else []
                    )
                sec_scan["section_index"] = idx
                streams_out.append(sec_scan)

            total_recs = sum(s["record_count"] for s in streams_out)
            all_rt = all(s["roundtrip_serialize_ok"] for s in streams_out)

            report: dict[str, Any] = {
                "ok": True,
                "error": None,
                "hwp_version": version,
                "distributable": distributable,
                "text_storage": text_storage,
                "streams_scanned": len(streams_out),
                "body_section_indexes": sec_indexes,
                "total_records": total_recs,
                "all_streams_roundtrip_ok": all_rt,
                "streams": streams_out,
            }
            return report

    except InvalidHwp5FileError as e:
        return {"ok": False, "error": str(e)}


def dump_records_json(
    hwp_path: str,
    out_path: str,
    *,
    full_payload_hex: bool = False,
) -> dict[str, Any]:
    """전 레코드를 JSON 파일로 (payload_hex 전체 또는 sha256만)."""
    from hwp5.errors import InvalidHwp5FileError
    from hwp5.xmlmodel import Hwp5File

    path = os.path.abspath(hwp_path)
    if not os.path.isfile(path):
        return {"ok": False, "error": f"파일 없음: {path}"}

    try:
        with closing(Hwp5File(path)) as hwp:
            if hwp.header.flags.password:
                return {"ok": False, "error": "암호 문서는 제외"}

            version = list(hwp.header.version)
            distributable = bool(hwp.header.flags.distributable)
            text_storage = "ViewText" if distributable else "BodyText"

            def export_stream(label: str, raw: bytes) -> dict[str, Any]:
                scanned = _scan_decompressed_stream(raw, label)
                recs = scanned.pop("records")
                rows = []
                for rec in recs:
                    p = rec["payload"]
                    row = {
                        "seqno": rec.get("seqno"),
                        "tagid": rec["tagid"],
                        "tagname": _tag_name(rec["tagid"]),
                        "level": rec["level"],
                        "payload_size": len(p),
                        "payload_sha256": hashlib.sha256(p).hexdigest(),
                    }
                    if full_payload_hex:
                        row["payload_hex"] = p.hex()
                    else:
                        row["payload_hex_head"] = (
                            p[:32].hex() if len(p) > 32 else p.hex()
                        )
                    rows.append(row)
                scanned["records"] = rows
                return scanned

            streams = [export_stream("DocInfo", hwp.docinfo.open().read())]
            text = hwp.text
            for idx in text.section_indexes():
                streams.append(
                    export_stream(
                        f"{text_storage}/Section{idx}",
                        text.section(idx).open().read(),
                    )
                )

            all_rt = all(s["roundtrip_serialize_ok"] for s in streams)

            out_obj = {
                "input": path,
                "hwp_version": version,
                "distributable": distributable,
                "text_storage": text_storage,
                "all_streams_roundtrip_ok": all_rt,
                "streams": streams,
            }
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(out_obj, f, ensure_ascii=False, indent=2)
            return {"ok": True, "wrote": out_path, "streams": len(streams)}
    except InvalidHwp5FileError as e:
        return {"ok": False, "error": str(e)}
