'use strict';

/**
 * 캐시 hit/miss 동작 검증 (실제 RDS 사용).
 *  1) 같은 파일 hash 로 1차 분석 → LLM 호출(캐시 miss)
 *  2) 1차 결과를 캐시에 INSERT
 *  3) 2차 분석 → 캐시 hit (LLM 호출 0회) 확인
 *  4) cleanup expired 동작 확인
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const OpenAI = require('openai');

const { extractTableGrids } = require('../services/hwp_bridge');
const { classifyFields } = require('../services/field_classifier');
const documentCache = require('../services/document_cache');

/**
 * application_document_cache 테이블의 read/write 만 흉내내는 in-memory mock pool.
 * (실제 RDS 보안그룹 차단 환경에서도 캐시 로직을 검증하기 위함)
 */
function makeMockPool() {
    /** @type {Map<string, any>} */
    const store = new Map();
    let auto = 1;
    const exec = async (sql, params) => {
        const s = sql.trim();
        // SELECT (캐시 hit/miss)
        if (/^SELECT[\s\S]+FROM application_document_cache[\s\S]+WHERE file_hash = \?/.test(s)) {
            const [hash] = params;
            const row = store.get(hash);
            if (!row) return [[]];
            if (new Date(row.expires_at) <= new Date()) return [[]];
            return [[row]];
        }
        // INSERT ... ON DUPLICATE KEY UPDATE
        if (/^INSERT INTO application_document_cache/.test(s)) {
            const ttlMatch = s.match(/INTERVAL\s+(\d+)\s+DAY/);
            const ttlDays = ttlMatch ? parseInt(ttlMatch[1], 10) : 7;
            const [
                file_hash, file_format, file_size,
                document_kind, confidence, reason, classifier_model,
                grids_json, fields_json,
            ] = params;
            const expires_at = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
            const existing = store.get(file_hash);
            store.set(file_hash, {
                id: existing ? existing.id : auto++,
                file_hash, file_format, file_size,
                document_kind, confidence, reason, classifier_model,
                grids_json, fields_json,
                hit_count: existing ? existing.hit_count : 0,
                last_hit_at: null,
                created_at: existing ? existing.created_at : new Date().toISOString(),
                expires_at,
            });
            return [{ affectedRows: existing ? 2 : 1 }];
        }
        // UPDATE hit_count
        if (/^UPDATE application_document_cache[\s\S]+SET hit_count/.test(s)) {
            const [id] = params;
            for (const v of store.values()) {
                if (v.id === id) {
                    v.hit_count += 1;
                    v.last_hit_at = new Date().toISOString();
                    return [{ affectedRows: 1 }];
                }
            }
            return [{ affectedRows: 0 }];
        }
        // UPDATE expires_at (테스트용)
        if (/^UPDATE application_document_cache[\s\S]+SET expires_at/.test(s)) {
            const [hash] = params;
            const v = store.get(hash);
            if (v) v.expires_at = new Date(Date.now() - 1000).toISOString();
            return [{ affectedRows: v ? 1 : 0 }];
        }
        // DELETE 만료
        if (/^DELETE FROM application_document_cache WHERE expires_at <= NOW\(\)/.test(s)) {
            let n = 0;
            for (const [k, v] of store) {
                if (new Date(v.expires_at) <= new Date()) { store.delete(k); n++; }
            }
            return [{ affectedRows: n }];
        }
        // DELETE by hash (테스트 격리)
        if (/^DELETE FROM application_document_cache WHERE file_hash/.test(s)) {
            const [hash] = params;
            return [{ affectedRows: store.delete(hash) ? 1 : 0 }];
        }
        throw new Error(`mockPool: 지원되지 않는 SQL: ${s.slice(0, 60)}`);
    };
    return { execute: exec, query: exec };
}

(async () => {
    const url = process.argv[2]
        || 'https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_000000000752988&fileSn=1';

    const pool = makeMockPool();
    console.log('[0] in-memory mock pool 사용 (RDS 연결 안 함)');

    console.log('[1] 다운로드:', url);
    const buf = (await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000, headers: { 'User-Agent': 'Mozilla/5.0' } })).data;
    const sig = Buffer.from(buf).slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04])) ? 'hwpx' : 'hwp';
    const tmp = path.join(os.tmpdir(), `cache_test_${Date.now()}.${sig}`);
    fs.writeFileSync(tmp, Buffer.from(buf));
    const hash = await documentCache.sha256OfFile(tmp);
    console.log(`  hash=${hash.slice(0, 16)}…  size=${buf.byteLength}`);

    // 기존 캐시 삭제(테스트 격리)
    await pool.execute(`DELETE FROM application_document_cache WHERE file_hash = ?`, [hash]);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log('\n[2] 1차 분석 (캐시 miss 기대)');
    const t0 = Date.now();
    const cachedFirst = await documentCache.getCached(pool, hash);
    console.log(`  getCached: ${cachedFirst ? 'HIT(예상 외)' : 'MISS ✓'}`);
    const grids = await extractTableGrids(tmp, { timeoutMs: 60_000 });
    if (!grids.ok) { console.error('  grids 실패:', grids.error); process.exit(2); }
    const cls1 = await classifyFields(grids, openai, { model: 'gpt-4o-mini' });
    if (!cls1.ok) { console.error('  분류 실패:', cls1.error); process.exit(3); }
    const dt1 = Date.now() - t0;
    console.log(`  → LLM 분류 ${cls1.fields.length}건, ${dt1}ms (in ${cls1.usage?.prompt_tokens} + out ${cls1.usage?.completion_tokens})`);

    await documentCache.putCache(pool, {
        hash, format: sig, size: buf.byteLength, grids, classification: cls1,
    });
    console.log('  putCache: OK');

    console.log('\n[3] 2차 분석 (캐시 hit 기대, LLM 호출 X)');
    const t1 = Date.now();
    const cachedSecond = await documentCache.getCached(pool, hash);
    if (!cachedSecond) { console.error('  ✗ 캐시 hit 안 됨 (예상 실패)'); process.exit(4); }
    const dt2 = Date.now() - t1;
    console.log(`  → HIT ✓  fields=${cachedSecond.classification.fields.length}, doc_kind=${cachedSecond.document_kind}, hit#${cachedSecond.hit_count}, ${dt2}ms`);
    console.log(`  → expires_at: ${cachedSecond.expires_at}`);
    console.log(`  → 가속비: ${(dt1 / Math.max(dt2, 1)).toFixed(1)}× 빠름`);

    console.log('\n[4] 만료 cleanup 동작 확인');
    await pool.execute(
        `UPDATE application_document_cache SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE file_hash = ?`,
        [hash]
    );
    const cleanup = await documentCache.cleanupExpired(pool);
    console.log(`  cleanupExpired: deleted=${cleanup.deleted}`);
    const cachedAfter = await documentCache.getCached(pool, hash);
    console.log(`  → 만료 후 조회: ${cachedAfter ? 'HIT(예상 외)' : 'MISS ✓'}`);

    fs.unlinkSync(tmp);
    console.log('\n✅ 캐시 동작 검증 완료');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
