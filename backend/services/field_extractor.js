'use strict';

/**
 * Python 분석 결과에서 application_fields DB row 형태로 정규화.
 *
 * 입력  : { ok, format, fields: [...] }
 * 출력  : [{ kind, location_json (string), prompt_label, placeholder_text, order_index }]
 */

const KOREAN_HINTS = {
    이름: '대표자/신청자의 한글 성함',
    성명: '대표자/신청자의 한글 성함',
    상호: '사업체 상호명',
    상호명: '사업체 상호명',
    사업자등록번호: '사업자등록번호 (- 포함, 예: 123-45-67890)',
    주소: '사업장 주소',
    소재지: '사업장 소재지',
    연락처: '연락 가능한 전화번호',
    전화: '전화번호',
    휴대전화: '휴대전화 번호',
    이메일: '이메일 주소',
    'e-mail': '이메일 주소',
    업종: '업종/업태',
    종목: '판매 품목',
    품목: '판매 품목',
    매출액: '연간 매출액(원)',
    종업원수: '종업원 수',
    설립일: '사업 개시일 (YYYY-MM-DD)',
    개업일: '사업 개시일 (YYYY-MM-DD)',
    팩스: '팩스 번호',
};

function _hintFor(label) {
    if (!label) return null;
    const k = label.replace(/\s+/g, '');
    if (KOREAN_HINTS[k]) return KOREAN_HINTS[k];
    for (const [key, hint] of Object.entries(KOREAN_HINTS)) {
        if (k.includes(key)) return hint;
    }
    return null;
}

/**
 * @param {object} listResult listFillableCells 결과 ({ ok, format, fields[] })
 * @returns {Array<object>} application_fields insert 페이로드
 */
function normalizeFields(listResult) {
    if (!listResult || !listResult.ok) return [];
    const out = [];
    const fields = Array.isArray(listResult.fields) ? listResult.fields : [];
    fields.forEach((f, idx) => {
        if (!f || !f.label_text) return;
        const promptLabel = f.composed_label || f.label_text;
        const location = {
            section_index: f.section_index != null ? f.section_index : 0,
            section_path: f.section_path ?? null,
            table_index: f.table_index,
            row_index: f.row_index,
            label_col: f.label_col,
            value_col: f.value_col,
            label_text: f.label_text,
            composed_label: f.composed_label ?? null,
            header_label: f.header_label ?? null,
            value_para_text_seqno: f.value_para_text_seqno ?? null,
            value_para_header_seqno: f.value_para_header_seqno ?? null,
            needs_inject: f.needs_inject ?? null,
        };
        out.push({
            kind: f.kind || 'table_label',
            location_json: JSON.stringify(location),
            prompt_label: promptLabel,
            placeholder_text: _hintFor(f.label_text) || (f.value_preview ? `현재 표시: ${f.value_preview}` : null),
            order_index: idx,
        });
    });
    return out;
}

/**
 * application_fields row → Python apply-fields-json 페이로드
 */
const FORBIDDEN_KIND = new Set(['signature']);

/**
 * @param {string} kind  input_type / 옛날 kind
 * @param {string} value 사용자 입력
 * @param {object} loc   location_json
 * @returns {string}     실제로 셀에 쓸 텍스트
 */
function resolveCellTextForKind(kind, value, loc) {
    const k = String(kind || '').toLowerCase();
    const raw = String(value || '');
    if (k === 'checkbox' || k === 'radio') {
        const opts = Array.isArray(loc?.options) ? loc.options : [];
        if (opts.length > 0) {
            const picked = raw.split(/[,;|\/]+/).map((s) => s.trim()).filter(Boolean);
            return opts.map((opt) => {
                const sym = k === 'radio' ? '○' : '□';
                const checkedSym = k === 'radio' ? '●' : '☑';
                const isOn = picked.some((p) => p === opt || opt.includes(p) || p.includes(opt));
                return `${isOn ? checkedSym : sym} ${opt}`;
            }).join(k === 'radio' ? '   ' : '   ');
        }
    }
    return raw;
}

/**
 * schema_version 2 (HWPX 절대 격자 좌표).
 */
function validateLocationV2(loc, format) {
    if (format !== 'hwpx') return false;
    const sp = loc.section_path;
    if (typeof sp !== 'string' || !sp.trim()) return false;
    const ti = loc.table_index;
    if (!Number.isInteger(ti) || ti < 0) return false;
    const ax = loc.absolute_x;
    const ay = loc.absolute_y;
    if (!Number.isInteger(ax) || ax < 0) return false;
    if (!Number.isInteger(ay) || ay < 0) return false;
    return true;
}

/**
 * finalize 적용용 location_json 이 최소 기하 정보를 갖추었는지 검사.
 * 잘못된 기본값(0,1)으로 잘못된 셀에 쓰는 것을 방지한다.
 */
function validateLocationForApply(loc, format) {
    if (!loc || typeof loc !== 'object') return false;
    const sv = Number(loc.schema_version);
    if (sv === 2) {
        return validateLocationV2(loc, format);
    }
    const ti = loc.table_index;
    const ri = loc.row_index;
    const vc = loc.value_col;
    const lc = loc.label_col;
    if (!Number.isInteger(ti) || ti < 0) return false;
    if (!Number.isInteger(ri) || ri < 0) return false;
    if (!Number.isInteger(vc) || vc < 0) return false;
    if (lc != null && (!Number.isInteger(lc) || lc < 0)) return false;
    if (format === 'hwpx') {
        const sp = loc.section_path;
        if (typeof sp !== 'string' || !sp.trim()) return false;
    } else {
        const si = loc.section_index;
        if (!Number.isInteger(si) || si < 0) return false;
    }
    return true;
}

/**
 * @param {object} opts { strict?: boolean } strict 기본 true — 유효하지 않은 항목이 있으면 예외
 */
function buildApplyPayload(rows, format, opts = {}) {
    const strict = opts.strict !== false;
    const badLabels = [];
    const out = [];
    for (const r of rows) {
        if (FORBIDDEN_KIND.has(String(r.kind || '').toLowerCase())) continue;
        let loc = {};
        try {
            loc = typeof r.location_json === 'string' ? JSON.parse(r.location_json) : (r.location_json || {});
        } catch (_e) {
            loc = {};
        }
        if (!validateLocationForApply(loc, format)) {
            badLabels.push(r.prompt_label || String(r.id || ''));
            continue;
        }
        const cellText = resolveCellTextForKind(r.kind, r.value, loc);
        const base = {
            label_text: loc.label_text || r.prompt_label,
            label_col: loc.label_col ?? 0,
            value_col: loc.value_col,
            table_index: loc.table_index,
            row_index: loc.row_index ?? null,
            kind: r.kind || loc.kind || 'table_label',
            value: cellText,
        };
        if (Number(loc.schema_version) === 2) {
            base.schema_version = 2;
            base.absolute_x = loc.absolute_x;
            base.absolute_y = loc.absolute_y;
            base.apply_strategy = loc.apply_strategy || 'coord';
            base.section_path = loc.section_path;
        } else if (format === 'hwpx') {
            base.section_path = loc.section_path;
        } else {
            base.section_index = loc.section_index;
        }
        out.push(base);
    }
    if (strict && badLabels.length > 0) {
        throw new Error(
            `표 위치 정보(location_json)가 유효하지 않아 파일에 반영할 수 없습니다: ${badLabels.filter(Boolean).join(', ')}`
        );
    }
    return out;
}

module.exports = {
    normalizeFields,
    buildApplyPayload,
    resolveCellTextForKind,
    FORBIDDEN_KIND,
    validateLocationForApply,
    validateLocationV2,
};
