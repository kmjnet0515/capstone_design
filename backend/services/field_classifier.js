'use strict';

/**
 * LLM 기반 표 셀 의미 분류기 (gpt-4o-mini).
 *
 * 입력: extractTableGrids 의 결과 (표 그리드)
 * 출력: 정규화된 fillable_fields[] + 문서 종류 판정
 *
 *   {
 *     ok: true,
 *     document_kind: "application" | "notice" | "mixed",
 *     confidence: 0..1,
 *     fields: [{
 *       section_index | section_path,
 *       table_index, row_index, col_index,
 *       prompt_label, context, input_type,
 *       options?, placeholder_hint?,
 *       _cell_meta: { first_pt, first_para_hdr } | { has_t }
 *     }]
 *   }
 *
 * 셀 메타(seqno) 는 LLM 에 보내지 않고 (table_index, row_index, col_index) 로
 * 다시 매핑한다.
 */

const SYSTEM_PROMPT = `너는 한국 정부·소상공인 신청서(.hwp/.hwpx)의 표 셀을 분류하는 전문가다.
입력 tables 는 평탄화된 표 그리드(각 표마다 abs_table_index 부여) 배열이다. 너의 임무:

1) 문서 종류 판정 (document_kind):
   - "application": 사용자가 빈칸을 채워야 하는 신청서/사업계획서/추천서 등
   - "notice": 안내·공고문(목차·절차·평가방법 등 정보 전달용)
   - "mixed": 안내+양식 합본
   판정 근거가 약하면 confidence 를 낮춰라(0.0~1.0).

2) 채울 수 있는 입력 셀만 fields[] 에 담아라. 다음은 절대 fields 에 넣지 말라:
   - 표 제목/섹션 머리글(예: "1. 기업정보", "2. 상품정보")
   - 안내 문구(예: "※ 2,000자 이상 작성", "(서식 1, 3 참고)")
   - 순서도 화살표/마커("▶", "▷", "→")
   - "-" 또는 placeholder 만 있는 셀이지만 의미는 "해당 없음"인 것
   - 이미 의미 있는 값이 채워진 셀(예: 빨간 안내 "유효기간 확인 必")
   - 안내문 스타일의 row(전체 폭 1셀에 긴 문장)

3) 입력 셀은 다음 input_type 중 하나로 분류:
   - "text"      : 일반 텍스트 (이름, 주소, 사업체명 등)
   - "longtext"  : 큰 박스(상품설명·사업계획·공적사항 등 200자 이상 입력 권장)
   - "number"    : 금액/인원/연도 등 숫자
   - "date"      : 날짜(YYYY-MM-DD 또는 "YYYY년 MM월 DD일")
   - "phone"     : 전화/팩스
   - "email"     : 이메일
   - "biz_no"    : 사업자등록번호
   - "checkbox"  : "□", "■", "☐", "☑" 가 들어 있는 다중 선택 (옵션 추출 필수)
   - "radio"     : "○","●" 또는 "(A,B,C 중 택 1)" 같은 단일 선택 (옵션 추출 필수)
   - "signature" : 서명·도장 자리 ("(서명 또는 인)", "(인)", "(직인)") — 자동 채움 금지

4) prompt_label 은 사용자에게 물어볼 짧고 명확한 라벨로 만들어라.
   - 같은 라벨이 여러 번이면 컨텍스트 prefix 를 붙여라:
     예) "(추천대상자 1) 소속", "(상품 1) 상품명"
   - 표 제목이 인접해 있으면 그 제목을 context 로 추가하라

5) options:
   - input_type 이 "checkbox"/"radio" 일 때만 채워라.
   - 셀 텍스트에서 □/■/○/● 등 마커를 제거한 한국어 옵션 토큰들을 배열로:
     예) "□ 동의 □ 미동의" → ["동의","미동의"]

6) placeholder_hint:
   - 사용자에게 보여줄 형식 힌트(있을 때만). 예: "예시) 2026-01-31"

7) 위치는 반드시 «abs_table_index, row_index, col_index» 세 정수만 사용하라
   (section_index 같은 값은 절대 만들지 말 것).

출력은 반드시 단일 JSON 객체:
{
  "document_kind": "...",
  "confidence": 0.0~1.0,
  "reason": "<짧은 이유>",
  "fields": [
    { "abs_table_index": <int>, "row_index": <int>, "col_index": <int>,
      "prompt_label": "...", "context": "...",
      "input_type": "...", "options": [...]|null,
      "placeholder_hint": "..." | null
    }, ...
  ]
}
`;

