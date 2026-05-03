# -*- coding: utf-8 -*-
"""
표에서 «라벨 열 텍스트»로 행을 찾아 «값 열»의 첫 ParaText 를 편집.

한컴 표 레이아웃: HWPTAG_TABLE(TableBody) 직후 LIST_HEADER 단위가 셀.
각 셀 안 첫 HWPTAG_PARA_TEXT 가 비어 있으면(바깥 칸) seq 가 없어 MVP 편집 불가.
"""

from __future__ import annotations

import os
import re
import unicodedata
from contextlib import closing
from io import BytesIO
from typing import Any

from hwp5.tagids import HWPTAG_BEGIN

from .paragraph_edit import edit_simple_paragraph_text_file
from .paragraph_edit import inject_paratext_into_empty_paragraph_file
from .paragraph_edit import (  # reuse read/parse helpers
    _read_records,
    PARA_HEADER,
    PARA_TEXT,
)

_TBL = HWPTAG_BEGIN + 61  # TableBody
_CTRL = HWPTAG_BEGIN + 55  # CTRL_HEADER
_LIST = HWPTAG_BEGIN + 56  # LIST_HEADER (셀)

_LABEL_TRAILING_RE = re.compile(r"[:：\s]+$")


def _normalize_label_compare(text: str) -> str:
    """표 라벨 셀과 입력 라벨 비교 시 NFKC·끝 ':', 공백 차이 무시."""
    s = (text or "").strip()
    s = unicodedata.normalize("NFKC", s)
    return _LABEL_TRAILING_RE.sub("", s)


def _label_key_loose(text: str) -> str:
    s = unicodedata.normalize("NFKC", text or "")
    return re.sub(r"[\s\u00a0\u3000\u200b\ufeff]+", "", s)


def _labels_match(lab_cell: str, label_text: str) -> bool:
    a = _normalize_label_compare(lab_cell)
    b = _normalize_label_compare(label_text)
    if a == b:
        return True
    return _label_key_loose(a) == _label_key_loose(b)


def _decode_para_visible_utf16(payload: bytes) -> str:
    from hwp5.binmodel.tagid51_para_text import ParaTextChunks

    parts: list[str] = []
    for _rng, chunk in ParaTextChunks.parse_chunks(payload):
        if isinstance(chunk, str):
            parts.append(chunk)
    return "".join(parts)


def _parse_table_body_rowcols(record: dict[str, Any], version: tuple) -> list[int]:
    from hwp5.binmodel import parse_models_intern

    for _ctx, model in parse_models_intern({"version": version}, [record]):
        rowcols = model.get("content", {}).get("rowcols")
        if rowcols is None:
            return []
        return [int(x) for x in rowcols]
    return []


def _iter_table_cells_flat(
    records: list[dict[str, Any]], table_body_index: int
) -> list[tuple[str, int | None]]:
    """후방 호환: (셀 가시문자열, 첫 PARA_TEXT seq 또는 None) 만 반환."""
    return [(c["text"], c["first_pt"]) for c in _iter_table_cells_full(records, table_body_index)]


def _iter_table_cells_full(
    records: list[dict[str, Any]], table_body_index: int
) -> list[dict[str, Any]]:
    """
    각 셀마다:
      text          : 가시 문자열 합본
      first_pt      : 첫 PARA_TEXT seqno (없으면 None)
      first_para_hdr: 첫 PARA_HEADER seqno (없으면 None)
      empty_para_hdrs : PARA_TEXT 자식이 없는 PARA_HEADER seqno 목록
    """
    if table_body_index >= len(records) or records[table_body_index]["tagid"] != _TBL:
        raise ValueError("table_body_index 가 HWPTAG_TABLE 이 아님")

    base_level = records[table_body_index]["level"]
    ctrl_level = records[table_body_index - 1]["level"] if table_body_index > 0 else -1
    i = table_body_index + 1
    out: list[dict[str, Any]] = []

    while i < len(records):
        r = records[i]
        if r["level"] <= ctrl_level:
            break
        if r["tagid"] == _LIST and r["level"] == base_level:
            list_level = r["level"]
            i += 1
            texts: list[str] = []
            first_pt: int | None = None
            first_hdr: int | None = None
            empty_hdrs: list[int] = []
            while i < len(records):
                r2 = records[i]
                if r2["tagid"] == _LIST and r2["level"] == list_level:
                    break
                if r2["level"] <= ctrl_level:
                    break
                if r2["tagid"] == PARA_HEADER:
                    ph_lvl = r2["level"]
                    ph_seq = r2["seqno"]
                    if first_hdr is None:
                        first_hdr = ph_seq
                    has_pt_in_this_para = False
                    i += 1
                    while i < len(records) and records[i]["level"] > ph_lvl:
                        if records[i]["tagid"] == PARA_TEXT:
                            has_pt_in_this_para = True
                            if first_pt is None:
                                first_pt = records[i]["seqno"]
                            texts.append(_decode_para_visible_utf16(records[i]["payload"]))
                        i += 1
                    if not has_pt_in_this_para:
                        empty_hdrs.append(ph_seq)
                    continue
                i += 1
            plain = "".join(texts).strip()
            out.append({
                "text": plain,
                "first_pt": first_pt,
                "first_para_hdr": first_hdr,
                "empty_para_hdrs": empty_hdrs,
            })
            continue
        i += 1
    return out


