# -*- coding: utf-8 -*-
"""
HWPX(KS X 6101, OPC ZIP + XML) 지식 영역과 엔진 충족도.

HWP와 달리 본문이 XML 트리로 노출되므로 “전부 수정”은 원칙적으로 멤버 바이트
치환 + 잘 구성된 XML 패치로 확장 가능하다.
"""

from __future__ import annotations

from typing import Any

REQUIRED_KNOWLEDGE: list[dict[str, Any]] = [
    {
        "id": "opc_zip",
        "name": "OPC 패키지(ZIP)",
        "need": "mimetype, META-INF/container.xml, Parts 순서 보존",
        "implementation": "partial",
        "notes": "package_zip 에서 mimetype 우선·엔트리 순서 유지 재작성",
    },
    {
        "id": "owpml_section",
        "name": "Contents/section*.xml (OWPML)",
        "need": "문단·런·표 셀 등 XML 모델",
        "implementation": "partial",
        "notes": "로컬명 t(텍스트 런) 위주 수집·치환; tbl/tr/tc 라벨행→값열 편집은 table_adjacent_edit",
    },
    {
        "id": "header_styles",
        "name": "Contents/header.xml 스타일 스토어",
        "need": "문자·문단 모양 id 해석",
        "implementation": "partial",
        "notes": "분석 시 크기·존재만; 스타일 편집 API는 미구현",
    },
    {
        "id": "bindata",
        "name": "BinData / 이미지 / OLE",
        "need": "바이너리 파트 경로·관계",
        "implementation": "missing",
        "notes": "패키지 열거만; 치환·추가는 별도 작업",
    },
    {
        "id": "encryption",
        "name": "암호/DRM HWPX",
        "need": "암호화 패키지 처리",
        "implementation": "out_of_scope",
        "notes": "비암호 문서 전제(필요 시 업로드 검증에서 제외)",
    },
]


def knowledge_summary() -> dict[str, Any]:
    impl_counts: dict[str, int] = {}
    for d in REQUIRED_KNOWLEDGE:
        k = str(d.get("implementation", "unknown"))
        impl_counts[k] = impl_counts.get(k, 0) + 1
    return {
        "format": "HWPX",
        "domains": REQUIRED_KNOWLEDGE,
        "implementation_counts": impl_counts,
    }
