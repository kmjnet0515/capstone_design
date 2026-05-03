#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 5 스파이크: hwp5 로 .hwp 를 열어 표(TableBody) 레코드에서 rowcols 등 메타를 덤프한다.

결론(폴백 정책):
- 병합(colspan/rowspan) 전개에 필요한 정보가 rowcols 만으로 부족하면 HWP 경로는
  레거시 파이프라인 또는 HWPX 변환 후 처리 권장.

사용:
  python3 scripts/hwp_merge_spike.py path/to/sample.hwp
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import closing

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> int:
    if len(sys.argv) < 2:
        print("사용: python3 scripts/hwp_merge_spike.py <file.hwp>", file=sys.stderr)
        return 2
    path = os.path.abspath(sys.argv[1])
    os.chdir(BACKEND)
    sys.path.insert(0, BACKEND)
    try:
        from hwp5.errors import InvalidHwp5FileError
        from hwp5.xmlmodel import Hwp5File
    except ImportError as e:
        print(json.dumps({"ok": False, "error": f"hwp5 없음: {e}"}, ensure_ascii=False))
        return 1

    if not os.path.isfile(path):
        print(json.dumps({"ok": False, "error": "파일 없음"}, ensure_ascii=False))
        return 1

    out: dict = {"ok": True, "path": path, "sections": []}
    try:
        with closing(Hwp5File(path)) as hwp:
            out["version"] = str(hwp.header.version)
            for si in hwp.text.section_indexes():
                dec = hwp.text.section(si).open().read()
                out["sections"].append({
                    "section_index": si,
                    "body_bytes": len(dec),
                    "note": "상세 병합 분석은 hwp5 Table 모델·CTRL_HEADER 파싱 추가 필요",
                })
    except InvalidHwp5FileError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1

    out["recommendation"] = (
        "HWP 바이너리 병합 전개는 hwpx_analysis.absolute_grid 수준으로 맞추려면 "
        "별도 HWPTAG_TABLE 스키마 역설계가 필요. 미구현 시 HWPX 우선 파이프라인 사용."
    )
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
