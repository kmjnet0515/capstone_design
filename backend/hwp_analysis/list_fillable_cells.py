# -*- coding: utf-8 -*-
"""
HWP 본문 안 표를 훑어 «라벨 → 인접 빈 값 셀» 후보를 JSON 으로 출력한다.

판단 기준 (MVP):
  - 라벨 셀: 텍스트가 1자 이상 ~ 40자 이하, 끝 문자가 `:`/`：`/공백 허용
  - 값 셀: 같은 행 바로 옆 셀이 비어 있음(공백 제거 후 길이 0 or 「___」 같은 placeholder만)
  - 같은 행에 라벨/값 쌍이 여러 번 반복 가능 (label, value, label, value, ...)
  - PARA_TEXT 없는 빈 칸은 MVP 편집기가 못 다루므로 후보에서 제외
"""

from __future__ import annotations

import os
import re
from contextlib import closing
from typing import Any

from hwp5.tagids import HWPTAG_BEGIN

from .paragraph_edit import _read_records, PARA_HEADER, PARA_TEXT
from .table_label_edit import (
    _TBL,
    _CTRL,
    _LIST,
    _decode_para_visible_utf16,
    _parse_table_body_rowcols,
    _iter_table_cells_full,
    _group_rows,
)


_PLACEHOLDER_RE = re.compile(r"^[\s_\-\.·•\(\)\[\]▷▶■□◆◇★☆※]+$")
_LABEL_TRAILING_RE = re.compile(r"[:：\s]+$")
_HAS_LETTER_RE = re.compile(r"[가-힣A-Za-z]")

_UNIT_TOKENS = (
    "원", "백만원", "만원", "천원", "억원",
    "명", "인", "건", "회", "개", "대", "장", "권", "부", "병", "박스",
    "년", "월", "일", "시간", "분", "초", "주", "년차",
    "%", "퍼센트", "kg", "g", "톤", "L", "ml", "m", "cm", "mm", "km",
)
_UNIT_RE = re.compile(
    r"^(" + "|".join(re.escape(u) for u in _UNIT_TOKENS) + r")$"
)
_PAREN_HINT_RE = re.compile(r"^\(.{0,120}\)$", re.DOTALL)
_PAREN_FULL_RE = re.compile(r"\([^()]{0,120}\)", re.DOTALL)
_HINT_LEAD_SYMBOLS = ("※", "*", "▶", "▷", "■", "□", "◆", "◇", "★", "☆")


def _looks_like_hint_text(text: str) -> bool:
    """힌트성 안내 텍스트(※/괄호 시작 등)인지 — 긴 안내 문구도 잡는다."""
    s = (text or "").strip()
    if not s:
        return False
    if s.startswith(_HINT_LEAD_SYMBOLS):
        return True
    if s.startswith("(") and s.endswith(")") and len(s) <= 200:
        return True
    return False
_SHORT_INSTRUCTION_RE = re.compile(r"^(작성|기재|선택|입력|예시|예|샘플)$")


def _looks_like_unit_or_hint(text: str) -> bool:
    """
    값이 비어 있는 입력란이지만 단위/힌트가 적혀 있는 경우 (예: "백만원", "명",
    "(W×H×D)", "(필요시 기재)", "년 (    년차)"). 사용자가 채울 영역으로 본다.

    전략: 괄호로 감싸인 부분(공백 포함)은 통째로 힌트로 보고 제거 → 남은 토큰이
    단위/짧은 지시어/플레이스홀더만 있으면 힌트성 빈 칸으로 간주.
    """
    s = (text or "").strip()
    if not s:
        return False
    if _UNIT_RE.match(s):
        return True
    if _PAREN_HINT_RE.match(s):
        return True
    if _SHORT_INSTRUCTION_RE.match(s):
        return True

    s_no_paren = _PAREN_FULL_RE.sub(" ", s).strip()
    if s_no_paren == "":
        return True

    parts = re.split(r"[\s\u3000]+", s_no_paren)
    has_unit_or_hint = False
    for p in parts:
        if not p:
            continue
        if _UNIT_RE.match(p) or _SHORT_INSTRUCTION_RE.match(p):
            has_unit_or_hint = True
            continue
        if _PLACEHOLDER_RE.match(p):
            continue
        return False
    return has_unit_or_hint