/**
 * grids 를 «평탄화» — 각 표에 abs_table_index 를 매기고
 * (abs_table_index → {section_index/path, table_index, _cell_meta}) 룩업 테이블 생성.
 * LLM 에는 abs_table_index 와 셀 텍스트만 노출한다.
 */
function _normalizeDocLabelText(s) {
    if (s == null || typeof s !== 'string') return '';
    return s.replace(/[:：\s]+$/u, '').trim();
}

function _flattenGrids(grids) {
    const slimTables = [];
    const lookup = []; // abs_table_index 순서대로
    for (const s of grids.sections || []) {
        for (const t of s.tables || []) {
            const abs = lookup.length;
            lookup.push({
                section_index: s.section_index ?? null,
                section_path: s.section_path ?? null,
                table_index: t.table_index,
                cell_meta: t._cell_meta || [],
            });
            slimTables.push({
                abs_table_index: abs,
                rows: t.rows,
            });
        }
    }
    return {
        format: grids.format,
        table_count: slimTables.length,
        tables: slimTables,
        _lookup: lookup,
    };
}

function _attachCellMeta(slim, fields) {
    return fields
        .filter((f) => Number.isInteger(f?.abs_table_index)
            && Number.isInteger(f?.row_index)
            && Number.isInteger(f?.col_index))
        .map((f) => {
            const ref = slim._lookup[f.abs_table_index];
            if (!ref) return null;
            const row = ref.cell_meta[f.row_index] || [];
            const cell = row[f.col_index] || null;
            const tableSlim = slim.tables[f.abs_table_index];
            const rowTexts = tableSlim?.rows?.[f.row_index] || [];
            let docLabel = '';
            let labelCol = 0;
            if (f.col_index > 0) {
                labelCol = f.col_index - 1;
                docLabel = _normalizeDocLabelText(String(rowTexts[labelCol] ?? ''));
            }
            return {
                ...f,
                section_index: ref.section_index,
                section_path: ref.section_path,
                table_index: ref.table_index,
                _cell_meta: cell,
                _grid_label_col: labelCol,
                _doc_label_text: docLabel || null,
            };
        })
        .filter(Boolean);
}

/**
 * @param {object} grids extractTableGrids 결과
 * @param {object} openai openai SDK client
 * @param {object} opts { model?: string, maxRetries?: number, temperature?: number }
 */
async function classifyFields(grids, openai, opts = {}) {
    const model = opts.model || 'gpt-4o-mini';
    const maxRetries = opts.maxRetries ?? 1;
    const temperature = opts.temperature ?? 0;

    if (!grids || !grids.ok) {
        return { ok: false, error: 'grids invalid', detail: grids };
    }
    const totalCells = (grids.sections || []).reduce((a, s) =>
        a + (s.tables || []).reduce((b, t) => b + t.rows.reduce((c, r) => c + r.length, 0), 0), 0);
    if (totalCells === 0) {
        return { ok: true, document_kind: 'unknown', confidence: 0, fields: [], reason: 'empty' };
    }

    const slim = _flattenGrids(grids);
    const userPayload = {
        format: slim.format,
        table_count: slim.table_count,
        tables: slim.tables,
    };

    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await openai.chat.completions.create({
                model,
                temperature,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content:
                            '아래 tables 를 분석해 위 규칙대로 분류한 JSON 만 출력해라.\n\n' +
                            'tables:\n```json\n' + JSON.stringify(userPayload) + '\n```',
                    },
                ],
            });
            const content = res.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content);

            const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
            const enriched = _attachCellMeta(slim, fields);
            const usage = res.usage || null;

            return {
                ok: true,
                document_kind: parsed.document_kind || 'unknown',
                confidence: parsed.confidence ?? 0,
                reason: parsed.reason || '',
                fields: enriched,
                model,
                usage,
            };
        } catch (e) {
            lastErr = e;
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
                continue;
            }
        }
    }
    return { ok: false, error: lastErr ? lastErr.message : 'unknown' };
}

/**
 * 캐시에서 불러온 classification 에 표 그리드가 있으면 라벨 열 텍스트(_doc_label_text)를 다시 붙인다.
 */
