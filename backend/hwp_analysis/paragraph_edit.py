# -*- coding: utf-8 -*-
"""
MVP 의미 편집: 한 문단이 «가시 텍스트 조각 하나 + PARAGRAPH_BREAK(0x0d)» 인 경우에 한해
ParaText·ParaHeader(chars)를 갱신하고 Section zlib·OLE repack까지 수행.

- ParaCharShape: 페어가 정확히 하나이고 시작 위치가 0인 경우만 허용 (전 구간 동일 모양).
- ParaLineSeg: 이 MVP에서는 그대로 둠(한줄·짧은 칸 위주면 한글 쪽에서 재배치되는 경우가 많음).

표 안 빈 칸 등 레벨이 깊어도, 위 조건만 맞으면 동일하게 동작.
"""

from __future__ import annotations

import os
import struct
from contextlib import closing
from io import BytesIO
from typing import Any

# hwp5.tagids.HWPTAG_BEGIN == 0x10 (모듈 임포트 없이 상수만 사용)
_PARA_BASE = 0x10
PARA_HEADER = _PARA_BASE + 50
PARA_TEXT = _PARA_BASE + 51
PARA_CHAR_SHAPE = _PARA_BASE + 52

_P_BREAK = b"\x0d\x00"


def _read_records(decompressed: bytes) -> list[dict[str, Any]]:
    from hwp5.recordstream import read_record

    f = BytesIO(decompressed)
    seq = 0
    out: list[dict[str, Any]] = []
    while True:
        rec = read_record(f, seq)
        if rec is None:
            break
        out.append(rec)
        seq += 1
    tail = f.read()
    if tail:
        raise ValueError(f"섹션 스트림 끝에 잔여 바이트 {len(tail)}")
    return out


def _serialize_records(records: list[dict[str, Any]]) -> bytes:
    from hwp5.recordstream import dump_record

    buf = BytesIO()
    for rec in records:
        dump_record(buf, rec)
    return buf.getvalue()


def _find_paragraph_header_index(records: list[dict[str, Any]], text_idx: int) -> int:
    lvl = records[text_idx]["level"]
    if lvl < 1:
        raise ValueError("PARA_TEXT 레벨이 0 이하")
    want = lvl - 1
    for j in range(text_idx - 1, -1, -1):
        if records[j]["tagid"] == PARA_HEADER and records[j]["level"] == want:
            return j
    raise ValueError("PARA_HEADER(부모 문단)를 찾지 못함")


def _validate_plain_para_text_tail(payload: bytes) -> None:
    if len(payload) < 2 or not payload.endswith(_P_BREAK):
        raise ValueError("ParaText는 UTF-16LE로 끝나야 함: ... 0d 00 (PARAGRAPH_BREAK)")
    from hwp5.binmodel.tagid51_para_text import ParaTextChunks

    chunks = list(ParaTextChunks.parse_chunks(payload))
    if len(chunks) != 2:
        raise ValueError(
            "MVP: ParaText 청크는 [가시문자열]+[문단끝] 두 개만 허용 "
            f"(현재 {len(chunks)}청크, 표/필드 등 삽입 제어문자 있으면 실패)"
        )
    (_, _range_a), a = chunks[0]
    (_, _range_b), b = chunks[1]
    if not isinstance(a, str):
        raise ValueError("MVP: 첫 청크는 일반 텍스트여야 함")
    if not isinstance(b, dict) or b.get("code") != 0x0D:
        raise ValueError("MVP: 마지막은 PARAGRAPH_BREAK(0x0d)여야 함")


def _validate_charshape_single_from_zero(payload: bytes) -> None:
    if len(payload) != 8:
        raise ValueError(
            f"MVP: ParaCharShape 8바이트(시작 0인 단일 구간)만 허용, 실제 {len(payload)}"
        )
    pos0, _sid = struct.unpack("<II", payload)
    if pos0 != 0:
        raise ValueError("MVP: CharShape 첫 시작 위치는 0이어야 함")


def _patch_para_header_chars(payload: bytes, new_char_len: int) -> bytes:
    if new_char_len < 1 or (new_char_len & 0x7FFFFFFF) != new_char_len:
        raise ValueError("문자 수(UTF-16 유닛·제어포함) 범위 오류")
    data = bytearray(payload)
    if len(data) < 4:
        raise ValueError("ParaHeader 짧음")
    old = struct.unpack_from("<I", data, 0)[0]
    new_u32 = (old & 0x8000_0000) | (new_char_len & 0x7FFFFFFF)
    struct.pack_into("<I", data, 0, new_u32)
    return bytes(data)


