# -*- coding: utf-8 -*-
"""
OWPML 표에서 라벨 열로 행을 찾아 값 열(tc)의 텍스트 런을 갱신.

``hp:tbl`` / ``hp:tr`` / ``hp:tc`` 로컬명(접두 네임스페이스 무관)을 사용.
"""

from __future__ import annotations

import io
import os
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

from .opc_manifest import discover_section_members, resolve_section_member
from .package_zip import repackage_with_overrides

_LABEL_TRAILING_RE = re.compile(r"[:：\s]+$")


def _normalize_label_compare(text: str) -> str:
    s = (text or "").strip()
    s = unicodedata.normalize("NFKC", s)
    return _LABEL_TRAILING_RE.sub("", s)


def _label_key_loose(text: str) -> str:
    """시각적 공백/제로폭만 다를 때 동일 항목으로 취급 (예: '업 체 명' vs '업체명')."""
    s = unicodedata.normalize("NFKC", text or "")
    return re.sub(r"[\s\u00a0\u3000\u200b\ufeff]+", "", s)


def _labels_match(lab_cell: str, label_text: str) -> bool:
    a = _normalize_label_compare(lab_cell)
    b = _normalize_label_compare(label_text)
    if a == b:
        return True
    return _label_key_loose(a) == _label_key_loose(b)


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _tc_plain_text(tc: ET.Element) -> str:
    parts: list[str] = []
    for el in tc.iter():
        if _local_name(el.tag) != "t":
            continue
        if el.text:
            parts.append(el.text)
        for ch in el:
            if ch.tail:
                parts.append(ch.tail)
    return "".join(parts).strip()


def _find_first_run_or_p(tc: ET.Element):
    """셀 안 첫 ``run`` 또는 ``p`` 요소(없으면 None)."""
    for el in tc.iter():
        ln = _local_name(el.tag)
        if ln in ("run", "p"):
            return el
    return None


def _ensure_t_in_tc(tc: ET.Element) -> ET.Element:
    """
    빈 표 셀(``tc``)에 ``<hp:t>`` 가 없으면 새로 만들어 첫 ``run``(또는 ``p``)
    안에 추가하고 그 ``t`` 를 반환. 이미 있으면 첫 ``t`` 반환.
    네임스페이스는 부모와 동일하게 맞춘다(보통 ``hp:`` 접두 사용).
    """
    ts = [e for e in tc.iter() if _local_name(e.tag) == "t"]
    if ts:
        return ts[0]

    parent = _find_first_run_or_p(tc) or tc
    if parent.tag.startswith("{"):
        ns = parent.tag.split("}", 1)[0][1:]
        new_tag = f"{{{ns}}}t"
    else:
        new_tag = "t"
    new_t = ET.SubElement(parent, new_tag)
    new_t.text = ""
    return new_t


def _set_tc_plain_text(tc: ET.Element, new_text: str) -> int:
    """셀 안 모든 ``t`` 런을 첫 런에 합치고 나머지 비움. 변경된 ``t`` 개수.
    ``t`` 가 하나도 없으면 새로 만든다(빈 셀 채우기)."""
    ts = [e for e in tc.iter() if _local_name(e.tag) == "t"]
    if not ts:
        first = _ensure_t_in_tc(tc)
        first.text = new_text
        return 1
    first = ts[0]
    for ch in list(first):
        first.remove(ch)
    first.text = new_text
    for o in ts[1:]:
        o.text = ""
        for ch in list(o):
            o.remove(ch)
    return len(ts)


def _iter_tbl_depth_first(root: ET.Element):
    for el in root.iter():
        if _local_name(el.tag) == "tbl":
            yield el


def _tr_children(tbl: ET.Element) -> list[ET.Element]:
    return [c for c in tbl if _local_name(c.tag) == "tr"]


def _tc_children(tr: ET.Element) -> list[ET.Element]:
    return [c for c in tr if _local_name(c.tag) == "tc"]


def patch_section_xml_table_label(
    xml_bytes: bytes,
    *,
    table_index: int,
    label_text: str,
    label_col: int = 0,
    value_col: int = 1,
    new_value: str,
) -> tuple[bytes, dict[str, Any]]:
    label_ref = label_text or ""
    root = ET.fromstring(xml_bytes)
    tbls = list(_iter_tbl_depth_first(root))
    if table_index >= len(tbls):
        raise ValueError(f"table_index={table_index} 초과 (표 {len(tbls)}개)")
    tbl = tbls[table_index]
    meta: dict[str, Any] = {"rows_scanned": 0, "matched_row": None}
    for ri, tr in enumerate(_tr_children(tbl)):
        meta["rows_scanned"] = ri + 1
        cells = _tc_children(tr)
        if label_col >= len(cells) or value_col >= len(cells):
            continue
        lab = _tc_plain_text(cells[label_col])
        if not _labels_match(lab, label_ref):
            continue
        n = _set_tc_plain_text(cells[value_col], new_value)
        meta["matched_row"] = ri
        meta["t_nodes_touched"] = n
        buf = io.BytesIO()
        ET.ElementTree(root).write(buf, encoding="UTF-8", xml_declaration=True)
        return buf.getvalue(), meta
    raise ValueError(f"라벨 {_normalize_label_compare(label_ref)!r} 행 없음")