function rehydrateClassificationWithGrids(grids, classification) {
    if (!grids || !grids.ok || !classification || !Array.isArray(classification.fields)) {
        return classification;
    }
    const slim = _flattenGrids(grids);
    const fieldsIn = classification.fields.map((f) => ({
        abs_table_index: f.abs_table_index,
        row_index: f.row_index,
        col_index: f.col_index,
        ...f,
    }));
    const attached = _attachCellMeta(slim, fieldsIn).filter(Boolean);
    return { ...classification, fields: attached };
}

/**
 * LLM 이 준 col_index 가 같은 행에 라벨이 여러 개일 때 어긋나는 경우가 많아,
 * Python list_fillable_cells(geometry 진실값)와 라벨 문자열로 스냅한다.
 */
function _normLabelLoose(s) {
    return String(s || '')
        .replace(/[:：\s]+$/u, '')
        .trim()
        .toLowerCase();
}

function _labelsRoughMatch(a, b) {
    const x = _normLabelLoose(a);
    const y = _normLabelLoose(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.includes(y) || y.includes(x)) return true;
    return false;
}

function _cellSameGeomRowAsField(f, c, format) {
    if (f.table_index !== c.table_index || f.row_index !== c.row_index) return false;
    if (format === 'hwpx') {
        const fp = f.section_path;
        const cp = c.section_path;
        if (fp && cp) return fp === cp;
    }
    return (f.section_index ?? 0) === (c.section_index ?? 0);
}

function _scoreFillableMatch(f, c, format, sameRowOnly) {
    let score = 0;
    const docLab = f._doc_label_text;
    const promptLab = f.prompt_label;
    const lt = c.label_text || '';
    const comp = c.composed_label || '';

    if (_labelsRoughMatch(docLab, lt) || _labelsRoughMatch(docLab, comp)) score += 8;
    if (_labelsRoughMatch(promptLab, lt) || _labelsRoughMatch(promptLab, comp)) score += 7;

    if (sameRowOnly && _cellSameGeomRowAsField(f, c, format)) score += 5;
    if (f.table_index === c.table_index) score += 2;
    if (f.row_index === c.row_index) score += 1;
    const colDist = Math.abs((f.col_index ?? 0) - (c.value_col ?? 0));
    if (colDist === 0) score += 3;
    else if (colDist <= 2) score += 1;

    return score;
}

function reconcileClassificationWithFillable(cls, fillable) {
    if (!cls || !Array.isArray(cls.fields) || cls.fields.length === 0) return cls;
    if (!fillable || !fillable.ok || !Array.isArray(fillable.fields) || fillable.fields.length === 0) {
        return cls;
    }
    const cells = fillable.fields;
    const format = fillable.format || 'hwp';

    const fields = cls.fields.map((f) => {
        let best = null;
        let bestScore = -1;

        const sameRowCells = cells.filter((c) => _cellSameGeomRowAsField(f, c, format));
        for (const c of sameRowCells) {
            const s = _scoreFillableMatch(f, c, format, true);
            if (s > bestScore) {
                bestScore = s;
                best = c;
            }
        }

        if (bestScore < 9) {
            for (const c of cells) {
                const s = _scoreFillableMatch(f, c, format, false);
                if (s > bestScore) {
                    bestScore = s;
                    best = c;
                }
            }
        }

        if (best && bestScore >= 9) {
            const meta = {};
            if (best.value_para_text_seqno != null) meta.first_pt = best.value_para_text_seqno;
            if (best.value_para_header_seqno != null) meta.first_para_hdr = best.value_para_header_seqno;

            return {
                ...f,
                section_index: best.section_index ?? f.section_index,
                section_path: best.section_path ?? f.section_path,
                table_index: best.table_index,
                row_index: best.row_index,
                col_index: best.value_col,
                _grid_label_col: best.label_col,
                _doc_label_text: best.label_text || f._doc_label_text,
                _cell_meta: Object.keys(meta).length ? meta : f._cell_meta,
            };
        }
        return f;
    });

    return { ...cls, fields };
}

