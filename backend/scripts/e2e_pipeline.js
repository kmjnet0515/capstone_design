'use strict';

/**
 * 신청서 작성 에이전트 E2E (DB/S3 제외):
 *   1. announcement_crawler 로 신청서 첨부 URL 찾기
 *   2. 해당 파일 다운로드
 *   3. hwp_bridge.listFillableCells 로 빈 셀 후보 추출
 *   4. 가짜 값 채워 hwp_bridge.applyFields 로 수정본 생성
 *   5. 결과 파일이 OLE/ZIP 시그니처로 정상 형식인지 확인
 *
 * 사용 예:
 *   node scripts/e2e_pipeline.js \
 *     "https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000121288"
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { pipeline: streamPipeline } = require('stream/promises');

const { findApplicationAttachments } = require('../services/announcement_crawler');
const { listFillableCells, applyFields, detectFormat } = require('../services/hwp_bridge');
const { normalizeFields, buildApplyPayload } = require('../services/field_extractor');

function checkSignature(filePath) {
    const buf = Buffer.alloc(8);
    const fd = fs.openSync(filePath, 'r');
    try {
        fs.readSync(fd, buf, 0, 8, 0);
    } finally {
        fs.closeSync(fd);
    }
    const oleSig = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    const zipSig = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    if (buf.equals(oleSig)) return 'hwp';
    if (buf.subarray(0, 4).equals(zipSig)) return 'hwpx';
    return null;
}

(async () => {
    const programUrl = process.argv[2]
        || 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000121288';

    console.log('[1/6] 크롤링:', programUrl);
    const crawl = await findApplicationAttachments(programUrl);
    if (!crawl.ok || !crawl.best) {
        console.error('  → 첨부 후보 없음:', crawl.error || '(reason 없음)');
        process.exit(1);
    }
    console.log('  → best:', crawl.best.fileName, '|', crawl.best.url, '| score=', crawl.best.score);
    console.log('  → 후보 총', crawl.candidates.length, '개');

    const ext = crawl.best.ext;
    const tmpRaw = path.join(os.tmpdir(), `e2e_raw_${Date.now()}.${ext}`);
    console.log('[2/6] 다운로드 →', tmpRaw);
    const resp = await axios.get(crawl.best.url, {
        responseType: 'stream',
        timeout: 60_000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    await streamPipeline(resp.data, fs.createWriteStream(tmpRaw));
    console.log('  → 사이즈:', fs.statSync(tmpRaw).size, 'bytes');

    const sigIn = checkSignature(tmpRaw);
    console.log('  → 시그니처:', sigIn || '(미확인)');
    if (!sigIn) {
        console.error('  실패: HWP/HWPX 가 아닙니다.');
        process.exit(2);
    }

    console.log('[3/6] 빈 셀 후보 분석');
    const list = await listFillableCells(tmpRaw, { timeoutMs: 90_000 });
    if (!list.ok) {
        console.error('  → 분석 실패:', list.error);
        process.exit(3);
    }
    console.log('  → 후보 필드:', list.fields.length, '개');
    list.fields.slice(0, 10).forEach((f, i) => {
        console.log(`     ${i + 1}. ${f.label_text}  (table#${f.table_index} row#${f.row_index})`);
    });

    if (list.fields.length === 0) {
        console.warn('  ⚠ 채울 후보가 없어 적용 단계는 생략합니다.');
        return;
    }

    console.log('[4/6] 정규화 + 임의 값 채우기');
    const rows = normalizeFields(list);
    rows.forEach((r) => { r.value = `[테스트값:${r.prompt_label}]`; });
    const payload = buildApplyPayload(rows, list.format, { strict: false });

    const tmpOut = path.join(os.tmpdir(), `e2e_out_${Date.now()}.${ext}`);
    console.log('[5/6] applyFields → ', tmpOut);
    const apply = await applyFields(tmpRaw, payload, tmpOut, { timeoutMs: 120_000 });
    console.log('  → ok:', apply.ok, ' applied:', apply.applied, '/', apply.total);
    if (!apply.ok) {
        console.error('  실패:', apply.error);
        process.exit(4);
    }
    if (apply.results) {
        for (const r of apply.results) {
            if (!r.ok) console.log(`     · idx ${r.index} 실패: ${r.error}`);
        }
    }

    console.log('[6/6] 결과 파일 시그니처 확인');
    const sigOut = checkSignature(tmpOut);
    const sizeOut = fs.statSync(tmpOut).size;
    console.log('  → 시그니처:', sigOut || '(미확인)', '| 사이즈:', sizeOut, 'bytes');
    if (sigOut !== sigIn) {
        console.error('  실패: 출력 시그니처 불일치');
        process.exit(5);
    }
    if (sizeOut < 1024) {
        console.error('  실패: 출력 사이즈 비정상');
        process.exit(6);
    }

    console.log('\n✅ E2E 통과 (네트워크/Python 단)');
    console.log('   결과 파일은 한컴/뷰어에서 직접 열어 확인하세요:', tmpOut);

    fs.unlinkSync(tmpRaw);
})();
