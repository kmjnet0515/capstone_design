# -*- coding: utf-8 -*-
"""
전체 .hwp 재구성(뷰어 재오픈) 로드맵 — 코드 아님, 다음 구현 스텁.

현재까지 가능한 것:
- DocInfo / 각 Section 스트림: 레코드 단위 파싱 후 dump_record 로 재직렬화하면
  **압축 해제된 스트림 바이트**에 대해 무손실 라운드트립 검증 가능 (record_inventory).
- OLE 에 저장된 DocInfo·BodyText/Section* blob: zlib raw deflate 로
  **재압축 후 다시 해제하면 페이로드 바이트 동일** (zlib_layer). 즉 blob 길이는 달라져도
  의미는 유지되는 압축층 교체는 검증됨.

구현됨(무편집 라운드트립):
- `hwp_repack.repack_hwp_preserving_streams`: ole 스트림 바이트·경로 그대로 새 .hwp 작성
  (compoundfiles warlomak fork). 암호 문서 제외.

부분 구현(MVP):
- `paragraph_edit.edit_simple_paragraph_text_file` + CLI `--edit-simple-para-out`:
  «가시 텍스트 + PARAGRAPH_BREAK»만 있는 ParaText, 단일 CharShape(0, id),
  ParaHeader chars 갱신, Section zlib 교체, OLE repack. LineSeg는 미조정.
- `table_label_edit.edit_table_value_by_label` + CLI `--edit-table-label-out`:
  표(TableBody+셀 LIST_HEADER)에서 라벨 열로 행을 찾아 값 열 첫 ParaText 를 위와 동일 규칙으로 편집.
  값 칸에 ParaText 레코드가 전혀 없으면(완전 빈 칸) 실패.

아직 범용으로 없는 것:
1) 임의 제어 문자·다중 CharShape·줄바꿈 단위 LineSeg 재계산 등 전체 의미 편집기
2) FileHeader/flags 변경·암호·DRM 처리

이 파일은 설명용; 실제 repack 코드는 hwp_repack.py.
"""

REBUILD_STATUS = (
    "OLE repack + MVP simple-paragraph semantic edit (ParaText/Header zlib+repack); "
    "full layout/CharShape/LineSeg engine and password not implemented"
)