const SYSTEM_PROMPT_BLOCKS = `너는 한국 정부·소상공인 신청서 «표(table) 안의 셀»을 분류한다.
본문은 표가 아닌 영역은 후보에 포함되지 않는다.
입력으로 아래 2가지를 받는다:
1) cell 정의 목록: cell_n = '셀 안의 텍스트(빈칸이면 빈 문자열)', ((행들), (열들)) — 라벨 칸과 입력(값) 칸이 모두 포함될 수 있다.
2) 표별 grid preview: 병합셀은 동일 cell_n 이 여러 칸에 반복됨

출력 classifications[].target_cell_id 에는 반드시 위에 등장한 cell_N 기호만 넣는다(예: cell_3). 내부 저장용 긴 id는 쓰지 않는다.
좌표를 새로 추측하거나 만들지 마라.

규칙:
1) document_kind: application | notice | mixed
2) 후보에 없는 cell / id 를 출력하지 마라.
3) classifications 에는 «입력해야 하는 칸(fillable)»에 해당하는 cell_n 만 넣는다. 라벨 전용 칸·안내 문구만 있는 칸은 넣지 마라(격자와 정의는 맥락용).
4) input_type: text, longtext, number, date, phone, email, biz_no, checkbox, radio, signature
5) checkbox/radio 일 때만 options 배열
6) prompt_label 은 인접 라벨·정의를 참고해 사용자에게 물을 짧은 한글 라벨로 써라(예: 정의에 cell_1='업체명' 이 있고 cell_2 가 빈 입력칸이면 cell_2 의 prompt_label 은 '업체명' 등으로).
7) 출력 JSON 에 abs_table_index, row_index, col_index, absolute_x, absolute_y 를 넣지 마라.

출력 형식:
{"document_kind":"...","confidence":0.0,"reason":"...","classifications":[{"target_cell_id":"...","input_type":"...","prompt_label":"...","options":null,"placeholder_hint":null}]}`;

/**
 * grid-first 입력 패키지 생성.
 * - cell_n 정의: 라벨 + 점유 행/열
 * - grid preview: 병합셀 반복 표현
 * - tokenToId: cell_n -> 저장용 target_cell_id (서버 전용, LLM 프롬프트에는 넣지 않음)
 */
function buildGridFirstCandidatePack(cellCandidates, blocks) {
    const sorted = [...(cellCandidates || [])].sort((a, b) => {
        const spa = String(a.section_path || '');
        const spb = String(b.section_path || '');
        if (spa !== spb) return spa.localeCompare(spb);
        if (a.table_index !== b.table_index) return a.table_index - b.table_index;
        const ay = a.abs_y ?? 0;
        const by = b.abs_y ?? 0;
        if (ay !== by) return ay - by;
        const ax = a.abs_x ?? 0;
        const bx = b.abs_x ?? 0;
        return ax - bx;
    });

    const tableDim = new Map();
    (blocks || []).forEach((b) => {
        const key = `${String(b.section_path || '')}::${b.table_index}`;
        const gm = b.grid_matrix;
        const rows = Array.isArray(gm) ? gm.length : 0;
        const cols = rows > 0 && Array.isArray(gm[0]) ? gm[0].length : 0;
        tableDim.set(key, { section_path: String(b.section_path || ''), table_index: b.table_index, rows, cols });
    });

    const tokenToId = Object.create(null);
    const cellSpans = new Map(); // sym -> { label, rows:Set, cols:Set }
    const tableCells = new Map(); // key -> { rows, cols, matrix[][] }

    sorted.forEach((s, idx) => {
        const sym = `cell_${idx + 1}`;
        tokenToId[sym] = s.target_cell_id;

        const y = Number.isInteger(s.abs_y) ? s.abs_y : 0;
        const x = Number.isInteger(s.abs_x) ? s.abs_x : 0;
        const rowSpan = Number.isInteger(s.row_span) && s.row_span > 0 ? s.row_span : 1;
        const colSpan = Number.isInteger(s.col_span) && s.col_span > 0 ? s.col_span : 1;
        const tableKey = `${String(s.section_path || '')}::${s.table_index}`;

        const dim = tableDim.get(tableKey) || { section_path: String(s.section_path || ''), table_index: s.table_index, rows: 0, cols: 0 };
        const needRows = Math.max(dim.rows || 0, y + rowSpan);
        const needCols = Math.max(dim.cols || 0, x + colSpan);

        if (!tableCells.has(tableKey)) {
            tableCells.set(tableKey, {
                section_path: dim.section_path,
                table_index: dim.table_index,
                rows: needRows,
                cols: needCols,
                matrix: Array.from({ length: needRows }, () => Array.from({ length: needCols }, () => '.')),
            });
        }

        const t = tableCells.get(tableKey);
        while (t.matrix.length < needRows) t.matrix.push(Array.from({ length: t.cols }, () => '.'));
        if (t.cols < needCols) {
            for (let i = 0; i < t.matrix.length; i++) {
                while (t.matrix[i].length < needCols) t.matrix[i].push('.');
            }
            t.cols = needCols;
        }
        t.rows = Math.max(t.rows, needRows);
        for (let dy = 0; dy < rowSpan; dy++) {
            for (let dx = 0; dx < colSpan; dx++) {
                const yy = y + dy;
                const xx = x + dx;
                if (yy < t.matrix.length && xx < t.matrix[yy].length) {
                    t.matrix[yy][xx] = sym;
                }
            }
        }

        if (!cellSpans.has(sym)) {
            cellSpans.set(sym, {
                label: s.label != null ? String(s.label) : '',
                rows: new Set(),
                cols: new Set(),
            });
        }
        const span = cellSpans.get(sym);
        for (let dy = 0; dy < rowSpan; dy++) span.rows.add(y + dy);
        for (let dx = 0; dx < colSpan; dx++) span.cols.add(x + dx);
    });

    const defLines = Object.keys(tokenToId).map((sym) => {
        const span = cellSpans.get(sym);
        const rowList = [...(span?.rows || [])].sort((a, b) => a - b).join(',');
        const colList = [...(span?.cols || [])].sort((a, b) => a - b).join(',');
        const label = (span?.label || '').replace(/'/g, "\\'");
        return `${sym} = '${label}', ((${rowList}), (${colList}))`;
    });

    const tablePreviewLines = [];
    [...tableCells.values()]
        .sort((a, b) => a.section_path.localeCompare(b.section_path) || a.table_index - b.table_index)
        .forEach((t) => {
            tablePreviewLines.push(`- table section=${t.section_path} table_index=${t.table_index}`);
            for (let r = 0; r < t.rows; r++) {
                tablePreviewLines.push(`| ${t.matrix[r].slice(0, t.cols).join(' | ')} |`);
            }
            tablePreviewLines.push('');
        });

    return {
        definitionsText: defLines.join('\n'),
        gridText: tablePreviewLines.join('\n').trim(),
        tokenToId,
        count: sorted.length,
    };
}

function resolveClassificationCellId(raw, byId, tokenToId) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (byId.has(s)) return s;
    const mapped = tokenToId[s];
    if (mapped && byId.has(mapped)) return mapped;
    return null;
}

