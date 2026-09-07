'use strict';

/**
 * 휴리스틱 vs 하이브리드(LLM) 비교 진단.
 *
 * 사용:
 *   node scripts/diagnose_hybrid.js URL1 URL2 ...
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const OpenAI = require('openai');

const { listFillableCells, extractTableGrids } = require('../services/hwp_bridge');
const { classifyFields } = require('../services/field_classifier');

function inferExt(buf) {
    if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))) return 'hwp';
    if (buf.length >= 4 && buf.slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]))) return 'hwpx';
    return null;
}

function fileNameFromCD(cd) {
    if (!cd) return null;
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)"?/i)?.[1];
    return m ? decodeURIComponent(m.trim().replace(/^"|"$/g, '')) : null;
}

async function downloadOne(url, idx) {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buf = Buffer.from(resp.data);
    const sig = inferExt(buf);
    const fname = fileNameFromCD(resp.headers['content-disposition']) || `unknown_${idx}`;
    const ext = sig || (fname.match(/\.(hwpx?)$/i)?.[1]?.toLowerCase()) || 'bin';
    const out = path.join(os.tmpdir(), `diag_h_${Date.now()}_${idx}.${ext}`);
    fs.writeFileSync(out, buf);
    return { url, idx, path: out, size: buf.length, sig, fileName: fname, ext };
}

(async () => {
    const urls = process.argv.slice(2);
    if (urls.length === 0) {
        console.error('사용법: node scripts/diagnose_hybrid.js URL1 URL2 ...');
        process.exit(1);
    }
    if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY 없음'); process.exit(1); }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const results = [];
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        console.log(`\n[${i + 1}/${urls.length}] ${url}`);
        try {
            const dl = await downloadOne(url, i);
            console.log(`  파일: ${dl.fileName} (${dl.sig || '?'}, ${(dl.size / 1024).toFixed(1)}KB)`);
            if (!dl.sig) { console.log('  ⚠ HWP/HWPX 아님'); results.push({ url, ok: false, reason: 'not hwp/hwpx', name: dl.fileName }); continue; }

            const tH = Date.now();
            const heur = await listFillableCells(dl.path, { timeoutMs: 90_000 });
            const dtH = Date.now() - tH;

            const tG = Date.now();
            const grids = await extractTableGrids(dl.path, { timeoutMs: 60_000 });
            const dtG = Date.now() - tG;
            if (!grids.ok) { console.log('  ⚠ 그리드 추출 실패:', grids.error); results.push({ url, ok: false, reason: grids.error }); continue; }

            const tL = Date.now();
            const cls = await classifyFields(grids, openai, { model: 'gpt-4o-mini' });
            const dtL = Date.now() - tL;
            if (!cls.ok) { console.log('  ⚠ LLM 분류 실패:', cls.error); results.push({ url, ok: false, reason: cls.error }); continue; }

            const heurCount = (heur.fields || []).length;
            const llmCount = (cls.fields || []).length;
            const llmTypes = {};
            cls.fields.forEach(f => { llmTypes[f.input_type] = (llmTypes[f.input_type] || 0) + 1; });

            console.log(`  휴리스틱: ${heurCount}개 (${dtH}ms)`);
            console.log(`  LLM    : ${llmCount}개 (${dtG + dtL}ms, doc=${cls.document_kind} conf=${cls.confidence?.toFixed(2)})`);
            console.log(`  타입분포: ${JSON.stringify(llmTypes)}`);
            console.log(`  토큰: ${cls.usage?.prompt_tokens} in + ${cls.usage?.completion_tokens} out`);

            results.push({
                url, name: dl.fileName, fmt: dl.sig, sizeKB: Math.round(dl.size / 1024),
                heurCount, llmCount, doc_kind: cls.document_kind, conf: cls.confidence,
                llmTypes, llmReason: cls.reason,
                tokens: cls.usage ? `${cls.usage.prompt_tokens}+${cls.usage.completion_tokens}` : null,
                dtH, dtL: dtG + dtL,
            });
            fs.unlinkSync(dl.path);
        } catch (e) {
            console.log('  ✗ 예외:', e.message);
            results.push({ url, ok: false, reason: e.message });
        }
    }

    console.log('\n══════════════════ 요약 ══════════════════');
    console.log('파일명                                       | fmt   | KB    | 휴리스틱 | LLM | 문서종류    | 비고');
    console.log('-'.repeat(130));
    for (const r of results) {
        const name = (r.name || '?').slice(0, 42).padEnd(42, ' ');
        const fmt = (r.fmt || '-').padEnd(5);
        const kb = String(r.sizeKB ?? '-').padStart(5);
        const h = String(r.heurCount ?? '-').padStart(8);
        const l = String(r.llmCount ?? '-').padStart(3);
        const dk = (r.doc_kind || '-').padEnd(11);
        const note = r.reason ? `❌ ${r.reason}` : (r.llmReason || '');
        console.log(`${name} | ${fmt} | ${kb} | ${h} | ${l} | ${dk} | ${note}`);
    }

    fs.writeFileSync(
        path.join(__dirname, '..', 'temp', 'diagnose_hybrid_result.json'),
        JSON.stringify(results, null, 2),
    );
    console.log('\n결과 JSON: backend/temp/diagnose_hybrid_result.json');
})();