def _is_value_empty_or_hint(text: str) -> bool:
    s = (text or "").strip()
    if not s:
        return True
    if _PLACEHOLDER_RE.match(s):
        return True
    if _looks_like_unit_or_hint(s):
        return True
    if _looks_like_hint_text(s):
        return True
    return False


def _is_label_candidate(text: str) -> bool:
    s = _LABEL_TRAILING_RE.sub("", (text or "").strip())
    if not s:
        return False
    if len(s) > 40:
        return False
    if _PLACEHOLDER_RE.match(s):
        return False
    if not _HAS_LETTER_RE.search(s):
        return False
    if _looks_like_unit_or_hint(s):
        return False
    if _looks_like_hint_text(s):
        return False
    return True


def _normalize_label(text: str) -> str:
    return _LABEL_TRAILING_RE.sub("", (text or "").strip())


def _detect_transposed_layout(rows: list[list[tuple[str, int | None]]]) -> bool:
    """
    첫 행이 모두 라벨(상품 1/상품 2/상품 3) 이고
    첫 열이 row_count-1 개 이상 라벨(상품명/상품재질…) 이면 transposed.
    """
    if len(rows) < 3:
        return False
    header_row = rows[0]
    if len(header_row) < 2:
        return False
    header_labels = [_normalize_label(c[0]) for c in header_row]
    if not all(_is_label_candidate(h) for h in header_labels[1:]):
        return False
    label_col = [_normalize_label(r[0][0]) if r else "" for r in rows[1:]]
    label_like = sum(1 for s in label_col if _is_label_candidate(s))
    return label_like >= max(1, len(label_col) // 2)


def _detect_transposed_layout(rows_meta: list[list[dict[str, Any]]]) -> bool:
    if len(rows_meta) < 3:
        return False
    header_row = rows_meta[0]
    if len(header_row) < 2:
        return False
    header_labels = [_normalize_label(c["text"]) for c in header_row]
    if not all(_is_label_candidate(h) for h in header_labels[1:]):
        return False
    label_col = [_normalize_label(r[0]["text"]) if r else "" for r in rows_meta[1:]]
    label_like = sum(1 for s in label_col if _is_label_candidate(s))
    return label_like >= max(1, len(label_col) // 2)


def _is_subsection_header_row(row_meta: list[dict[str, Any]]) -> bool:
    """모든 셀이 짧은 라벨이고 3개 이상이면 transposed 서브섹션 헤더로 본다.
    예: «구분 | 상품 1 | 상품 2 | 상품 3»."""
    if len(row_meta) < 3:
        return False
    labels = [_normalize_label(c["text"]) for c in row_meta]
    return all(_is_label_candidate(s) for s in labels)


def _make_field(*, section_index, table_index, ri, label_col, value_col,
                label_text, cell_meta, kind, composed_label=None, header_label=None):
    base = {
        "section_index": section_index,
        "table_index": table_index,
        "row_index": ri,
        "label_col": label_col,
        "value_col": value_col,
        "label_text": label_text,
        "value_preview": (cell_meta["text"] or "").strip(),
        "kind": kind,
    }
    if composed_label:
        base["composed_label"] = composed_label
    if header_label:
        base["header_label"] = header_label

    if cell_meta["first_pt"] is not None:
        base["value_para_text_seqno"] = cell_meta["first_pt"]
        base["needs_inject"] = False
    else:
        if cell_meta["first_para_hdr"] is None:
            return None
        base["value_para_header_seqno"] = cell_meta["first_para_hdr"]
        base["needs_inject"] = True
    return base


def _extract_fields_pairwise(
    section_index: int,
    table_index: int,
    rows_meta: list[list[dict[str, Any]]],
    *,
    skip_rows: set[int] | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    skip = skip_rows or set()
    for ri, row in enumerate(rows_meta):
        if ri in skip:
            continue
        ci = 0
        while ci < len(row) - 1:
            label_meta = row[ci]
            value_meta = row[ci + 1]
            label_text = label_meta["text"]
            value_text = value_meta["text"]
            value_truly_empty = (
                value_meta["first_pt"] is None and value_meta["first_para_hdr"] is not None
            )
            if (
                _is_label_candidate(label_text)
                and (_is_value_empty_or_hint(value_text) or value_truly_empty)
            ):
                f = _make_field(
                    section_index=section_index,
                    table_index=table_index,
                    ri=ri,
                    label_col=ci,
                    value_col=ci + 1,
                    label_text=_normalize_label(label_text),
                    cell_meta=value_meta,
                    kind="table_label",
                )
                if f is not None:
                    out.append(f)
                    ci += 2
                    continue
            ci += 1
    return out


def _extract_fields_vertical(
    section_index: int,
    table_index: int,
    rows_meta: list[list[dict[str, Any]]],
    *,
    used_rows: set[int] | None = None,
) -> list[dict[str, Any]]:
    """
    세로 라벨-값 패턴: row N이 1셀짜리 라벨, row N+1이 비어 있거나 힌트만.
    예) [제 품 명] / [______]  → row N+1을 fillable 로 본다.
    값 행에 셀이 여러 개면 각각 별도 필드로(라벨 옆에 (1)/(2) 합성).
    """
    out: list[dict[str, Any]] = []
    used = used_rows if used_rows is not None else set()
    n = len(rows_meta)
    i = 0
    while i < n - 1:
        if i in used or (i + 1) in used:
            i += 1
            continue
        cur = rows_meta[i]
        nxt = rows_meta[i + 1]
        if len(cur) != 1:
            i += 1
            continue
        label = _normalize_label(cur[0]["text"])
        if not _is_label_candidate(label):
            i += 1
            continue
        if len(label) > 20:
            i += 1
            continue
        if not nxt:
            i += 1
            continue

        any_label_in_next = any(
            _is_label_candidate(_normalize_label(c["text"])) for c in nxt
        )
        if any_label_in_next:
            i += 1
            continue

        candidates = []
        for ci, value_meta in enumerate(nxt):
            value_text = value_meta["text"]
            truly_empty = (
                value_meta["first_pt"] is None and value_meta["first_para_hdr"] is not None
            )
            if _is_value_empty_or_hint(value_text) or truly_empty:
                candidates.append((ci, value_meta))

        if not candidates:
            i += 1
            continue

        for k, (ci, value_meta) in enumerate(candidates):
            composed = label if len(candidates) == 1 else f"{label} ({k + 1})"
            f = _make_field(
                section_index=section_index,
                table_index=table_index,
                ri=i + 1,
                label_col=0,
                value_col=ci,
                label_text=label,
                cell_meta=value_meta,
                kind="table_label_vertical",
                composed_label=composed if composed != label else None,
            )
            if f is not None:
                out.append(f)
        used.add(i)
        used.add(i + 1)
        i += 2
    return out


def _extract_fields_mixed(
    section_index: int,
    table_index: int,
    rows_meta: list[list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], str]:
    """
    표 안에서 서브섹션 헤더 행을 찾고, 그 다음부터 다음 헤더(또는 표 끝)까지를
    transposed 데이터 영역으로 처리. 나머지 행은 pairwise로 처리.
    """
    out: list[dict[str, Any]] = []
    n = len(rows_meta)
    used_rows: set[int] = set()
    layouts_used: list[str] = []

    i = 0
    while i < n:
        row = rows_meta[i]
        if _is_subsection_header_row(row):
            headers = [_normalize_label(c["text"]) for c in row]
            j = i + 1
            data_rows: list[int] = []
            while j < n and not _is_subsection_header_row(rows_meta[j]):
                drow = rows_meta[j]
                if drow:
                    first_label = _normalize_label(drow[0]["text"])
                    if _is_label_candidate(first_label):
                        data_rows.append(j)
                j += 1
            if len(data_rows) >= 2:
                for ri in data_rows:
                    drow = rows_meta[ri]
                    row_label = _normalize_label(drow[0]["text"])
                    for ci in range(1, len(drow)):
                        value_meta = drow[ci]
                        value_text = value_meta["text"]
                        truly_empty = (
                            value_meta["first_pt"] is None
                            and value_meta["first_para_hdr"] is not None
                        )
                        if not (_is_value_empty_or_hint(value_text) or truly_empty):
                            continue
                        col_header = headers[ci] if ci < len(headers) else f"col{ci}"
                        f = _make_field(
                            section_index=section_index,
                            table_index=table_index,
                            ri=ri,
                            label_col=0,
                            value_col=ci,
                            label_text=row_label,
                            cell_meta=value_meta,
                            kind="table_transposed",
                            composed_label=f"{col_header} {row_label}".strip(),
                            header_label=col_header,
                        )
                        if f is not None:
                            out.append(f)
                    used_rows.add(ri)
                used_rows.add(i)
                layouts_used.append("transposed")
                i = j
                continue
        i += 1

    vert_fields = _extract_fields_vertical(
        section_index, table_index, rows_meta, used_rows=used_rows
    )
    if vert_fields:
        layouts_used.append("vertical")
    out.extend(vert_fields)

    pair_fields = _extract_fields_pairwise(
        section_index, table_index, rows_meta, skip_rows=used_rows
    )
    if pair_fields:
        layouts_used.append("pairwise")
    out.extend(pair_fields)

    layout = "+".join(sorted(set(layouts_used))) or "pairwise"
    return out, layout


def _extract_fields_transposed(
    section_index: int,
    table_index: int,
    rows_meta: list[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not rows_meta:
        return []
    header_row = rows_meta[0]
    headers = [_normalize_label(c["text"]) for c in header_row]
    out: list[dict[str, Any]] = []
    for ri in range(1, len(rows_meta)):
        row = rows_meta[ri]
        if not row:
            continue
        row_label = _normalize_label(row[0]["text"])
        if not _is_label_candidate(row_label):
            continue
        for ci in range(1, len(row)):
            value_meta = row[ci]
            value_text = value_meta["text"]
            value_truly_empty = (
                value_meta["first_pt"] is None and value_meta["first_para_hdr"] is not None
            )
            if not (_is_value_empty_or_hint(value_text) or value_truly_empty):
                continue
            col_header = headers[ci] if ci < len(headers) else f"col{ci}"
            f = _make_field(
                section_index=section_index,
                table_index=table_index,
                ri=ri,
                label_col=0,
                value_col=ci,
                label_text=row_label,
                cell_meta=value_meta,
                kind="table_transposed",
                composed_label=f"{col_header} {row_label}".strip(),
                header_label=col_header,
            )
            if f is not None:
                out.append(f)
    return out


def list_fillable_cells_in_file(hwp_path: str) -> dict[str, Any]:
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        return {"ok": False, "error": f"hwp5: {e}"}

    path = os.path.abspath(hwp_path)
    try:
        with closing(Hwp5File(path)) as hwp:
            if hwp.header.flags.password:
                return {"ok": False, "error": "암호 문서 불가"}
            ver = hwp.header.version
            sec_indexes = list(hwp.text.section_indexes())
            sections_decoded: list[bytes] = []
            for si in sec_indexes:
                sections_decoded.append(hwp.text.section(si).open().read())
    except InvalidHwp5FileError as e:
        return {"ok": False, "error": str(e)}

    all_fields: list[dict[str, Any]] = []
    sections_summary: list[dict[str, Any]] = []

    for si, dec in zip(sec_indexes, sections_decoded):
        records = _read_records(dec)
        body_indices = [i for i, r in enumerate(records) if r["tagid"] == _TBL]
        section_tables: list[dict[str, Any]] = []

        for ti, body_i in enumerate(body_indices):
            if body_i < 1 or records[body_i - 1]["tagid"] != _CTRL:
                continue
            rowcols = _parse_table_body_rowcols(records[body_i], ver)
            if not rowcols:
                continue
            try:
                flat_full = _iter_table_cells_full(records, body_i)
                meta_pairs = [(c["text"], c) for c in flat_full]
                rows_meta_pairs = _group_rows(meta_pairs, rowcols)
                rows_meta = [[c for (_, c) in row] for row in rows_meta_pairs]
            except Exception as exc:
                section_tables.append({
                    "table_index": ti,
                    "ok": False,
                    "error": f"표 파싱 실패: {exc}",
                })
                continue

            if _detect_transposed_layout(rows_meta):
                table_fields = _extract_fields_transposed(si, ti, rows_meta)
                layout = "transposed"
            else:
                table_fields, layout = _extract_fields_mixed(si, ti, rows_meta)

            section_tables.append({
                "table_index": ti,
                "ok": True,
                "layout": layout,
                "row_count": len(rows_meta),
                "fillable_count": len(table_fields),
            })
            all_fields.extend(table_fields)

        sections_summary.append({
            "section_index": si,
            "table_count": len(body_indices),
            "tables": section_tables,
        })

    return {
        "ok": True,
        "format": "hwp",
        "path": path,
        "sections": sections_summary,
        "fields": all_fields,
    }