/**
 * classifyBlockTopology 가 OpenAI 에 보내는 messages 와 동일 (API 호출 없음).
 *
 * @param {object} topoPayload extract-blocks / extractDocumentTopology 최상위 JSON
 * @returns {{ ok:true, messages, byId, tokenToId, meta } | { ok:false, error, detail? } | { ok:false, skip:'no_slots'|'no_fillable' }}
 */
function buildGridFirstLlmMessages(topoPayload) {
    const topo = topoPayload?.topology;
    if (!topo || !topo.ok) {
        return { ok: false, error: 'topology 없음 또는 실패', detail: topo };
    }
    const blocks = topo.blocks || [];
    const cellCandidates = [];
    for (const b of blocks) {
        const items = b.items || [];
        items.forEach((it) => {
            if (!it || !it.cell_id) return;
            const fillable = it.fillable !== false;
            const rs = Number.isInteger(it.row_span) && it.row_span > 0 ? it.row_span : 1;
            const cs = Number.isInteger(it.col_span) && it.col_span > 0 ? it.col_span : 1;
            cellCandidates.push({
                target_cell_id: it.cell_id,
                block_id: b.block_id,
                section_path: b.section_path,
                table_index: b.table_index,
                abs_x: Number.isInteger(it.abs_x) ? it.abs_x : 0,
                abs_y: Number.isInteger(it.abs_y) ? it.abs_y : 0,
                row_span: rs,
                col_span: cs,
                label: it.label || '',
                role_hint: it.role_hint || 'value',
                fillable,
            });
        });
    }
    if (cellCandidates.length === 0) {
        return { ok: false, skip: 'no_slots' };
    }

    const fillableCount = cellCandidates.filter((s) => s.fillable).length;
    if (fillableCount === 0) {
        return { ok: false, skip: 'no_fillable' };
    }

    const byId = new Map(cellCandidates.map((s) => [s.target_cell_id, s]));
    const { definitionsText, gridText, tokenToId, count } = buildGridFirstCandidatePack(cellCandidates, blocks);

    const gridIntro = [
        '【무엇을내나】표 안의 모든 논리 셀을 cell_n으로 정의한다(라벨·값·빈칸 모두). 같은 cell_n이 여러 칸에 반복되면 병합셀 점유를 의미한다.',
        '【읽는 법】cell 정의의 ((rows), (cols))와 grid preview를 함께 보고, 빈 입력(fill) 칸만 classifications 에 넣는다.',
        '【ID 형식】target_cell_id에는 정의·프리뷰에 나온 cell_n만 사용한다. 서버가 cell_n을 내부 id로 바꾼다.',
        '',
        '【cell 정의 목록】',
        definitionsText || '(정의 없음)',
        '',
        `【grid preview | 표 셀 ${count}개 (입력 후보 fill ${fillableCount}개)】`,
        gridText || '(grid 없음)',
    ].join('\n');

    const systemContent = SYSTEM_PROMPT_BLOCKS;
    const userContent = gridIntro;
    const utf8 = (s) => Buffer.byteLength(s, 'utf8');
    const meta = {
        topologyCellCount: count,
        fillableCount,
        tokenMapEntryCount: Object.keys(tokenToId).length,
        systemUtf8Bytes: utf8(systemContent),
        userUtf8Bytes: utf8(userContent),
        totalUtf8Bytes: utf8(systemContent) + utf8(userContent),
    };

    return {
        ok: true,
        messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
        ],
        byId,
        tokenToId,
        meta,
    };
}

