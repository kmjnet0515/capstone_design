'use strict';

/**
 * 여러 신청서 파일을 다운로드해 list_fillable_cells 결과와 표 구조를 함께 진단.
 *
 * 사용:
 *   node scripts/diagnose_corpus.js URL1 URL2 ...
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { pipeline: streamPipeline } = require('stream/promises');

const { listFillableCells, detectFormat } = require('../services/hwp_bridge');

function inferExt(buf) {
    if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))) return 'hwp';
    if (buf.length >= 4 && buf.slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]))) return 'hwpx';
    return null;
}

function fileNameFromContentDisposition(cd) {
    if (!cd) return null;
    const m1 = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (m1) return decodeURIComponent(m1[1].trim().replace(/^"|"$/g, ''));
    const m2 = cd.match(/filename="?([^";]+)"?/i);
    if (m2) return decodeURIComponent(m2[1].trim());
    return null;
}

async function downloadOne(url, idx) {
    const tmp = path.join(os.tmpdir(), `diag_raw_${Date.now()}_${idx}`);
    const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const buf = Buffer.from(resp.data);
    const sig = inferExt(buf);
    const cd = resp.headers['content-disposition'];
    const fname = fileNameFromContentDisposition(cd) || `unknown_${idx}`;
    const ext = sig || (fname.match(/\.(hwpx?|pdf|docx?|xlsx?|zip)$/i)?.[1]?.toLowerCase()) || 'bin';
    const out = `${tmp}.${ext}`;
    fs.writeFileSync(out, buf);
    return { url, idx, path: out, size: buf.length, sig, fileName: fname, ext };
}

function summarizeFields(fields) {
    const byKind = {};
    let injectCount = 0, hintCount = 0;
    const labelDup = {};
    fields.forEach((f) => {
        byKind[f.kind] = (byKind[f.kind] || 0) + 1;
        if (f.needs_inject) injectCount++;
        if (f.value_preview) hintCount++;
        const lbl = (f.composed_label || f.label_text || '').trim();
        labelDup[lbl] = (labelDup[lbl] || 0) + 1;
    });
    const repeated = Object.entries(labelDup).filter(([, n]) => n > 1).slice(0, 5);
    return { byKind, injectCount, hintCount, repeatedLabels: repeated };
}

(async () => {
    const urls = process.argv.slice(2);
    if (urls.length === 0) {
        console.error('URL 인자가 필요합니다.');
        process.exit(1);
    }

    console.log(`[corpus] 총 ${urls.length}개 URL 분석\n`);

    const results = [];
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
            console.log(`────────── (${i + 1}/${urls.length}) ──────────`);
            console.log(`URL: ${url}`);
            const dl = await downloadOne(url, i);
            console.log(`파일명: ${dl.fileName}`);
            console.log(`사이즈: ${dl.size} bytes  / 포맷: ${dl.sig || '(미확인 / 비-HWP)'}`);

            if (!dl.sig) {
                console.log('⚠ HWP/HWPX 가 아니라서 분석 생략');
                results.push({ url, fileName: dl.fileName, ok: false, error: 'not hwp/hwpx', ext: dl.ext, size: dl.size });
                continue;
            }

            const list = await listFillableCells(dl.path, { timeoutMs: 90_000 });
            if (!list.ok) {
                console.log(`✗ 분석 실패: ${list.error}`);
                results.push({ url, fileName: dl.fileName, ok: false, error: list.error, format: dl.sig, size: dl.size });
                continue;
            }
            const total = list.fields.length;
            const summary = summarizeFields(list.fields);
            const sectionStats = (list.sections || []).map((s) => ({
                section: s.section_index ?? s.section_path,
                tables: s.table_count,
                fillableSum: (s.tables || []).reduce((a, t) => a + (t.fillable_count || 0), 0),
            }));
            console.log(`표(섹션별): ${JSON.stringify(sectionStats)}`);
            console.log(`후보 ${total}개 — kind:${JSON.stringify(summary.byKind)}, inject필요:${summary.injectCount}, 힌트표시:${summary.hintCount}`);
            if (summary.repeatedLabels.length) {
                console.log(`중복 라벨 상위: ${JSON.stringify(summary.repeatedLabels)}`);
            }
            console.log('샘플 5건:');
            list.fields.slice(0, 5).forEach((f, k) => {
                const lbl = f.composed_label || f.label_text;
                console.log(`  ${k + 1}. [${f.kind}] ${lbl}  (sec${f.section_index ?? '-'} t#${f.table_index} r#${f.row_index} c#${f.value_col})  preview=${JSON.stringify((f.value_preview || '').slice(0, 30))}`);
            });
            results.push({
                url, fileName: dl.fileName, ok: true, format: dl.sig, size: dl.size,
                total, byKind: summary.byKind,
                injectCount: summary.injectCount, hintCount: summary.hintCount,
                sectionStats, repeated: summary.repeatedLabels,
            });
            console.log('');
        } catch (e) {
            console.log(`✗ 처리 중 예외: ${e.message}`);
            results.push({ url, ok: false, error: e.message });
        }
    }

    console.log('\n══════════════════ 요약 ══════════════════');
    console.log('파일명                                          | fmt   | 크기KB | 표 | 후보 | label / transposed / vertical | inject | 비고');
    console.log('-'.repeat(150));
    for (const r of results) {
        const fname = (r.fileName || '?').slice(0, 46).padEnd(46, ' ');
        const fmt = (r.format || '-').padEnd(5);
        const kb = r.size ? String(Math.round(r.size / 1024)).padStart(6, ' ') : '     -';
        if (!r.ok) {
            console.log(`${fname} | ${fmt} | ${kb} | -   | -    | -                              | -      | ${r.error || ''}`);
            continue;
        }
        const tableTotal = (r.sectionStats || []).reduce((a, s) => a + (s.tables || 0), 0);
        const k = r.byKind || {};
        const breakdown = `${k.table_label || 0} / ${k.table_transposed || 0} / ${k.table_label_vertical || 0}`.padEnd(30);
        const totalStr = String(r.total).padStart(4, ' ');
        const injStr = String(r.injectCount).padStart(6, ' ');
        const tStr = String(tableTotal).padStart(2, ' ');
        const note = r.total === 0 ? '⚠ 후보 0' : (r.repeated && r.repeated.length ? '중복라벨↑' : '');
        console.log(`${fname} | ${fmt} | ${kb} | ${tStr}  | ${totalStr} | ${breakdown} | ${injStr} | ${note}`);
    }

    fs.writeFileSync(
        path.join(__dirname, '..', 'temp', 'diagnose_corpus_result.json'),
        JSON.stringify(results, null, 2),
    );
    console.log('\n결과 JSON 저장: backend/temp/diagnose_corpus_result.json');
})();