def _neighbor_char_shape_payload(
    records: list[dict[str, Any]], text_idx: int
) -> bytes | None:
    if text_idx + 1 < len(records) and records[text_idx + 1]["tagid"] == PARA_CHAR_SHAPE:
        return records[text_idx + 1]["payload"]
    return None


def patch_records_simple_paragraph_text(
    records: list[dict[str, Any]],
    para_text_seqno: int,
    new_visible_text: str,
) -> dict[str, Any]:
    if "\x00" in new_visible_text:
        raise ValueError("널 문자는 넣을 수 없음")
    if not isinstance(new_visible_text, str):
        raise TypeError("new_visible_text는 str")

    if para_text_seqno < 0 or para_text_seqno >= len(records):
        raise IndexError("para_text_seqno 범위 밖")

    trec = records[para_text_seqno]
    if trec["tagid"] != PARA_TEXT:
        raise ValueError(f"seq {para_text_seqno}는 PARA_TEXT가 아님")

    old_payload = trec["payload"]
    _validate_plain_para_text_tail(old_payload)

    csp = _neighbor_char_shape_payload(records, para_text_seqno)
    if csp is not None:
        _validate_charshape_single_from_zero(csp)

    new_body = new_visible_text.encode("utf-16-le") + _P_BREAK
    new_char_len = len(new_body) // 2

    hdr_idx = _find_paragraph_header_index(records, para_text_seqno)
    hrec = records[hdr_idx]
    new_hdr_payload = _patch_para_header_chars(hrec["payload"], new_char_len)

    records = [dict(r) for r in records]
    records[para_text_seqno] = {
        **trec,
        "payload": new_body,
        "size": len(new_body),
    }
    records[hdr_idx] = {**hrec, "payload": new_hdr_payload, "size": len(new_hdr_payload)}

    return {
        "records": records,
        "para_header_index": hdr_idx,
        "para_text_index": para_text_seqno,
        "old_char_len": len(old_payload) // 2,
        "new_char_len": new_char_len,
    }


def inject_paratext_into_empty_paragraph(
    records: list[dict[str, Any]],
    para_header_seqno: int,
    new_visible_text: str,
) -> dict[str, Any]:
    """
    PARA_HEADER 만 있고 PARA_TEXT 가 없는 «진짜 빈 문단»에 새 PARA_TEXT 레코드를 삽입.
    PARA_CHAR_SHAPE 는 보통 PARA_HEADER 직후에 위치하므로 그 앞에 PARA_TEXT 를 끼워 넣는다.
    PARA_LINE_SEG 는 한컴이 보수적으로 재계산하는 경향이 있어 그대로 둔다.
    """
    if "\x00" in new_visible_text:
        raise ValueError("널 문자는 넣을 수 없음")
    if not isinstance(new_visible_text, str):
        raise TypeError("new_visible_text는 str")
    if not new_visible_text:
        raise ValueError("빈 문자열은 의미 없음")

    if para_header_seqno < 0 or para_header_seqno >= len(records):
        raise IndexError("para_header_seqno 범위 밖")
    hrec = records[para_header_seqno]
    if hrec["tagid"] != PARA_HEADER:
        raise ValueError(f"seq {para_header_seqno}는 PARA_HEADER 가 아님")
    h_level = hrec["level"]

    j = para_header_seqno + 1
    while j < len(records) and records[j]["level"] > h_level:
        if records[j]["tagid"] == PARA_TEXT:
            raise ValueError(
                f"이 PARA_HEADER 자식에 이미 PARA_TEXT(seq={records[j]['seqno']})가 있음"
            )
        j += 1
    insert_idx = para_header_seqno + 1

    new_body = new_visible_text.encode("utf-16-le") + _P_BREAK
    new_char_len = len(new_body) // 2
    new_text_rec = {
        "tagid": PARA_TEXT,
        "level": h_level + 1,
        "size": len(new_body),
        "payload": new_body,
        "seqno": -1,
    }

    new_hdr_payload = _patch_para_header_chars(hrec["payload"], new_char_len)

    records = [dict(r) for r in records]
    records[para_header_seqno] = {**hrec, "payload": new_hdr_payload, "size": len(new_hdr_payload)}
    records.insert(insert_idx, new_text_rec)
    for k in range(len(records)):
        records[k] = {**records[k], "seqno": k}

    return {
        "records": records,
        "para_header_index": para_header_seqno,
        "inserted_para_text_index": insert_idx,
        "new_char_len": new_char_len,
    }


