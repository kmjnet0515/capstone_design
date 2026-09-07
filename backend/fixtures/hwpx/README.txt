Phase 0 회귀 픽스처

- build_fixtures.py: simple.hwpx (2x2 비병합), merged.hwpx (rowSpan 병합 1건)
- expected/*.json: extract 요약 스냅샷 + list_fillable 최소 필드
- 허용 diff: 향후 셀 텍스트 공백 정규화만 허용. 표 구조(rows/col_counts) 또는 absolute_grid n_rows/n_cols 변경 시 스크립트와 스냅샷을 함께 갱신할 것.

실행: backend 디렉터리에서 python3 scripts/phase0_regression.py