def _group_rows(
    flat: list[tuple[str, int | None]], rowcols: list[int]
) -> list[list[tuple[str, int | None]]]:
    rows = []
    k = 0
    for ncol in rowcols:
        rows.append(flat[k : k + ncol])
        k += ncol
    if k != len(flat):
        raise ValueError(
            f"표 셀 개수({len(flat)})와 rowcols 합({sum(rowcols)}) 불일치"
        )
    return rows


def find_value_cell_first_paratext_seq(
    hwp_path: str,
    *,
    section_index: int = 0,
    table_index: int = 0,
    label_text: str,
    label_col: int = 0,
    value_col: int = 1,
) -> dict[str, Any]:
    """라벨이 일치하는 행의 값 열 첫 PARA_TEXT seqno 검색 (편집 전 검증용)."""
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        return {"ok": False, "error": f"hwp5: {e}"}

    path = os.path.abspath(hwp_path)
    label_ref = label_text or ""

    try:
        with closing(Hwp5File(path)) as hwp:
            if hwp.header.flags.password:
                return {"ok": False, "error": "암호 문서 불가"}
            ver = hwp.header.version
            sec_indexes = hwp.text.section_indexes()
            if section_index not in sec_indexes:
                return {"ok": False, "error": f"section {section_index} 없음"}
            dec = hwp.text.section(section_index).open().read()
    except InvalidHwp5FileError as e:
        return {"ok": False, "error": str(e)}

    records = _read_records(dec)
    body_indices = [i for i, r in enumerate(records) if r["tagid"] == _TBL]
    if table_index >= len(body_indices):
        return {
            "ok": False,
            "error": f"table_index={table_index} 초과 (표 {len(body_indices)}개)",
        }
    body_i = body_indices[table_index]
    if body_i < 1 or records[body_i - 1]["tagid"] != _CTRL:
        return {"ok": False, "error": "표 앞 CTRL_HEADER 예상과 다름"}

    rowcols = _parse_table_body_rowcols(records[body_i], ver)
    if not rowcols:
        return {"ok": False, "error": "TableBody rowcols 파싱 실패"}

    flat_full = _iter_table_cells_full(records, body_i)
    flat = [(c["text"], c["first_pt"]) for c in flat_full]
    rows = _group_rows(flat, rowcols)
    rows_full = _group_rows([(c["text"], c) for c in flat_full], rowcols)

    for ri, row in enumerate(rows):
        if label_col >= len(row) or value_col >= len(row):
            continue
        lab, _ = row[label_col]
        if not _labels_match(lab, label_ref):
            continue
        _val_text, val_seq = row[value_col]
        cell_full = rows_full[ri][value_col][1]
        if val_seq is None:
            empty_hdr = cell_full["first_para_hdr"]
            if empty_hdr is None:
                return {
                    "ok": False,
                    "error": f"값 열 셀에 문단 자체가 없음. row={ri} 열={value_col}",
                }
            return {
                "ok": True,
                "para_text_seqno": None,
                "para_header_seqno_for_inject": empty_hdr,
                "table_body_seqno": records[body_i]["seqno"],
                "matched_row_index": ri,
                "value_preview": _val_text,
                "needs_inject": True,
            }
        return {
            "ok": True,
            "para_text_seqno": val_seq,
            "table_body_seqno": records[body_i]["seqno"],
            "matched_row_index": ri,
            "value_preview": _val_text,
            "needs_inject": False,
        }

    return {"ok": False, "error": f"라벨 {_normalize_label_compare(label_ref)!r} 행 없음"}


