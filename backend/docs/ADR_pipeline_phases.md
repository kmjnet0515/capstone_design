# 파이프라인 단계(폭포수) ADR

## Phase 0–1

- 골든 픽스처: `fixtures/hwpx/` (`build_fixtures.py`, `expected/*.json`).
- 회귀: `npm run test:phase0`, `npm run test:phase1`.
- HWPX `extract_table_grids_in_hwpx`에 `absolute_grid` 추가; 병합 시 `grid_confidence` degraded 가능.

## Phase 2

- `hwpx_analysis/block_topology.py` + CLI `--extract-blocks`.
- 게이트 실패 시 `apply_minimal_block_fallback`으로 표 단일 블록·빈 items.
- `items[]`: `grid_matrix` 행 우선·고유 `cell_id` 순으로 **표의 모든 논리 셀**(라벨·값·빈칸). 각 항목에 `fillable`(입력 대상=value 역할) 플래그. Grid-First LLM 입력의 `cell_n` 정의·격자는 전체 셀, DB 필드는 `fillable`만.

## Phase 3

- `USE_BLOCK_PIPELINE=1` 이고 확장자 `.hwpx`일 때 `classifyBlockTopology` (좌표는 Python 슬롯 고정).
- `classifyBlockTopology`: 프롬프트에는 전체 `cell_n`·`token_map`을 보내고, 응답 `fields`는 `fillable` 슬롯만 채택한다.
- 레거시: 기존 `classifyFields` + `reconcileClassificationWithFillable`.

## Phase 4

- `location_json` schema_version 2: `absolute_x`, `absolute_y`, `section_path`, `table_index`.
- HWPX `apply`: `absolute_x`/`absolute_y` 우선 → 실패 시 row/col → 라벨.

## Phase 5

- `scripts/hwp_merge_spike.py`: hwp5 개요만 덤프; 병합 전개 동등 구현은 미완 → HWPX 우선·HWP 레거시 유지.

## 캐시

- `APPLICATION_ANALYSIS_REVISION` (applications.js) 증가 시 문서 캐시 무효화.
