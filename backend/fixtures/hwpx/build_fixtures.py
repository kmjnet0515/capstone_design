#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""최소 HWPX ZIP 픽스처 생성 (회귀 테스트용). 실행: backend 디렉터리에서 python fixtures/hwpx/build_fixtures.py"""

from __future__ import annotations

import io
import os
import zipfile

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

# noqa: S314 - 고정 XML 문자열만 파싱


def _tc(text: str, *, col_span: int | None = None, row_span: int | None = None) -> str:
    attrs = []
    if col_span and col_span > 1:
        attrs.append(f'colSpan="{col_span}"')
    if row_span and row_span > 1:
        attrs.append(f'rowSpan="{row_span}"')
    a = (" " + " ".join(attrs)) if attrs else ""
    inner = f'<hp:run xmlns:hp="{HP}"><hp:t>{text}</hp:t></hp:run>'
    return f'<hp:tc xmlns:hp="{HP}"{a}>{inner}</hp:tc>'


def _section_xml_simple_table() -> bytes:
    """2x2 표: 라벨|빈값 / 연락처|빈값 (병합 없음)."""
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<root xmlns:hp="{HP}">
  <hp:tbl>
    <hp:tr>
      {_tc("이름")}
      {_tc("")}
    </hp:tr>
    <hp:tr>
      {_tc("연락처")}
      {_tc("")}
    </hp:tr>
  </hp:tbl>
</root>
"""
    return body.encode("utf-8")


def _section_xml_merged_table() -> bytes:
    """2열: col0 row0에 rowSpan=2 '사업명', col1 row0 빈칸, row1 col1만 '상세' (col0은 병합으로 생략)."""
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<root xmlns:hp="{HP}">
  <hp:tbl>
    <hp:tr>
      {_tc("사업명", row_span=2)}
      {_tc("")}
    </hp:tr>
    <hp:tr>
      {_tc("상세")}
    </hp:tr>
  </hp:tbl>
</root>
"""
    return body.encode("utf-8")


def _write_hwpx(path: str, section_xml: bytes) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("mimetype", b"application/hwp+zip", compress_type=zipfile.ZIP_STORED)
        zf.writestr("Contents/section0.xml", section_xml)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fp:
        fp.write(buf.getvalue())


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    simple = os.path.join(here, "simple.hwpx")
    merged = os.path.join(here, "merged.hwpx")
    _write_hwpx(simple, _section_xml_simple_table())
    _write_hwpx(merged, _section_xml_merged_table())
    print("wrote:", simple, merged)


if __name__ == "__main__":
    main()