def find_value_cell_at_position(
    hwp_path: str,
    *,
    section_index: int = 0,
    table_index: int = 0,
    row_index: int,
    value_col: int,
) -> dict[str, Any]:
    """라벨 매칭 없이 (row_index, value_col) 로 직접 셀의 PARA_TEXT/PARA_HEADER 위치 반환."""
    try:
        from contextlib import closing
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        return {"ok": False, "error": f"hwp5: {e}"}

    if not os.path.isfile(hwp_path):
        return {"ok": False, "error": f"없음: {hwp_path}"}

    try:
        with closing(Hwp5File(hwp_path)) as hwp:
            ver = hwp.header.version
            sec_indexes = hwp.text.section_indexes()
            if section_index not in sec_indexes:
                return {"ok": False, "error": f"section_index={section_index} 없음"}
            dec = hwp.text.section(section_index).open().read()
        records = _read_records(dec)
        body_indices = [i for i, r in enumerate(records) if r["tagid"] == _TBL]
        if table_index < 0 or table_index >= len(body_indices):
            return {"ok": False, "error": f"table_index 범위 밖 (총 {len(body_indices)})"}
        body_i = body_indices[table_index]
        rowcols = _parse_table_body_rowcols(records[body_i], ver)
        if not rowcols:
            return {"ok": False, "error": "표 row/col 파싱 실패"}
        flat_full = _iter_table_cells_full(records, body_i)
        rows_full_pairs = _group_rows([(c["text"], c) for c in flat_full], rowcols)
        if row_index < 0 or row_index >= len(rows_full_pairs):
            return {"ok": False, "error": f"row_index={row_index} 범위 밖 (총 {len(rows_full_pairs)})"}
        row = rows_full_pairs[row_index]
        if value_col < 0 or value_col >= len(row):
            return {"ok": False, "error": f"value_col={value_col} 범위 밖 (행 길이 {len(row)})"}
        cell_meta = row[value_col][1]
        if cell_meta["first_pt"] is not None:
            return {
                "ok": True,
                "para_text_seqno": cell_meta["first_pt"],
                "needs_inject": False,
                "value_preview": cell_meta["text"],
            }
        if cell_meta["first_para_hdr"] is None:
            return {"ok": False, "error": "셀에 문단 자체가 없음"}
        return {
            "ok": True,
            "para_text_seqno": None,
            "para_header_seqno_for_inject": cell_meta["first_para_hdr"],
            "needs_inject": True,
            "value_preview": cell_meta["text"],
        }
    except (InvalidHwp5FileError, ValueError, TypeError, IndexError) as e:
        return {"ok": False, "error": str(e)}


def edit_table_value_at_position(
    hwp_path: str,
    out_hwp: str,
    *,
    section_index: int = 0,
    table_index: int = 0,
    row_index: int,
    value_col: int,
    new_visible_text: str,
) -> dict[str, Any]:
    loc = find_value_cell_at_position(
        hwp_path,
        section_index=section_index,
        table_index=table_index,
        row_index=row_index,
        value_col=value_col,
    )
    if not loc.get("ok"):
        return loc
    if loc.get("needs_inject"):
        ph = int(loc["para_header_seqno_for_inject"])
        ed = inject_paratext_into_empty_paragraph_file(
            hwp_path, out_hwp,
            section_index=section_index,
            para_header_seqno=ph,
            new_visible_text=new_visible_text,
            verify_repack=True,
        )
    else:
        seq = int(loc["para_text_seqno"])
        ed = edit_simple_paragraph_text_file(
            hwp_path, out_hwp,
            section_index=section_index,
            para_text_seqno=seq,
            new_visible_text=new_visible_text,
            verify_repack=True,
        )
    if not ed.get("ok"):
        return ed
    ed["table_position_match"] = loc
    return ed


def edit_table_value_by_label(
    hwp_path: str,
    out_hwp: str,
    *,
    section_index: int = 0,
    table_index: int = 0,
    label_text: str,
    label_col: int = 0,
    value_col: int = 1,
    new_visible_text: str,
) -> dict[str, Any]:
    loc = find_value_cell_first_paratext_seq(
        hwp_path,
        section_index=section_index,
        table_index=table_index,
        label_text=label_text,
        label_col=label_col,
        value_col=value_col,
    )
    if not loc.get("ok"):
        return loc
    if loc.get("needs_inject"):
        ph = int(loc["para_header_seqno_for_inject"])
        ed = inject_paratext_into_empty_paragraph_file(
            hwp_path,
            out_hwp,
            section_index=section_index,
            para_header_seqno=ph,
            new_visible_text=new_visible_text,
            verify_repack=True,
        )
    else:
        seq = int(loc["para_text_seqno"])
        ed = edit_simple_paragraph_text_file(
            hwp_path,
            out_hwp,
            section_index=section_index,
            para_text_seqno=seq,
            new_visible_text=new_visible_text,
            verify_repack=True,
        )
    if not ed.get("ok"):
        return ed
    ed["table_label_match"] = loc
    return ed