/**
 * Phase 3: 블록 토폴로지(--extract-blocks) 기반 의미만 분류. 좌표는 슬롯에 포함된 값만 사용.
 *
 * @param {object} topoPayload { ok, topology:{ blocks[] }, grids? }
 */
async function classifyBlockTopology(topoPayload, openai, opts = {}) {
    const model = opts.model || 'gpt-4o-mini';
    const temperature = opts.temperature ?? 0;
    const maxRetries = opts.maxRetries ?? 1;

    const prep = buildGridFirstLlmMessages(topoPayload);
    if (!prep.ok) {
        if (prep.skip === 'no_slots') {
            return { ok: true, document_kind: 'unknown', confidence: 0, fields: [], reason: 'no_slots', model };
        }
        if (prep.skip === 'no_fillable') {
            return {
                ok: true,
                document_kind: 'unknown',
                confidence: 0,
                fields: [],
                reason: 'no_fillable_slots',
                model,
            };
        }
        return { ok: false, error: prep.error || 'unknown', detail: prep.detail };
    }

    const { messages, byId, tokenToId } = prep;

    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await openai.chat.completions.create({
                model,
                temperature,
                response_format: { type: 'json_object' },
                messages,
            });
            const content = res.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content);
            const rawCls = Array.isArray(parsed.classifications) ? parsed.classifications : [];

            const fields = [];
            const seen = new Set();
            for (const c of rawCls) {
                const sid = resolveClassificationCellId(c.target_cell_id, byId, tokenToId);
                if (!sid || !byId.has(sid)) continue;
                const slot = byId.get(sid);
                if (!slot.fillable) continue;
                if (seen.has(sid)) continue;
                seen.add(sid);
                fields.push({
                    schema_version: 3,
                    section_path: slot.section_path,
                    table_index: slot.table_index,
                    target_cell_id: sid,
                    prompt_label: c.prompt_label || slot.label,
                    label_text: slot.label,
                    input_type: c.input_type || 'text',
                    options: c.options || null,
                    placeholder_hint: c.placeholder_hint || null,
                    block_id: slot.block_id,
                    slot_id: sid,
                    context: null,
                    abs_table_index: null,
                });
            }

            return {
                ok: true,
                document_kind: parsed.document_kind || 'unknown',
                confidence: parsed.confidence ?? 0,
                reason: parsed.reason || '',
                fields,
                model,
                usage: res.usage || null,
                pipeline: 'block_topology_v5_grid_first',
            };
        } catch (e) {
            lastErr = e;
            if (attempt < maxRetries) {
                await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            }
        }
    }
    return { ok: false, error: lastErr ? lastErr.message : 'unknown' };
}

module.exports = {
    classifyFields,
    classifyBlockTopology,
    buildGridFirstLlmMessages,
    SYSTEM_PROMPT,
    SYSTEM_PROMPT_BLOCKS,
    rehydrateClassificationWithGrids,
    reconcileClassificationWithFillable,
    buildGridFirstCandidatePack,
};