def inject_paratext_into_empty_paragraph_file(
    hwp_path: str,
    out_hwp: str,
    *,
    section_index: int = 0,
    para_header_seqno: int,
    new_visible_text: str,
    verify_repack: bool = True,
) -> dict[str, Any]:
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        return {"ok": False, "error": f"hwp5: {e}"}

    from .hwp_repack import repack_hwp_with_stream_overrides
    from .zlib_layer import zlib_raw_deflate

    hwp_path = os.path.abspath(hwp_path)
    out_hwp = os.path.abspath(out_hwp)
    if not os.path.isfile(hwp_path):
        return {"ok": False, "error": f"없음: {hwp_path}"}

    try:
        with closing(Hwp5File(hwp_path)) as hwp:
            if hwp.header.flags.password:
                return {"ok": False, "error": "암호 문서 불가"}
            body_name = "ViewText" if hwp.header.flags.distributable else "BodyText"
            sec_indexes = hwp.text.section_indexes()
            if section_index not in sec_indexes:
                return {"ok": False, "error": f"section_index={section_index} 없음"}
            dec = hwp.text.section(section_index).open().read()

        records = _read_records(dec)
        info = inject_paratext_into_empty_paragraph(
            records, para_header_seqno, new_visible_text
        )
        new_dec = _serialize_records(info["records"])
        blob = zlib_raw_deflate(new_dec)
        stream_path = (body_name, f"Section{section_index}")
        rp = repack_hwp_with_stream_overrides(
            hwp_path, out_hwp, {stream_path: blob}, verify_open=verify_repack
        )
        if not rp.get("ok"):
            return rp
        return {
            "ok": True,
            "src": hwp_path,
            "dest": out_hwp,
            "stream_path": list(stream_path),
            "section_index": section_index,
            "para_header_seqno": para_header_seqno,
            "edit": {"new_char_len": info["new_char_len"]},
            "repack": rp,
        }
    except (InvalidHwp5FileError, ValueError, TypeError, IndexError) as e:
        return {"ok": False, "error": str(e)}


def edit_simple_paragraph_text_file(
    hwp_path: str,
    out_hwp: str,
    *,
    section_index: int = 0,
    para_text_seqno: int,
    new_visible_text: str,
    verify_repack: bool = True,
) -> dict[str, Any]:
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        return {"ok": False, "error": f"hwp5: {e}"}

    from .hwp_repack import repack_hwp_with_stream_overrides
    from .zlib_layer import zlib_raw_deflate

    hwp_path = os.path.abspath(hwp_path)
    out_hwp = os.path.abspath(out_hwp)

    if not os.path.isfile(hwp_path):
        return {"ok": False, "error": f"없음: {hwp_path}"}

    try:
        with closing(Hwp5File(hwp_path)) as hwp:
            if hwp.header.flags.password:
                return {"ok": False, "error": "암호 문서 불가"}
            body_name = "ViewText" if hwp.header.flags.distributable else "BodyText"
            sec_indexes = hwp.text.section_indexes()
            if section_index not in sec_indexes:
                return {
                    "ok": False,
                    "error": f"section_index={section_index} 없음: {sec_indexes}",
                }
            dec = hwp.text.section(section_index).open().read()

        records = _read_records(dec)
        info = patch_records_simple_paragraph_text(
            records, para_text_seqno, new_visible_text
        )
        new_dec = _serialize_records(info["records"])
        blob = zlib_raw_deflate(new_dec)

        stream_path = (body_name, f"Section{section_index}")
        rp = repack_hwp_with_stream_overrides(
            hwp_path,
            out_hwp,
            {stream_path: blob},
            verify_open=verify_repack,
        )
        if not rp.get("ok"):
            return rp

        return {
            "ok": True,
            "src": hwp_path,
            "dest": out_hwp,
            "stream_path": list(stream_path),
            "section_index": section_index,
            "para_text_seqno": para_text_seqno,
            "edit": {k: info[k] for k in ("old_char_len", "new_char_len") if k in info},
            "repack": rp,
        }

    except (InvalidHwp5FileError, ValueError, TypeError, IndexError) as e:
        return {"ok": False, "error": str(e)}
