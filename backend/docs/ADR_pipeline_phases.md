# 파이프라인 단계(폭포수) ADR

## Phase 0–1

- 골든 픽스처: `fixtures/hwpx/` (`build_fixtures.py`, `expected/*.json`).
- 회귀: `npm run test:phase0`, `npm run test:phase1`.
- HWPX `extract_table_grids_in_hwpx`에 `absolute_grid` 추가; 병합 시 `grid_confidence` degraded 가능.

## Phase 2

- `hwpx_analysis/block_topology.py` + CLI `--extract-blocks`.
- 게이트 실패 시 `apply_minimal_block_fallback`으로 표 단일 블록·빈 items.

## Phase 3

- `USE_BLOCK_PIPELINE=1` 이고 확장자 `.hwpx`일 때 `classifyBlockTopology` (좌표는 Python 슬롯 고정).
- 레거시: 기존 `classifyFields` + `reconcileClassificationWithFillable`.

## Phase 4

- `location_json` schema_version 2: `absolute_x`, `absolute_y`, `section_path`, `table_index`.
- HWPX `apply`: `absolute_x`/`absolute_y` 우선 → 실패 시 row/col → 라벨.

## Phase 5

- `scripts/hwp_merge_spike.py`: hwp5 개요만 덤프; 병합 전개 동등 구현은 미완 → HWPX 우선·HWP 레거시 유지.

## 캐시

- `APPLICATION_ANALYSIS_REVISION` (applications.js) 증가 시 문서 캐시 무효화.
