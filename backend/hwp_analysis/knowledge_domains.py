# -*- coding: utf-8 -*-
"""
임의의 HWP 5.x 를 “전부” 다루려면 알아야 할 지식 영역과, 현재 엔진의 충족도.

단일 샘플 파일이 아니라 포맷 일반을 대상으로 한다.
구현 상태: complete | partial | external | missing | out_of_scope
"""

from __future__ import annotations

from typing import Any

# 분석·재구성에 필요한 지식(이론). 엔진이 이 목록을 기준으로 공백을 보고한다.
REQUIRED_KNOWLEDGE: list[dict[str, Any]] = [
    {
        "id": "ole_cfb",
        "name": "OLE 복합 문서(CFB)",
        "need": "디렉터리·FAT·스트림 경계로 스토리지 트리를 읽고 쓸 수 있어야 함",
        "implementation": "partial",
        "notes": "읽기: olefile. 스트림 보존 재패킹: hwp_repack + compoundfiles writer fork",
    },
    {
        "id": "hwp5_fileheader",
        "name": "FileHeader 스트림(256B)",
        "need": "시그니처, 버전 4바이트, flags 비트(압축·배포·암호·DRM 등)",
        "implementation": "partial",
        "notes": "직접 바이트 파싱(file_header_raw). 쓰기: 미구현",
    },
    {
        "id": "stream_compression",
        "name": "스트림별 압축 정책",
        "need": "flags.compressed 일 때 DocInfo·BodyText·BinData 등 zlib raw deflate 규칙",
        "implementation": "partial",
        "notes": "hwp5 스토리지 래퍼 + zlib_layer 검증. 배포본 ViewText 포함 일부 경로 보강",
    },
    {
        "id": "body_vs_viewtext",
        "name": "본문 저장소 분기",
        "need": "일반: BodyText/SectionN, 배포용(distributable): ViewText/SectionN",
        "implementation": "partial",
        "notes": "엔진이 FileHeader.distributable 로 라벨·hwp.text 경로 통일; CFB 직접 패치는 미구현",
    },
    {
        "id": "record_forest",
        "name": "레코드 포맷(TagId, Level, Size, Payload)",
        "need": "DocInfo·본문 스트림을 레코드 열로 분해, 태그별 필드 의미",
        "implementation": "external",
        "notes": "파싱/재직렬화: hwp5(recordstream). 독립 구현 시 스펙 전량 이식 필요",
    },
    {
        "id": "hwptag_catalog",
        "name": "HWPTAG 식별자 전 집합",
        "need": "공개 스펙·버전별 추가 태그, 미지원 태그는 raw payload 보존",
        "implementation": "external",
        "notes": "pyhwp tagnames + UNKNOWN_* 집계. 스펙 갱신 시 목록 확장",
    },
    {
        "id": "password_drm",
        "name": "암호·DRM (입력 범위 밖)",
        "need": "암호화 스트림 복호화 등",
        "implementation": "out_of_scope",
        "notes": "본 서비스는 암호 HWP 를 받지 않는다는 전제. 코드는 FileHeader 플래그로 탐지 시 경고·거부 가능",
    },
    {
        "id": "semantic_edit",
        "name": "의미 단위(문단·표)와 레코드 연결",
        "need": "수정 시 LineSeg·CharShape 등 연쇄 갱신",
        "implementation": "external",
        "notes": "추출: hwp5 xmlmodel 이벤트. 편집 저장: 미구현",
    },
    {
        "id": "bin_data_scripts",
        "name": "BinData·Scripts·기타 부가 스트림",
        "need": "이미지·스크립트 참조와 본문 레코드 연계",
        "implementation": "partial",
        "notes": "OLE 목록·크기만. 페이로드 의미 전부는 미구현",
    },
]


def knowledge_summary() -> dict[str, Any]:
    from collections import Counter

    c = Counter(str(x["implementation"]) for x in REQUIRED_KNOWLEDGE)
    return {
        "domains_total": len(REQUIRED_KNOWLEDGE),
        "by_implementation": dict(c),
        "domains": REQUIRED_KNOWLEDGE,
    }
