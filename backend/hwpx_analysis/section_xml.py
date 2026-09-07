# -*- coding: utf-8 -*-
"""섹션 XML에서 OWPML 텍스트 노드(로컬명 ``t``) 수집·치환."""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
from typing import Any, Callable

# 너무 큰 파일 방지 (서버에서)
_MAX_SECTION_BYTES = 80 * 1024 * 1024


def _local_name(tag: str) -> str:
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def collect_text_runs(xml_bytes: bytes) -> list[dict[str, Any]]:
    """문서 순서대로 텍스트 런(hp:t 등, 로컬명이 ``t``인 요소) 수집."""
    if len(xml_bytes) > _MAX_SECTION_BYTES:
        raise ValueError("섹션 XML 이 너무 큼")

    root = ET.fromstring(xml_bytes)
    out: list[dict[str, Any]] = []
    idx = 0
    for el in root.iter():
        if _local_name(el.tag) != "t":
            continue
        parts: list[str] = []
        if el.text:
            parts.append(el.text)
        for ch in el:
            if ch.tail:
                parts.append(ch.tail)
        merged = "".join(parts)
        out.append(
            {
                "index": idx,
                "text": merged,
                "has_children": len(el) > 0,
            }
        )
        idx += 1
    return out


def section_plain_text(xml_bytes: bytes) -> str:
    runs = collect_text_runs(xml_bytes)
    return "".join(r["text"] for r in runs)


def walk_text_elements(root: ET.Element):
    for el in root.iter():
        if _local_name(el.tag) == "t":
            yield el


def patch_text_runs(
    xml_bytes: bytes,
    fn: Callable[[int, str], str],
) -> tuple[bytes, dict[str, Any]]:
    """
    각 텍스트 런에 대해 ``fn(run_index, old_text) -> new_text`` 적용.
    자식 요소가 있는 ``t`` 노드도 text/tail 을 단일 문자열로 합친 뒤 치환하면
    구조를 비우고 새 텍스트만 둔다(표 셀 단순 치환에 적합).
    """
    if len(xml_bytes) > _MAX_SECTION_BYTES:
        raise ValueError("섹션 XML 이 너무 큼")

    root = ET.fromstring(xml_bytes)
    changed = 0
    idx = 0
    for el in walk_text_elements(root):
        parts: list[str] = []
        if el.text:
            parts.append(el.text)
        for ch in list(el):
            if ch.tail:
                parts.append(ch.tail)
        old = "".join(parts)
        new = fn(idx, old)
        idx += 1
        if new != old:
            changed += 1
        for ch in list(el):
            el.remove(ch)
        el.text = new
        el.tail = None

    buf = io.BytesIO()
    enc = "UTF-8"
    tree = ET.ElementTree(root)
    tree.write(buf, encoding=enc, xml_declaration=True)
    return buf.getvalue(), {"runs_seen": idx, "runs_changed": changed}


def replace_all_substrings_in_sections(
    section_xml_bytes: dict[str, bytes],
    replacements: list[tuple[str, str]],
) -> tuple[dict[str, bytes], dict[str, Any]]:
    """여러 섹션에 동일 치환 순차 적용(단순 부분 문자열)."""
    out: dict[str, bytes] = {}
    stats: dict[str, Any] = {"sections": {}, "total_changes": 0}
    for path, raw in section_xml_bytes.items():
        def make_fn(acc: list[int]):
            def fn(i: int, old: str) -> str:
                s = old
                for a, b in replacements:
                    if a in s:
                        cnt = s.count(a)
                        acc[0] += cnt
                        s = s.replace(a, b)
                return s

            return fn

        acc = [0]
        new_bytes, meta = patch_text_runs(raw, make_fn(acc))
        out[path] = new_bytes
        stats["sections"][path] = {**meta, "substring_hits": acc[0]}
        stats["total_changes"] += meta.get("runs_changed", 0)
    return out, stats
