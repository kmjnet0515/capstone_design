'use strict';

/**
 * 하이브리드 파이프라인 E2E (DB/S3 제외):
 *   1) extractTableGrids → 표 그리드 (Python)
 *   2) classifyFields    → GPT-4o-mini 의미 분류
 *   3) safety filter     → signature 차단 등
 *   4) buildApplyPayload + applyFields → 결과 .hwp/.hwpx
 *
 * 사용:
 *   node scripts/e2e_hybrid_pipeline.js <URL>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { pipeline: streamPipeline } = require('stream/promises');
const OpenAI = require('openai');

const { extractTableGrids, applyFields, detectFormat } = require('../services/hwp_bridge');
const { classifyFields } = require('../services/field_classifier');
const { buildApplyPayload, FORBIDDEN_KIND } = require('../services/field_extractor');

(async () => {
    const url = process.argv[2]
        || 'https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_000000000752988&fileSn=1';

    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY 환경변수가 없습니다 (.env 또는 export).');
        process.exit(1);
    }

    console.log('[1/5] 다운로드:', url);
    const buf = (await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000, headers: { 'User-Agent': 'Mozilla/5.0' } })).data;
    const sig = Buffer.from(buf).slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04])) ? 'hwpx' : 'hwp';
    const tmpRaw = path.join(os.tmpdir(), `e2e_h_${Date.now()}.${sig}`);
    fs.writeFileSync(tmpRaw, Buffer.from(buf));
    console.log('  → ', tmpRaw, sig, buf.byteLength, 'bytes');

    console.log('[2/5] 표 그리드 추출 (Python)');
    const grids = await extractTableGrids(tmpRaw, { timeoutMs: 60_000 });
    if (!grids.ok) { console.error('  실패:', grids.error); process.exit(2); }
    const cellTotal = (grids.sections || []).reduce((a, s) =>
        a + (s.tables || []).reduce((b, t) => b + (t.rows || []).reduce((c, r) => c + r.length, 0), 0), 0);
    console.log(`  → 섹션 ${grids.sections.length}개, 셀 총 ${cellTotal}개`);

    console.log('[3/5] LLM 분류 (gpt-4o-mini)');
    const t0 = Date.now();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const cls = await classifyFields(grids, openai, { model: 'gpt-4o-mini' });
    const dt = Date.now() - t0;
    if (!cls.ok) { console.error('  실패:', cls.error); process.exit(3); }
    console.log(`  → 문서종류: ${cls.document_kind} (conf ${cls.confidence?.toFixed(2)}), 분류 ${cls.fields.length}개, ${dt}ms`);
    if (cls.usage) console.log(`  → 토큰: ${cls.usage.prompt_tokens} in + ${cls.usage.completion_tokens} out`);
    console.log(`  → 사유: ${cls.reason || '(없음)'}`);

    const byType = {};
    cls.fields.forEach(f => { byType[f.input_type] = (byType[f.input_type] || 0) + 1; });
    console.log('  → input_type 분포:', JSON.stringify(byType));
    console.log('  → 샘플 5건:');
    cls.fields.slice(0, 5).forEach((f, i) => {
        console.log(`     ${i + 1}. [${f.input_type}] ${f.context ? f.context + ' / ' : ''}${f.prompt_label}  (t#${f.table_index} r#${f.row_index} c#${f.col_index})${f.options ? ' opts=' + JSON.stringify(f.options) : ''}`);
    });

    if (cls.document_kind === 'notice') {
        console.log('\n⚠ 공고문으로 분류되어 적용 단계는 생략합니다.');
        return;
    }

    console.log('[4/5] 임의 값 채우기 + applyFields');
    const rows = cls.fields
        .filter(f => !FORBIDDEN_KIND.has(String(f.input_type).toLowerCase()))
        .map((f, idx) => {
            const meta = f._cell_meta || {};
            const location = {
                section_index: f.section_index ?? null,
                section_path: f.section_path ?? null,
                table_index: f.table_index,
                row_index: f.row_index,
                value_col: f.col_index,
                label_col: 0,
                label_text: f.prompt_label,
                composed_label: f.context ? `${f.context} / ${f.prompt_label}` : null,
                input_type: f.input_type,
                options: f.options || null,
                value_para_text_seqno: meta.first_pt ?? null,
                value_para_header_seqno: meta.first_para_hdr ?? null,
            };
            let dummy = `[테스트:${f.prompt_label}]`;
            if (f.input_type === 'checkbox' && Array.isArray(f.options) && f.options.length > 0) {
                dummy = f.options[0];
            } else if (f.input_type === 'radio' && Array.isArray(f.options) && f.options.length > 0) {
                dummy = f.options[0];
            } else if (f.input_type === 'date') {
                dummy = '2026-01-31';
            } else if (f.input_type === 'phone') {
                dummy = '010-1234-5678';
            } else if (f.input_type === 'email') {
                dummy = 'test@example.com';
            } else if (f.input_type === 'biz_no') {
                dummy = '123-45-67890';
            }
            return {
                kind: f.input_type,
                location_json: JSON.stringify(location),
                prompt_label: f.prompt_label,
                value: dummy,
                order_index: idx,
            };
        });

    const payload = buildApplyPayload(rows, sig, { strict: false });
    const out = path.join(os.tmpdir(), `e2e_h_out_${Date.now()}.${sig}`);
    const ap = await applyFields(tmpRaw, payload, out, { timeoutMs: 180_000 });
    console.log('  → ok:', ap.ok, 'applied:', ap.applied, '/', ap.total);
    if (!ap.ok) { console.error('  실패:', ap.error); process.exit(4); }
    if (ap.results) {
        const failed = ap.results.filter(r => !r.ok);
        if (failed.length) {
            console.log('  실패 항목:');
            failed.slice(0, 10).forEach(r => console.log(`     · idx ${r.index}: ${r.error}`));
        }
    }

    console.log('[5/5] 결과 파일 검증');
    const sigOut = fs.readFileSync(out).slice(0, 8);
    const oleOK = sigOut.equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]));
    const zipOK = sigOut.slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]));
    console.log('  → 시그니처:', oleOK ? 'hwp' : (zipOK ? 'hwpx' : '???'), '| 사이즈:', fs.statSync(out).size);

    const localOut = path.join(__dirname, '..', 'temp', `e2e_hybrid_${path.basename(out)}`);
    fs.copyFileSync(out, localOut);
    console.log('\n✅ 하이브리드 E2E 통과');
    console.log('   결과 파일:', localOut);
    fs.unlinkSync(tmpRaw);
})();
