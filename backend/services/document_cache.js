'use strict';

/**
 * 신청서 문서 분석 결과 캐시 (file_hash → grids + LLM 분류 결과).
 *
 *   - getCached(pool, hash) → { grids, classification, hit_count, ... } | null
 *   - putCache(pool, { hash, format, size, grids, classification, ttlDays })
 *   - cleanupExpired(pool) → { ok, deleted }
 *   - startCleanupCron(pool, [opts]) → 매일 03:00 정리
 *
 *   sha256OfFile(filePath) 도 같이 export.
 */

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_TTL_DAYS = parseInt(process.env.APPLICATION_CACHE_TTL_DAYS || '7', 10);

function sha256OfFile(filePath) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const s = fs.createReadStream(filePath);
        s.on('error', reject);
        s.on('data', (chunk) => h.update(chunk));
        s.on('end', () => resolve(h.digest('hex')));
    });
}

async function getCached(pool, fileHash) {
    if (!pool || !fileHash) return null;
    try {
        const [rows] = await pool.execute(
            `SELECT id, file_hash, file_format, file_size,
                    document_kind, confidence, reason, classifier_model,
                    grids_json, fields_json, hit_count, created_at, expires_at
               FROM application_document_cache
              WHERE file_hash = ? AND expires_at > NOW()
              LIMIT 1`,
            [fileHash]
        );
        if (rows.length === 0) return null;
        const row = rows[0];
        let grids = null;
        let fields = null;
        try { grids = row.grids_json ? JSON.parse(row.grids_json) : null; } catch (_) { /* skip */ }
        try { fields = JSON.parse(row.fields_json); } catch (_) { fields = null; }
        if (!fields) return null;

        await pool.execute(
            `UPDATE application_document_cache
                SET hit_count = hit_count + 1, last_hit_at = NOW()
              WHERE id = ?`,
            [row.id]
        );
        return {
            id: row.id,
            file_hash: row.file_hash,
            file_format: row.file_format,
            file_size: row.file_size,
            document_kind: row.document_kind,
            confidence: row.confidence,
            reason: row.reason,
            classifier_model: row.classifier_model,
            grids,
            classification: fields,
            hit_count: row.hit_count + 1,
            created_at: row.created_at,
            expires_at: row.expires_at,
        };
    } catch (e) {
        console.warn('[document_cache] getCached 실패:', e.message);
        return null;
    }
}

/**
 * @param {object} pool
 * @param {{ hash:string, format:string, size:number,
 *           grids?:object, classification:object, ttlDays?:number }} args
 */
async function putCache(pool, args) {
    if (!pool || !args?.hash || !args?.classification) return null;
    const ttlDays = args.ttlDays ?? DEFAULT_TTL_DAYS;
    const gridsJson = args.grids ? JSON.stringify(args.grids) : null;
    const fieldsJson = JSON.stringify(args.classification);
    const cls = args.classification || {};
    try {
        await pool.execute(
            `INSERT INTO application_document_cache
                (file_hash, file_format, file_size,
                 document_kind, confidence, reason, classifier_model,
                 grids_json, fields_json, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))
             ON DUPLICATE KEY UPDATE
                file_format = VALUES(file_format),
                file_size = VALUES(file_size),
                document_kind = VALUES(document_kind),
                confidence = VALUES(confidence),
                reason = VALUES(reason),
                classifier_model = VALUES(classifier_model),
                grids_json = VALUES(grids_json),
                fields_json = VALUES(fields_json),
                expires_at = DATE_ADD(NOW(), INTERVAL ${parseInt(ttlDays, 10)} DAY)`,
            [
                args.hash, args.format || 'hwp', args.size || 0,
                cls.document_kind || null,
                cls.confidence == null ? null : Number(cls.confidence),
                cls.reason || null,
                cls.model || null,
                gridsJson, fieldsJson, ttlDays,
            ]
        );
        return { ok: true };
    } catch (e) {
        console.warn('[document_cache] putCache 실패:', e.message);
        return { ok: false, error: e.message };
    }
}

async function cleanupExpired(pool) {
    if (!pool) return { ok: false, error: 'pool 없음' };
    try {
        const [r] = await pool.execute(
            `DELETE FROM application_document_cache WHERE expires_at <= NOW()`
        );
        return { ok: true, deleted: r.affectedRows };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

let _cronStarted = false;
function startCleanupCron(pool, opts = {}) {
    if (_cronStarted) return;
    _cronStarted = true;
    const cron = require('node-cron');
    const dailyExpr = opts.cronExpr || '17 3 * * *';   // 매일 03:17 — 만료 캐시 정리
    cron.schedule(dailyExpr, async () => {
        const r = await cleanupExpired(pool);
        if (r.ok && r.deleted > 0) {
            console.log(`[document_cache] cleanup: ${r.deleted}건 만료 캐시 삭제`);
        } else if (!r.ok) {
            console.warn('[document_cache] cleanup 실패:', r.error);
        }
    }, { timezone: 'Asia/Seoul' });
    console.log(`[document_cache] cleanup cron 활성: "${dailyExpr}" (Asia/Seoul, TTL ${DEFAULT_TTL_DAYS}일)`);

    // filled S3 객체 자동 만료 (5분마다 검사)
    const s3 = require('./s3');
    const filledExpr = opts.filledCronExpr || '*/5 * * * *';
    cron.schedule(filledExpr, async () => {
        try {
            const [rows] = await pool.execute(
                `SELECT id, filled_s3_key
                   FROM application_sessions
                  WHERE filled_s3_key IS NOT NULL
                    AND filled_expires_at IS NOT NULL
                    AND filled_expires_at <= NOW()
                  LIMIT 200`
            );
            if (rows.length === 0) return;
            const keys = rows.map((r) => r.filled_s3_key).filter(Boolean);
            const ids = rows.map((r) => r.id);
            const deleted = await s3.deleteKeys(keys);
            await pool.execute(
                `UPDATE application_sessions
                    SET filled_s3_key = NULL, filled_expires_at = NULL
                  WHERE id IN (${ids.map(() => '?').join(',')})`,
                ids
            );
            console.log(`[filled_sweeper] 만료 filled S3 ${deleted}건 삭제 (sessions: ${ids.length})`);
        } catch (e) {
            console.warn('[filled_sweeper] 실패:', e.message);
        }
    }, { timezone: 'Asia/Seoul' });
    console.log(`[filled_sweeper] cron 활성: "${filledExpr}" (Asia/Seoul)`);
}

module.exports = {
    sha256OfFile,
    getCached,
    putCache,
    cleanupExpired,
    startCleanupCron,
    DEFAULT_TTL_DAYS,
};