def patch_section_xml_table_at(
    xml_bytes: bytes,
    *,
    table_index: int,
    row_index: int,
    value_col: int,
    new_value: str,
) -> tuple[bytes, dict[str, Any]]:
    root = ET.fromstring(xml_bytes)
    tbls = list(_iter_tbl_depth_first(root))
    if table_index >= len(tbls):
        raise ValueError(f"table_index={table_index} 초과 (표 {len(tbls)}개)")
    tbl = tbls[table_index]
    rows = _tr_children(tbl)
    if row_index < 0 or row_index >= len(rows):
        raise ValueError(f"row_index={row_index} 범위 밖 (행 {len(rows)})")
    cells = _tc_children(rows[row_index])
    if value_col < 0 or value_col >= len(cells):
        raise ValueError(f"value_col={value_col} 범위 밖 (셀 {len(cells)})")
    n = _set_tc_plain_text(cells[value_col], new_value)
    buf = io.BytesIO()
    ET.ElementTree(root).write(buf, encoding="UTF-8", xml_declaration=True)
    return buf.getvalue(), {"matched_row": row_index, "t_nodes_touched": n}


def edit_hwpx_table_value_at_position(
    hwpx_in: str,
    hwpx_out: str,
    *,
    section_path: str | None = None,
    table_index: int = 0,
    row_index: int,
    value_col: int,
    new_value: str,
) -> dict[str, Any]:
    """위치(row_index/value_col)로 셀을 직접 찾아 텍스트 갱신."""
    hwpx_in = os.path.abspath(hwpx_in)
    hwpx_out = os.path.abspath(hwpx_out)
    if not zipfile.is_zipfile(hwpx_in):
        return {"ok": False, "error": "ZIP 아님"}

    overrides: dict[str, bytes] = {}
    per_file: dict[str, Any] = {}
    touched = False

    with zipfile.ZipFile(hwpx_in, "r") as zf:
        names = zf.namelist()
        sections = discover_section_members(names)

    resolved = resolve_section_member(section_path, sections) if section_path else None
    if section_path and resolved is None:
        return {
            "ok": False,
            "error": f"section_path 없음: {section_path}",
            "sections_found": sections[:12],
        }
    targets = [resolved] if resolved else sections

    for sec in targets:
        with zipfile.ZipFile(hwpx_in, "r") as zf:
            raw = zf.read(sec)
        try:
            new_xml, meta = patch_section_xml_table_at(
                raw,
                table_index=table_index,
                row_index=row_index,
                value_col=value_col,
                new_value=new_value,
            )
        except ValueError as e:
            per_file[sec] = {"ok": False, "error": str(e)}
            continue
        overrides[sec] = new_xml
        per_file[sec] = {"ok": True, **meta}
        touched = True
        break

    if not touched:
        return {
            "ok": False,
            "error": "지정 위치 셀을 어떤 section*.xml 에서도 찾지 못함",
            "per_section": per_file,
        }

    rp = repackage_with_overrides(hwpx_in, hwpx_out, overrides)
    if not rp.get("ok"):
        return rp
    return {
        "ok": True,
        "src": hwpx_in,
        "dest": hwpx_out,
        "per_section": per_file,
        "repackage": rp,
    }


def edit_hwpx_table_value_by_label(
    hwpx_in: str,
    hwpx_out: str,
    *,
    section_path: str | None = None,
    table_index: int = 0,
    label_text: str,
    label_col: int = 0,
    value_col: int = 1,
    new_value: str,
) -> dict[str, Any]:
    hwpx_in = os.path.abspath(hwpx_in)
    hwpx_out = os.path.abspath(hwpx_out)
    if not zipfile.is_zipfile(hwpx_in):
        return {"ok": False, "error": "ZIP 아님"}

    overrides: dict[str, bytes] = {}
    per_file: dict[str, Any] = {}
    touched = False

    with zipfile.ZipFile(hwpx_in, "r") as zf:
        names = zf.namelist()
        sections = discover_section_members(names)

    resolved = resolve_section_member(section_path, sections) if section_path else None
    if section_path and resolved is None:
        return {
            "ok": False,
            "error": f"section_path 없음: {section_path}",
            "sections_found": sections[:12],
        }
    targets = [resolved] if resolved else sections

    for sec in targets:
        with zipfile.ZipFile(hwpx_in, "r") as zf:
            raw = zf.read(sec)
        try:
            new_xml, meta = patch_section_xml_table_label(
                raw,
                table_index=table_index,
                label_text=label_text,
                label_col=label_col,
                value_col=value_col,
                new_value=new_value,
            )
        except ValueError as e:
            per_file[sec] = {"ok": False, "error": str(e)}
            continue
        overrides[sec] = new_xml
        per_file[sec] = {"ok": True, **meta}
        touched = True

    if not touched:
        return {
            "ok": False,
            "error": "어느 section*.xml 에서도 라벨 행을 찾지 못함",
            "per_section": per_file,
        }

    rp = repackage_with_overrides(hwpx_in, hwpx_out, overrides)
    if not rp.get("ok"):
        return rp
    return {
        "ok": True,
        "src": hwpx_in,
        "dest": hwpx_out,
        "per_section": per_file,
        "repackage": rp,
    }
