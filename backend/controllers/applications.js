'use strict';

/**
 * 신청서 작성 에이전트 라우트.
 *   POST   /api/applications/start
 *   GET    /api/applications/:sessionId
 *   POST   /api/applications/:sessionId/chat
 *   POST   /api/applications/:sessionId/field
 *   POST   /api/applications/:sessionId/finalize
 *   POST   /api/applications/:sessionId/choose-attachment
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { pipeline: streamPipeline } = require('stream/promises');
const OpenAI = require('openai');

const { findApplicationAttachments } = require('../services/announcement_crawler');
const s3 = require('../services/s3');
const bridge = require('../services/hwp_bridge');
const { normalizeFields, buildApplyPayload, validateLocationForApply } = require('../services/field_extractor');
const {
    classifyFields,
    rehydrateClassificationWithGrids,
    reconcileClassificationWithFillable,
} = require('../services/field_classifier');
const documentCache = require('../services/document_cache');
const { analysisQueue } = require('../services/analysis_queue');

const FILLED_TTL_MIN = parseInt(process.env.APPLICATION_FILLED_TTL_MIN || '15', 10);

/** 그리드 추출·위치 검증·캐시 스키마 변경 시 1씩 올려 기존 캐시 무효화 */
const APPLICATION_ANALYSIS_REVISION = 3;

const PROGRESS = {
    QUEUED:        { stage: 'queued',           percent: 5 },
    CRAWLING:      { stage: 'crawling',         percent: 12 },
    DOWNLOADING:   { stage: 'downloading',      percent: 25 },
    HASHING:       { stage: 'hashing',          percent: 32 },
    CACHE_HIT:     { stage: 'cache_hit',        percent: 92 },
    EXTRACTING:    { stage: 'extracting_grids', percent: 45 },
    CLASSIFYING:   { stage: 'classifying_llm',  percent: 75 },
    PERSISTING:    { stage: 'persisting',       percent: 95 },
    COLLECTING:    { stage: 'collecting',       percent: 100 },
    FILLING:       { stage: 'filling',          percent: 96 },
    DONE:          { stage: 'done',             percent: 100 },
    FAILED:        { stage: 'failed',           percent: 0 },
};

const SAFE_INPUT_TYPES = new Set([
    'text', 'longtext', 'number', 'date', 'phone', 'email', 'biz_no', 'checkbox', 'radio',
]);
// MANUAL_ONLY: DB 에 저장은 하되, 자동 채움/finalize 미수집 집계에서 제외.
// 사용자에게는 «직접 작성 필요» 배지로 안내.
const MANUAL_ONLY_TYPES = new Set(['signature']);

const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const SESSION_STATUS = {
    CREATED: 'created',
    CRAWLING: 'crawling',
    UPLOADING: 'uploading',
    ANALYZING: 'analyzing',
    COLLECTING: 'collecting',
    FILLING: 'filling',
    DONE: 'done',
    FAILED: 'failed',
};

function buildRouter({ pool, openai }) {
    const router = express.Router();
    if (!openai) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    // 공고 URL 기준 첨부파일(.hwp/.hwpx) 존재 여부를 미리 확인
    // 프론트 버튼 노출/비노출 판단에 사용
    router.get('/check-attachments', async (req, res) => {
        const programUrl = String(req.query?.programUrl || '').trim();
        if (!programUrl) {
            return res.status(400).json({ ok: false, error: 'programUrl 필수' });
        }
        try {
            const crawl = await findApplicationAttachments(programUrl);
            if (!crawl.ok) {
                return res.json({
                    ok: true,
                    hasSupported: false,
                    hasEligible: false,
                    candidates: [],
                    error: crawl.error || null,
                });
            }
            const eligible = Array.isArray(crawl.eligible) ? crawl.eligible : [];
            return res.json({
                ok: true,
                hasSupported: Array.isArray(crawl.candidates) && crawl.candidates.length > 0,
                hasEligible: eligible.length > 0,
                candidates: (crawl.candidates || []).slice(0, 10),
                eligible_candidates: eligible.slice(0, 10),
            });
        } catch (e) {
            console.error('[applications] /check-attachments error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/start', async (req, res) => {
        const { programId, programTitle, programUrl, fileUrl, fileName, userId } = req.body || {};
        if (!programId) return res.status(400).json({ ok: false, error: 'programId 필수' });
        if (!programUrl && !fileUrl) {
            return res.status(400).json({ ok: false, error: 'programUrl 또는 fileUrl 중 하나는 필수' });
        }
        try {
            const [r] = await pool.execute(
                `INSERT INTO application_sessions
                    (user_id, program_id, program_title, program_url, source_file_url, status)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId || null, String(programId), programTitle || null,
                 programUrl || null, fileUrl || null, SESSION_STATUS.CREATED]
            );
            const sessionId = r.insertId;
            await _appendMessage(pool, sessionId, 'system', '신청서 작성 세션을 시작합니다.');

            // 분석 작업을 직렬 큐에 등록 — 동시 1건만 실행, 나머지는 대기
            const queueLen = analysisQueue.queueLength();
            await _setProgress(pool, sessionId, PROGRESS.QUEUED, { queue_position: queueLen });
            const ticket = analysisQueue.enqueue({
                key: `session:${sessionId}`,
                onPositionChange: (pos) => {
                    _setProgress(pool, sessionId, PROGRESS.QUEUED, { queue_position: pos })
                        .catch((e) => console.warn('progress 업데이트 실패:', e.message));
                },
                run: async () => {
                    await _setProgress(pool, sessionId, PROGRESS.QUEUED, { queue_position: 0, started: true });
                    return _runPreparePipeline(pool, sessionId, { programUrl, fileUrl, fileName });
                },
            });

            return res.json({
                ok: true,
                sessionId,
                status: SESSION_STATUS.CREATED,
                queue_position: ticket.position,
            });
        } catch (e) {
            console.error('[applications] /start error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/:sessionId', async (req, res) => {
        const sessionId = parseInt(req.params.sessionId, 10);
        if (!Number.isInteger(sessionId)) return res.status(400).json({ ok: false, error: 'sessionId 정수 아님' });
        try {
            const data = await _loadSessionFull(pool, sessionId);
            if (!data) return res.status(404).json({ ok: false, error: '세션 없음' });
            let downloadUrl = null;
            if (data.session.status === SESSION_STATUS.DONE && data.session.filled_s3_key && s3.isS3Enabled()) {
                try {
                    downloadUrl = await s3.getPresignedDownloadUrl({
                        key: data.session.filled_s3_key,
                        fileName: data.session.chosen_attachment_name || 'application.hwp',
                        expiresInSeconds: Math.max(60, FILLED_TTL_MIN * 60),
                    });
                } catch (e) { console.warn('presign 실패:', e.message); }
            }
            let candidates = null;
            if (data.session.status === 'awaiting_choice' && data.session.error_message) {
                try {
                    const parsed = JSON.parse(data.session.error_message);
                    if (Array.isArray(parsed.candidates)) candidates = parsed.candidates;
                } catch (_) { /* not JSON */ }
            }
            return res.json({
                ok: true,
                ...data,
                downloadUrl,
                candidates,
                queue_snapshot: analysisQueue.snapshot(),
            });
        } catch (e) {
            console.error('[applications] /get error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/:sessionId/chat', async (req, res) => {
        const sessionId = parseInt(req.params.sessionId, 10);
        const { message } = req.body || {};
        if (!Number.isInteger(sessionId)) return res.status(400).json({ ok: false, error: 'sessionId 정수 아님' });
        try {
            const data = await _loadSessionFull(pool, sessionId);
            if (!data) return res.status(404).json({ ok: false, error: '세션 없음' });
            if (data.session.status !== SESSION_STATUS.COLLECTING && data.session.status !== SESSION_STATUS.DONE) {
                return res.status(409).json({ ok: false, error: `현재 상태(${data.session.status})에서는 채팅 불가`, status: data.session.status });
            }

            if (typeof message === 'string' && message.trim()) {
                await _appendMessage(pool, sessionId, 'user', message.trim());
            }
            _logApp('chat.request', sessionId, {
                status: data.session.status,
                message_len: typeof message === 'string' ? message.trim().length : 0,
            });

            const refreshed = await _loadSessionFull(pool, sessionId);
            const userMessage = (typeof message === 'string' ? message.trim() : '');
            const result = await _chatStep({ pool, openai, sessionData: refreshed, userMessage });
            _logApp('chat.result', sessionId, {
                applied: result.applied || 0,
                skipped: result.skipped || 0,
                allFilled: !!result.allFilled,
            });
            return res.json({ ok: true, ...result });
        } catch (e) {
            console.error('[applications] /chat error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/:sessionId/field', async (req, res) => {
        const sessionId = parseInt(req.params.sessionId, 10);
        const { fieldId, value } = req.body || {};
        if (!Number.isInteger(sessionId)) return res.status(400).json({ ok: false, error: 'sessionId 정수 아님' });
        if (!fieldId || typeof value !== 'string') return res.status(400).json({ ok: false, error: 'fieldId, value 필수' });
        try {
            const [r] = await pool.execute(
                `UPDATE application_fields
                    SET value = ?, is_filled = 1, filled_at = NOW(),
                        is_skipped = 0, skipped_at = NULL
                  WHERE id = ? AND session_id = ?`,
                [value, fieldId, sessionId]
            );
            if (r.affectedRows === 0) return res.status(404).json({ ok: false, error: '해당 fieldId 없음' });
            const data = await _loadSessionFull(pool, sessionId);
            return res.json({ ok: true, fields: data.fields });
        } catch (e) {
            console.error('[applications] /field error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    /**
     * 필드 건너뛰기 / 건너뛰기 취소.
     *  - body { fieldId, skip: true | false }
     *  - skip=true 면 is_skipped=1, value=null, is_filled=0
     *  - skip=false 면 is_skipped=0 (다시 미수집 상태로 복귀)
     */
    router.post('/:sessionId/field/skip', async (req, res) => {
        const sessionId = parseInt(req.params.sessionId, 10);
        const { fieldId, skip } = req.body || {};
        if (!Number.isInteger(sessionId)) return res.status(400).json({ ok: false, error: 'sessionId 정수 아님' });
        if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId 필수' });
        const wantSkip = skip !== false;  // 기본 true
        try {
            const [r] = wantSkip
                ? await pool.execute(
                    `UPDATE application_fields
                        SET is_skipped = 1, skipped_at = NOW(),
                            is_filled = 0, value = NULL, filled_at = NULL
                      WHERE id = ? AND session_id = ?`,
                    [fieldId, sessionId]
                  )
                : await pool.execute(
                    `UPDATE application_fields
                        SET is_skipped = 0, skipped_at = NULL
                      WHERE id = ? AND session_id = ?`,
                    [fieldId, sessionId]
                  );
            if (r.affectedRows === 0) return res.status(404).json({ ok: false, error: '해당 fieldId 없음' });
            const data = await _loadSessionFull(pool, sessionId);
            return res.json({ ok: true, fields: data.fields });
        } catch (e) {
            console.error('[applications] /field/skip error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    /**
     * 현재 필드에 넣을 문구 추천.
     * body: { fieldId, industrySubcategory?: string }
     */
    router.post('/:sessionId/recommend-field', async (req, res) => {
        const sessionId = parseInt(req.params.sessionId, 10);
        const { fieldId, industrySubcategory } = req.body || {};
        if (!Number.isInteger(sessionId)) return res.status(400).json({ ok: false, error: 'sessionId 정수 아님' });
        if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId 필수' });
        try {
            const data = await _loadSessionFull(pool, sessionId);
            if (!data) return res.status(404).json({ ok: false, error: '세션 없음' });
            const target = data.fields.find((f) => Number(f.id) === Number(fieldId));
            if (!target) return res.status(404).json({ ok: false, error: '해당 fieldId 없음' });

            const used = data.fields
                .filter((f) => f.is_filled && f.value)
                .slice(0, 8)
                .map((f) => `${f.prompt_label}: ${f.value}`)
                .join('\n');

            const systemPrompt = [
                '너는 소상공인 지원사업 신청서 작성 도우미다.',
                '반드시 문서 맥락(공고 제목/필드 라벨/이미 작성된 값)을 기반으로만 추천한다.',
                '과장/허위 표현 금지, 구체적이고 실제 제출 가능한 문장만 제시한다.',
                '출력은 JSON: {"suggestions":[string,string,string]}',
            ].join('\n');
            const userPrompt = [
                `공고 제목: ${data.session.program_title || '(없음)'}`,
                `현재 필드: ${target.prompt_label}`,
                `필드 타입: ${target.kind}`,
                `필드 힌트: ${target.placeholder_text || '(없음)'}`,
                `소분류 업종: ${industrySubcategory || '(미제공)'}`,
                '',
                '이미 작성된 값:',
                used || '(없음)',
                '',
                '요청: 위 필드에 바로 넣을 수 있는 추천 문구 3개를 만들어줘.',
            ].join('\n');

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.5,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            });
            const raw = completion.choices?.[0]?.message?.content || '{}';
            let parsed = {};
            try { parsed = JSON.parse(raw); } catch (_) { /* ignore */ }
            let suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
            suggestions = suggestions
                .map((s) => String(s || '').trim())
                .filter(Boolean)
                .slice(0, 3);
            if (suggestions.length === 0) {
                suggestions = [
                    `${target.prompt_label} 관련 핵심 내용을 간결히 작성해 주세요.`,
                    `${target.prompt_label}에 대해 현재 사업의 목적과 실행 계획을 포함해 주세요.`,
                    `${target.prompt_label} 항목은 실제 운영 상황에 맞춰 구체적으로 작성해 주세요.`,
                ];
            }
            return res.json({ ok: true, suggestions });
        } catch (e) {
            console.error('[applications] /recommend-field error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/:sessionId/finalize', async (req, res) => {
        const sessionId = parseInt(req.params.sessionId, 10);
        if (!Number.isInteger(sessionId)) return res.status(400).json({ ok: false, error: 'sessionId 정수 아님' });
        try {
            const r = await _finalize(pool, sessionId);
            return res.json(r);
        } catch (e) {
            console.error('[applications] /finalize error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/:sessionId/choose-attachment', async (req, res) => {
        const sessionId = parseInt(req.params.sessionId, 10);
        const { url, fileName } = req.body || {};
        if (!Number.isInteger(sessionId)) return res.status(400).json({ ok: false, error: 'sessionId 정수 아님' });
        if (!url) return res.status(400).json({ ok: false, error: 'url 필수' });

        // 사용자가 .hwp/.hwpx 가 아닌 후보를 직접 클릭한 경우 거부
        const ext = (fileName || url || '').toLowerCase().match(/\.(hwpx?)(\?|$)/i)?.[1]?.toLowerCase();
        if (ext !== 'hwp' && ext !== 'hwpx') {
            return res.status(400).json({ ok: false, error: '신청서 자동 작성은 .hwp / .hwpx 파일만 지원합니다.' });
        }

        try {
            const current = await _loadSessionFull(pool, sessionId);
            if (!current) return res.status(404).json({ ok: false, error: '세션 없음' });
            if ([SESSION_STATUS.CRAWLING, SESSION_STATUS.UPLOADING, SESSION_STATUS.ANALYZING].includes(current.session.status)) {
                return res.status(409).json({ ok: false, error: '이미 처리 중입니다. 잠시 후 다시 확인해주세요.' });
            }
            if (current.session.status === 'awaiting_choice') {
                let allowed = [];
                try {
                    const parsed = JSON.parse(current.session.error_message || '{}');
                    allowed = Array.isArray(parsed.candidates) ? parsed.candidates.map((c) => c.url) : [];
                } catch (_) { /* ignore */ }
                if (allowed.length > 0 && !allowed.includes(url)) {
                    return res.status(400).json({ ok: false, error: '선택 가능한 첨부파일 목록에 없는 URL입니다.' });
                }
            }
            await pool.execute(
                `UPDATE application_sessions
                    SET chosen_attachment_url = ?, chosen_attachment_name = ?, status = ?
                  WHERE id = ?`,
                [url, fileName || null, SESSION_STATUS.UPLOADING, sessionId]
            );
            await _appendMessage(pool, sessionId, 'system', `첨부파일을 선택했습니다: ${fileName || url}`);

            const queueLen = analysisQueue.queueLength();
            await _setProgress(pool, sessionId, PROGRESS.QUEUED, { queue_position: queueLen });
            const ticket = analysisQueue.enqueue({
                key: `session:${sessionId}`,
                onPositionChange: (pos) => {
                    _setProgress(pool, sessionId, PROGRESS.QUEUED, { queue_position: pos })
                        .catch(() => {});
                },
                run: async () => {
                    await _setProgress(pool, sessionId, PROGRESS.QUEUED, { queue_position: 0, started: true });
                    return _runPrepareFromAttachment(pool, sessionId, { url, fileName });
                },
            });
            return res.json({ ok: true, status: SESSION_STATUS.UPLOADING, queue_position: ticket.position });
        } catch (e) {
            console.error('[applications] /choose-attachment error:', e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    return router;
}

/* ----------------------- 비동기 파이프라인 ----------------------- */

async function _runPreparePipeline(pool, sessionId, { programUrl, fileUrl, fileName }) {
    // hard mode: programUrl 이 있으면 카드의 대표 fileUrl(pdf 등)은 무시하고
    // 반드시 공고 첨부 목록을 크롤링해서 사용자 선택 경로를 탄다.
    let attachmentUrl = (!programUrl && fileUrl) ? fileUrl : null;
    let attachmentName = (!programUrl && fileUrl) ? (fileName || null) : null;

    if (!attachmentUrl && programUrl) {
        await _setStatus(pool, sessionId, SESSION_STATUS.CRAWLING);
        await _setProgress(pool, sessionId, PROGRESS.CRAWLING);
        const crawl = await findApplicationAttachments(programUrl);
        if (!crawl.ok || !crawl.best) {
            await _setStatus(pool, sessionId, SESSION_STATUS.FAILED, crawl.error || '첨부 .hwp/.hwpx 후보 없음');
            await _appendMessage(pool, sessionId, 'system',
                '신청서 첨부파일을 찾지 못했습니다. 공고 페이지에서 직접 다운로드 받아주세요.');
            return;
        }
        const eligible = Array.isArray(crawl.eligible) ? crawl.eligible : [];
        if (eligible.length === 0) {
            await _setStatus(pool, sessionId, SESSION_STATUS.FAILED, '신청서식으로 보이는 .hwp/.hwpx 첨부가 없습니다.');
            await _appendMessage(pool, sessionId, 'assistant',
                '첨부파일은 있으나 신청서식으로 판단되는 hwp/hwpx를 찾지 못했습니다. 공고문/안내문이 아닌 신청서식 파일을 직접 선택해 주세요.');
            return;
        }

        // 하드 모드: 자동선택 금지. 후보가 1개여도 사용자가 최종 확인 후 선택
        {
            const choices = eligible.slice(0, 10).map((c, i) => `${i + 1}. ${c.fileName}`).join('\n');
            await _appendMessage(pool, sessionId, 'assistant',
                `여러 첨부파일 후보가 발견됐습니다. 어떤 것을 신청서로 사용할까요?\n${choices}\n\n원하시는 번호 또는 파일명을 알려주세요.`);
            await pool.execute(
                `UPDATE application_sessions SET status = ?, chosen_attachment_url = NULL WHERE id = ?`,
                ['awaiting_choice', sessionId]
            );
            await pool.execute(
                `UPDATE application_sessions SET error_message = ? WHERE id = ?`,
                [JSON.stringify({ candidates: eligible.slice(0, 10) }), sessionId]
            );
            return;
        }
    }

    await pool.execute(
        `UPDATE application_sessions SET chosen_attachment_url = ?, chosen_attachment_name = ? WHERE id = ?`,
        [attachmentUrl, attachmentName, sessionId]
    );
    await _runPrepareFromAttachment(pool, sessionId, { url: attachmentUrl, fileName: attachmentName });
}

async function _runPrepareFromAttachment(pool, sessionId, { url, fileName }) {
    let localPath = null;
    try {
        // 1) 다운로드
        await _setProgress(pool, sessionId, PROGRESS.DOWNLOADING);
        await _setStatus(pool, sessionId, SESSION_STATUS.UPLOADING);
        const ext = (path.extname(fileName || url || '').toLowerCase().replace(/^\./, '')) || 'hwp';
        const safeExt = ['hwp', 'hwpx'].includes(ext) ? ext : 'hwp';
        const localName = `app_${sessionId}_raw.${safeExt}`;
        localPath = path.join(TEMP_DIR, localName);
        const resp = await axios.get(url, {
            responseType: 'stream', timeout: 60_000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            },
            validateStatus: (s) => s >= 200 && s < 400,
        });
        await streamPipeline(resp.data, fs.createWriteStream(localPath));

        // 시그니처 검증 (.hwp = OLE / .hwpx = ZIP)
        const sigValid = await _verifyFormatSignature(localPath, safeExt);
        if (!sigValid) {
            throw new Error('다운로드된 파일이 .hwp/.hwpx 형식이 아닙니다 (시그니처 불일치).');
        }

        // 개인정보 보호: raw 는 S3 에 저장하지 않음. 분석 후 즉시 삭제.
        await pool.execute(
            `UPDATE application_sessions
                SET raw_format = ?, raw_s3_key = NULL, status = ?, error_message = NULL
              WHERE id = ?`,
            [safeExt, SESSION_STATUS.ANALYZING, sessionId]
        );

        // 2) 해시 + 캐시 조회
        await _setProgress(pool, sessionId, PROGRESS.HASHING);
        const fileHash = await documentCache.sha256OfFile(localPath);
        const fileSize = fs.statSync(localPath).size;
        await pool.execute(
            `UPDATE application_sessions SET file_hash = ? WHERE id = ?`,
            [fileHash, sessionId]
        );

        const cached = await documentCache.getCached(pool, fileHash).catch(() => null);
        let analyzed;
        if (cached && cached.classification && Array.isArray(cached.classification.fields)
            && cached.classification.analysis_revision === APPLICATION_ANALYSIS_REVISION) {
            await _setProgress(pool, sessionId, PROGRESS.CACHE_HIT);
            const clsHydrated = rehydrateClassificationWithGrids(cached.grids, cached.classification);
            const fillableCached = await bridge.listFillableCells(localPath, { timeoutMs: 90_000 });
            const clsMerged = fillableCached.ok
                ? reconcileClassificationWithFillable(clsHydrated, fillableCached)
                : clsHydrated;
            const rows = _classificationToRows(clsMerged, safeExt);
            analyzed = {
                ok: true, rows,
                document_kind: cached.document_kind,
                confidence: cached.confidence,
                via: 'cache',
                cache: { hit_count: cached.hit_count, expires_at: cached.expires_at },
            };
        } else {
            // 3) 그리드 추출
            await _setProgress(pool, sessionId, PROGRESS.EXTRACTING);
            const grids = await bridge.extractTableGrids(localPath, { timeoutMs: 90_000 });
            if (!grids.ok) throw new Error(`grids 추출 실패: ${grids.error}`);

            // 4) LLM 분류
            await _setProgress(pool, sessionId, PROGRESS.CLASSIFYING);
            const cls = await classifyFields(grids, openaiOf(pool), { model: 'gpt-4o-mini', maxRetries: 1 });
            if (!cls.ok) throw new Error(`LLM 분류 실패: ${cls.error}`);

            // 캐시 저장 (best-effort)
            documentCache.putCache(pool, {
                hash: fileHash, format: safeExt, size: fileSize,
                grids,
                classification: { ...cls, analysis_revision: APPLICATION_ANALYSIS_REVISION },
            }).catch(() => {});

            const fillableFresh = await bridge.listFillableCells(localPath, { timeoutMs: 90_000 });
            const clsMerged = fillableFresh.ok
                ? reconcileClassificationWithFillable(cls, fillableFresh)
                : cls;
            const rows = _classificationToRows(clsMerged, safeExt);
            analyzed = {
                ok: true, rows,
                document_kind: cls.document_kind,
                confidence: cls.confidence,
                via: 'llm',
                usage: cls.usage,
            };
        }

        // 5) 영속화
        await _setProgress(pool, sessionId, PROGRESS.PERSISTING);

        if (analyzed.document_kind === 'notice') {
            await _setStatus(pool, sessionId, SESSION_STATUS.COLLECTING);
            await _setProgress(pool, sessionId, PROGRESS.COLLECTING);
            await _appendMessage(pool, sessionId, 'assistant',
                '이 파일은 신청서가 아닌 «공고/안내» 문서로 보입니다. 사업 공고 페이지에서 별도 신청서 양식 파일을 첨부해 주세요. (공고문은 그대로 다운로드 가능합니다)');
            return;
        }

        const rows = analyzed.rows;
        if (rows.length === 0) {
            await _setStatus(pool, sessionId, SESSION_STATUS.COLLECTING);
            await _setProgress(pool, sessionId, PROGRESS.COLLECTING);
            await _appendMessage(pool, sessionId, 'assistant',
                '신청서에서 자동으로 채울 만한 빈 항목을 찾지 못했습니다. 그래도 다운로드는 받으실 수 있습니다.');
            return;
        }
        // 중복 실행 방지: 기존 필드 제거 후 재삽입
        await pool.execute(`DELETE FROM application_fields WHERE session_id = ?`, [sessionId]);
        for (const row of rows) {
            await pool.execute(
                `INSERT INTO application_fields
                    (session_id, kind, location_json, prompt_label, placeholder_text, order_index)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [sessionId, row.kind, row.location_json, row.prompt_label,
                 row.placeholder_text || null, row.order_index]
            );
        }
        await _setStatus(pool, sessionId, SESSION_STATUS.COLLECTING);
        await _setProgress(pool, sessionId, PROGRESS.COLLECTING);
        _logApp('prepare.fields.persisted', sessionId, { count: rows.length });
        let meta;
        if (analyzed.via === 'cache') {
            meta = `이전 분석 결과를 즉시 불러와 ${rows.length}개 항목을 준비했습니다`;
        } else {
            meta = `${rows.length}개 항목을 정리했습니다`;
        }
        const firstLabel = rows[0]?.prompt_label;
        const firstAsk = firstLabel
            ? `첫 항목은 '${firstLabel}'입니다. 내용을 알려주세요.`
            : '첫 항목부터 같이 진행해 보겠습니다.';
        await _appendAssistantDedup(pool, sessionId,
            `신청서 분석을 마쳤습니다. ${meta}. ${firstAsk}`);
    } catch (e) {
        console.error('[applications] prepare error:', e);
        await _setStatus(pool, sessionId, SESSION_STATUS.FAILED, e.message);
        await _setProgress(pool, sessionId, PROGRESS.FAILED);
        await _appendMessage(pool, sessionId, 'system', `처리 중 오류: ${e.message}`);
    } finally {
        // 개인정보 보호: 로컬 raw 즉시 삭제
        if (localPath && fs.existsSync(localPath)) {
            try { fs.unlinkSync(localPath); } catch (_) { /* ignore */ }
        }
    }
}

async function _verifyFormatSignature(filePath, ext) {
    const fd = await fs.promises.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(8);
        await fd.read(buf, 0, 8, 0);
        if (ext === 'hwp') {
            return buf.equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]));
        }
        if (ext === 'hwpx') {
            return buf.slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]));
        }
        return false;
    } finally {
        await fd.close();
    }
}

/* ----------------------- 분석 (LLM 우선, 휴리스틱 fallback) ----------------------- */

let _openaiSingleton = null;
function openaiOf(_pool) {
    if (_openaiSingleton) return _openaiSingleton;
    _openaiSingleton = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openaiSingleton;
}

/**
 * classifyFields 결과 → DB 삽입용 row 배열로 정규화 (P0 안전장치 포함).
 * @param {string} format  'hwp' | 'hwpx' — location_json 기하 검증에 사용
 */
function _classificationToRows(cls, format) {
    const fmt = format === 'hwpx' ? 'hwpx' : 'hwp';
    const filtered = (cls.fields || []).filter((f) => {
        const it = String(f.input_type || '').toLowerCase();
        if (!SAFE_INPUT_TYPES.has(it) && !MANUAL_ONLY_TYPES.has(it)) return false;
        if (!Number.isInteger(f.row_index) || !Number.isInteger(f.col_index) || !Number.isInteger(f.table_index)) {
            return false;
        }
        return true;
    });
    const out = [];
    let idx = 0;
    for (const f of filtered) {
        const it = String(f.input_type || '').toLowerCase();
        const isManual = MANUAL_ONLY_TYPES.has(it);
        const meta = f._cell_meta || {};
        const docLab = typeof f._doc_label_text === 'string' && f._doc_label_text.trim()
            ? f._doc_label_text.trim()
            : null;
        const gridLabelCol = Number.isInteger(f._grid_label_col) ? f._grid_label_col : null;
        const location = {
            section_index: f.section_index != null ? f.section_index : (fmt === 'hwp' ? 0 : null),
            section_path: f.section_path ?? null,
            table_index: f.table_index,
            row_index: f.row_index,
            label_col: gridLabelCol != null ? gridLabelCol : (f.col_index > 0 ? f.col_index - 1 : 0),
            value_col: f.col_index,
            label_text: docLab || f.prompt_label,
            composed_label: f.context ? `${f.context} / ${f.prompt_label}` : null,
            input_type: it,
            options: f.options || null,
            manual_only: isManual || null,
            value_para_text_seqno: meta.first_pt ?? null,
            value_para_header_seqno: meta.first_para_hdr ?? null,
            needs_inject: (meta.first_pt == null && meta.first_para_hdr != null) || (meta.has_t === false) || null,
        };
        if (!isManual && !validateLocationForApply(location, fmt)) {
            console.warn('[applications] 분류 필드 제외(위치 정보 불완전):', f.prompt_label, location);
            continue;
        }
        const placeholder = isManual
            ? '✍ 자동 입력 불가 — 인쇄 후 직접 서명/날인'
            : (f.placeholder_hint || null);
        out.push({
            kind: it,
            location_json: JSON.stringify(location),
            prompt_label: f.prompt_label,
            placeholder_text: placeholder,
            order_index: idx,
        });
        idx += 1;
    }
    return out;
}

/* ----------------------- 채팅 (gpt-4o-mini) ----------------------- */

function _wantsSkipAllRemaining(userMessage) {
    const raw = String(userMessage || '').trim();
    if (!raw) return false;
    const t = raw.toLowerCase();
    if (/skip\s*all/i.test(t)) return true;
    // 나머지 전부 건너뛰기 / 다 스킵 / 남은 거 스킵 등
    return (
        /나머지\s*(전부|모두|다|것)?\s*건너/.test(raw)
        || /(전부|모두|다)\s*(건너|스킵|skip)/i.test(raw)
        || /남은\s*(항목|것|거)?\s*(전부|모두)?\s*(건너|스킵)/.test(raw)
        || /더\s*이상\s*(안\s*)?(채우|작성|입력)/.test(raw)
    );
}

async function _chatStep({ pool, openai, sessionData, userMessage = '' }) {
    const { fields, messages, session } = sessionData;
    const autoFields = fields.filter((f) => !MANUAL_ONLY_TYPES.has(String(f.kind).toLowerCase()));
    // 미수집 = filled 도 skipped 도 아닌 것
    const unfilled = autoFields.filter((f) => !f.is_filled && !f.is_skipped);
    if (unfilled.length === 0) {
        const skippedCnt = autoFields.filter((f) => f.is_skipped).length;
        const reply = skippedCnt > 0
            ? `자동 입력 가능한 항목을 모두 처리했습니다! (${skippedCnt}개는 건너뛰셨고, 인쇄 후 직접 채워주세요) 「작성 완료」 버튼을 눌러 신청서를 받으세요.`
            : '모든 자동 입력 항목을 채웠습니다! 「작성 완료」 버튼을 눌러 신청서를 받으세요.';
        await _appendAssistantDedup(pool, session.id, reply);
        return { reply, fields, allFilled: true };
    }

    const typeHint = (kind) => {
        const k = String(kind).toLowerCase();
        switch (k) {
            case 'date': return '예시) 2026-01-31 또는 "2026년 1월 31일"';
            case 'phone': return '예시) 010-1234-5678';
            case 'email': return '예시) example@domain.com';
            case 'biz_no': return '예시) 123-45-67890';
            case 'number': return '숫자만 입력 (단위 미포함)';
            case 'longtext': return '200자 이상 권장 (사업계획·상품설명 등)';
            case 'checkbox': return '여러 개 선택 가능';
            case 'radio': return '하나만 선택';
            default: return '';
        }
    };
    const parseLocation = (loc) => {
        if (!loc) return {};
        if (typeof loc === 'string') {
            try { return JSON.parse(loc); } catch (_) { return {}; }
        }
        return loc;
    };

    // 빠른 경로: 빈 message(다음 질문 요청)는 LLM 없이 즉시 다음 1개 항목만 질문
    const next = unfilled[0];
    if (next && !String(userMessage || '').trim()) {
        const hint = typeHint(next.kind);
        const suffix = hint ? ` (${hint})` : '';
        const reply = `다음 항목인 '${next.prompt_label}'에 대해 알려주세요.${suffix}`;
        await _appendAssistantDedup(pool, session.id, reply);
        return { reply, fields, allFilled: false, applied: 0, skipped: 0 };
    }

    // 한 번에 «나머지 전부 건너뛰기» (LLM 한 턴 1칸 스킵 한계 보완)
    if (String(userMessage || '').trim() && _wantsSkipAllRemaining(userMessage) && unfilled.length > 0) {
        const ids = unfilled.map((f) => f.id);
        const placeholders = ids.map(() => '?').join(',');
        await pool.execute(
            `UPDATE application_fields
                SET is_skipped = 1, skipped_at = NOW(),
                    is_filled = 0, value = NULL, filled_at = NULL
              WHERE session_id = ? AND id IN (${placeholders})`,
            [session.id, ...ids]
        );
        const refreshed = await _loadSessionFull(pool, session.id);
        const reply = `요청하신 대로 남은 ${ids.length}개 항목을 모두 건너뛰었습니다. 인쇄 후 직접 작성해 주세요. 「작성 완료」 버튼으로 파일을 받으실 수 있습니다.`;
        await _appendAssistantDedup(pool, session.id, reply);
        const autoF = refreshed.fields.filter((f) => !MANUAL_ONLY_TYPES.has(String(f.kind).toLowerCase()));
        const allFilled = autoF.every((f) => (f.is_filled && f.value) || f.is_skipped);
        return {
            reply,
            fields: refreshed.fields,
            allFilled,
            applied: 0,
            skipped: ids.length,
        };
    }

    const systemPrompt = [
        '너는 소상공인 신청서 작성을 돕는 친절한 한국어 비서야.',
        '가장 중요한 규칙: 반드시 "현재 문서에서 확인 가능한 정보"로만 답해라.',
        '문서에 없는 값/카테고리/선택지를 추측해서 만들지 마라.',
        '사용자가 "어떤 게 있어?"라고 물었을 때, 문서에 명시된 선택지(options)가 있으면 그것만 보여줘라.',
        'options가 없으면 "문서에 선택지가 명시되지 않았다"고 말하고 임의 리스트를 절대 만들지 마라.',
        '아래 미수집 필드 목록 중 가장 위에 있는 항목 하나를 사용자에게 자연스럽게 한 번에 하나씩 물어봐.',
        '사용자가 직전 답변에서 여러 항목 값을 동시에 알려줬다면 가능한 만큼 field_updates 에 한꺼번에 넣어도 좋아.',
        '값을 추출했다면 field_updates 에 {id, value} 형태로 채워줘.',
        '입력 타입(kind) 에 맞는 형식을 안내하고, 사용자 답변이 형식과 어긋나면 부드럽게 다시 물어봐.',
        '',
        '★ 건너뛰기 처리:',
        '  사용자가 「모르겠다」 「비워두자」 「나중에」 「건너뛰자」 「skip」 같은 의사를 표현하면',
        '  field_skips 배열에 그 항목의 id 를 넣어라. 그러면 다음 항목으로 자연스럽게 넘어가라.',
        '  「나머지 전부 건너뛰기」 요청은 서버에서 이미 처리되므로, 여기서는 일반 스킵 규칙만 따르면 된다.',
        '  단, 건너뛴 항목은 인쇄 후 직접 채워야 한다고 짧게 안내해줘.',
        '',
        '응답은 반드시 JSON 한 개로만:',
        '  {"reply": string,',
        '   "field_updates": [{"id": number, "value": string}],',
        '   "field_skips": [number, ...] }',
        'reply에는 검증되지 않은 업종/유형 예시를 쓰지 마라.',
        '불필요한 인사·반복은 줄이고 짧고 명확히 말해.',
        '',
        '미수집 필드:',
        ...unfilled.map((f) => {
            const hint = typeHint(f.kind);
            const ph = f.placeholder_text ? ` 힌트=${f.placeholder_text}` : '';
            const meta = parseLocation(f.location_json);
            const options = Array.isArray(meta.options) ? meta.options.filter(Boolean).slice(0, 12) : [];
            const optText = options.length > 0 ? ` options=[${options.join(', ')}]` : ' options=[]';
            return `- id=${f.id} 라벨="${f.prompt_label}" kind=${f.kind}${ph}${optText}${hint ? ` (${hint})` : ''}`;
        }),
        '',
        '이미 채워진 필드:',
        ...autoFields.filter((f) => f.is_filled && f.value)
                     .map((f) => `- ${f.prompt_label}: ${f.value}`),
        '',
        '이미 건너뛴 필드(다시 묻지 말 것):',
        ...autoFields.filter((f) => f.is_skipped)
                     .map((f) => `- ${f.prompt_label}`),
    ].join('\n');

    const recent = messages.slice(-8).map((m) => ({
        role: m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'system'),
        // 장문 히스토리로 인한 지연/타임아웃 방지
        content: String(m.content || '').slice(0, 1200),
    }));

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }, ...recent],
    });
    const raw = completion.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_e) { parsed = { reply: raw, field_updates: [] }; }

    const updates = Array.isArray(parsed.field_updates) ? parsed.field_updates : [];
    const skips = Array.isArray(parsed.field_skips) ? parsed.field_skips : [];
    const validIds = new Set(fields.map((f) => f.id));
    let appliedCount = 0;
    let skippedCount = 0;
    for (const u of updates) {
        const id = Number(u?.id);
        const value = u?.value;
        if (!validIds.has(id) || typeof value !== 'string' || !value.trim()) continue;
        await pool.execute(
            `UPDATE application_fields
                SET value = ?, is_filled = 1, filled_at = NOW(),
                    is_skipped = 0, skipped_at = NULL
              WHERE id = ? AND session_id = ?`,
            [value.trim(), id, session.id]
        );
        appliedCount += 1;
    }
    // 안전장치: 한 턴에서 스킵은 "현재 맨 앞 미수집 1개"만 허용
    const firstUnfilledId = unfilled[0]?.id ?? null;
    if (firstUnfilledId != null) {
        const requestedSkipIds = skips
            .map((raw) => Number(raw?.id ?? raw))
            .filter((id) => Number.isFinite(id));
        if (requestedSkipIds.includes(firstUnfilledId)) {
            const target = fields.find((f) => f.id === firstUnfilledId);
            if (target && !(target.is_filled && target.value) &&
                !MANUAL_ONLY_TYPES.has(String(target.kind).toLowerCase())) {
                await pool.execute(
                    `UPDATE application_fields
                        SET is_skipped = 1, skipped_at = NOW(),
                            is_filled = 0, value = NULL, filled_at = NULL
                      WHERE id = ? AND session_id = ?`,
                    [firstUnfilledId, session.id]
                );
                skippedCount = 1;
            }
        }
    }

    let reply = (parsed.reply || '계속 진행해 주세요.').toString();
    const refreshed = await _loadSessionFull(pool, session.id);
    const autoF = refreshed.fields.filter((f) => !MANUAL_ONLY_TYPES.has(String(f.kind).toLowerCase()));
    const remain = autoF.filter((f) => !f.is_filled && !f.is_skipped);

    // 환각 방지: 현재 필드에 선택지가 없는데 번호 리스트를 임의 생성하면 안전 답변으로 교체
    const current = remain[0] || null;
    if (current) {
        const curMeta = parseLocation(current.location_json);
        const hasOptions = Array.isArray(curMeta.options) && curMeta.options.length > 0;
        const looksEnumerated = /^\s*\d+\.\s+/m.test(reply);
        if (!hasOptions && looksEnumerated) {
            reply = `문서에서 '${current.prompt_label}'의 선택지를 명확히 확인하지 못했습니다. 임의 분류는 만들지 않고, 문서 기준으로 직접 입력하실 수 있도록 도와드릴게요.`;
        }
    }
    if (remain.length > 0) {
        const next = remain[0];
        const hint = typeHint(next.kind);
        const nextAsk = `다음 항목인 '${next.prompt_label}'에 대해 알려주세요.${hint ? ` (${hint})` : ''}`;
        if (!reply.includes(next.prompt_label)) {
            reply = `${reply}\n${nextAsk}`;
        }
    }
    await _appendAssistantDedup(pool, session.id, reply);

    const allFilled = autoF.every((f) => (f.is_filled && f.value) || f.is_skipped);
    return {
        reply,
        fields: refreshed.fields,
        allFilled,
        applied: appliedCount,
        skipped: skippedCount,
    };
}

/* ----------------------- finalize ----------------------- */

async function _finalize(pool, sessionId) {
    const data = await _loadSessionFull(pool, sessionId);
    if (!data) throw new Error('세션 없음');
    const { session, fields } = data;
    if (!session.chosen_attachment_url || !session.raw_format) {
        throw new Error('원본 파일이 준비되지 않았습니다.');
    }
    const autoFields = fields.filter((f) => !MANUAL_ONLY_TYPES.has(String(f.kind).toLowerCase()));
    // skipped 는 finalize 가능 — value 비워둔 채로 출력. 미수집 = !filled && !skipped.
    const unfilled = autoFields.filter((f) => !f.is_skipped && (!f.is_filled || !f.value));
    if (unfilled.length > 0) {
        return { ok: false, error: `미수집 항목 ${unfilled.length}개`, unfilled: unfilled.map((f) => f.prompt_label) };
    }
    // apply payload 에 넣을 것은 실제로 채워진 필드만.
    const filledForApply = autoFields.filter((f) => f.is_filled && f.value);
    _logApp('finalize.precheck', sessionId, {
        auto_fields: autoFields.length,
        filled_for_apply: filledForApply.length,
        skipped: autoFields.filter((f) => f.is_skipped).length,
    });
    await _setStatus(pool, sessionId, SESSION_STATUS.FILLING);
    await _setProgress(pool, sessionId, PROGRESS.FILLING);

    let srcLocal = null;
    let outLocal = null;
    try {
        const ext = session.raw_format;
        srcLocal = path.join(TEMP_DIR, `app_${sessionId}_src.${ext}`);
        outLocal = path.join(TEMP_DIR, `app_${sessionId}_filled.${ext}`);

        // 개인정보 보호: raw 는 S3 에 저장하지 않으므로 attachment_url 에서 재다운로드.
        // (다른 사용자가 같은 url 을 요청하면 캐시 hit 으로 분석은 즉시 끝남)
        const r = await axios.get(session.chosen_attachment_url, {
            responseType: 'stream', timeout: 60_000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            },
            validateStatus: (s) => s >= 200 && s < 400,
        });
        await streamPipeline(r.data, fs.createWriteStream(srcLocal));

        const sigRecheck = await _verifyFormatSignature(srcLocal, ext);
        if (!sigRecheck) {
            throw new Error('다운로드한 첨부가 원본 형식(.hwp/.hwpx)과 일치하지 않습니다. 네트워크 또는 저장 오류일 수 있습니다.');
        }

        const payload = buildApplyPayload(filledForApply, ext === 'hwpx' ? 'hwpx' : 'hwp');
        if (payload.length === 0 && filledForApply.length > 0) {
            throw new Error('입력값은 있으나 표 위치(location_json)가 유효하지 않아 파일에 쓸 수 없습니다.');
        }
        _logApp('finalize.apply.start', sessionId, { payload_count: payload.length, format: ext });
        const res = await bridge.applyFields(srcLocal, payload, outLocal, { timeoutMs: 180_000 });
        if (!res.ok) throw new Error(`적용 실패: ${res.error}`);
        const totalTarget = Array.isArray(payload) ? payload.length : 0;
        const appliedCount = Number(res.applied || 0);
        _logApp('finalize.apply.result', sessionId, {
            total: totalTarget,
            applied: appliedCount,
            failed: Array.isArray(res.results) ? res.results.filter((r) => !r.ok).length : null,
            sample_errors: Array.isArray(res.results)
                ? res.results.filter((r) => !r.ok).slice(0, 4).map((r) => r.error)
                : null,
        });
        if (totalTarget > 0 && appliedCount === 0) {
            const failed = Array.isArray(res.results)
                ? res.results.filter((r) => !r.ok).slice(0, 5).map((r) => {
                    const f = r.field || {};
                    return `${f.label_text || '(라벨없음)'}@table${f.table_index ?? '?'} row${f.row_index ?? '?'}`;
                  })
                : [];
            const errSnips = Array.isArray(res.results)
                ? res.results.filter((r) => !r.ok).slice(0, 2).map((r) => r.error).filter(Boolean)
                : [];
            const reason = failed.length > 0
                ? `문서 반영 0건 (실패 예: ${failed.join(', ')})`
                : '문서 반영 0건 (매칭 실패)';
            const detail = errSnips.length ? ` [${errSnips.join(' | ')}]` : '';
            throw new Error(`${reason}${detail}`);
        }

        let filledKey = null;
        let downloadUrl = null;
        if (s3.isS3Enabled()) {
            filledKey = s3.buildKey({
                sessionId,
                kind: 'filled',
                fileName: session.chosen_attachment_name
                    ? session.chosen_attachment_name.replace(/(\.[^.]+)?$/, `_작성완료.${ext}`)
                    : `application_filled.${ext}`,
            });
            await s3.uploadFile({ key: filledKey, filePath: outLocal });
            downloadUrl = await s3.getPresignedDownloadUrl({
                key: filledKey,
                fileName: session.chosen_attachment_name || `application_filled.${ext}`,
                expiresInSeconds: Math.max(60, FILLED_TTL_MIN * 60),
            });
        }

        // 개인정보 보호: filled 는 FILLED_TTL_MIN 분 뒤 자동 삭제 예약
        const expireAt = new Date(Date.now() + FILLED_TTL_MIN * 60_000);
        await pool.execute(
            `UPDATE application_sessions
                SET filled_s3_key = ?, filled_expires_at = ?, status = ?
              WHERE id = ?`,
            [filledKey, expireAt, SESSION_STATUS.DONE, sessionId]
        );
        await _setProgress(pool, sessionId, PROGRESS.DONE);
        await _appendMessage(pool, sessionId, 'system',
            `신청서 작성을 완료했습니다. 다운로드 링크는 ${FILLED_TTL_MIN}분 뒤 자동 만료됩니다.`);

        return {
            ok: true,
            status: SESSION_STATUS.DONE,
            downloadUrl,
            filledKey,
            applied: res.applied,
            total: res.total,
            filled_expires_at: expireAt.toISOString(),
            filled_ttl_min: FILLED_TTL_MIN,
        };
    } catch (e) {
        await _setStatus(pool, sessionId, SESSION_STATUS.FAILED, e.message);
        await _setProgress(pool, sessionId, PROGRESS.FAILED);
        throw e;
    } finally {
        for (const p of [srcLocal, outLocal]) {
            if (p && fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch (_) {}
            }
        }
    }
}

/* ----------------------- helpers ----------------------- */

async function _setStatus(pool, sessionId, status, errorMessage) {
    if (errorMessage) {
        await pool.execute(
            `UPDATE application_sessions SET status = ?, error_message = ? WHERE id = ?`,
            [status, String(errorMessage).slice(0, 1000), sessionId]
        );
    } else {
        await pool.execute(
            `UPDATE application_sessions SET status = ? WHERE id = ?`,
            [status, sessionId]
        );
    }
}

/**
 * @param {object} prog  PROGRESS.* 객체 ({ stage, percent })
 * @param {object} extra { queue_position?, started? }
 */
async function _setProgress(pool, sessionId, prog, extra = {}) {
    if (!prog) return;
    const params = [prog.stage, prog.percent];
    let sql = `UPDATE application_sessions SET progress_stage = ?, progress_percent = ?`;
    if (extra.queue_position !== undefined) {
        sql += `, queue_position = ?`;
        params.push(extra.queue_position);
    }
    if (extra.started) {
        sql += `, progress_started_at = NOW()`;
    } else if (prog.stage === 'queued' && extra.queue_position !== undefined && extra.queue_position > 0) {
        // 대기 중에는 시작 시각 갱신 안 함
    }
    sql += ` WHERE id = ?`;
    params.push(sessionId);
    await pool.execute(sql, params);
}

async function _appendMessage(pool, sessionId, role, content) {
    await pool.execute(
        `INSERT INTO application_messages (session_id, role, content) VALUES (?, ?, ?)`,
        [sessionId, role, content]
    );
}

async function _appendAssistantDedup(pool, sessionId, content) {
    const [rows] = await pool.execute(
        `SELECT role, content FROM application_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1`,
        [sessionId]
    );
    const prev = rows[0];
    if (prev && prev.role === 'assistant' && String(prev.content || '').trim() === String(content || '').trim()) {
        return;
    }
    await _appendMessage(pool, sessionId, 'assistant', content);
}

function _logApp(event, sessionId, data = {}) {
    const sid = sessionId == null ? '-' : String(sessionId);
    try {
        console.log(`[applications][${event}][session:${sid}] ${JSON.stringify(data)}`);
    } catch (_) {
        console.log(`[applications][${event}][session:${sid}]`);
    }
}

async function _loadSessionFull(pool, sessionId) {
    const [rows] = await pool.execute(
        `SELECT * FROM application_sessions WHERE id = ?`, [sessionId]
    );
    if (rows.length === 0) return null;
    const session = rows[0];
    const [fields] = await pool.execute(
        `SELECT id, kind, location_json, prompt_label, placeholder_text, value,
                is_filled, is_skipped, order_index, filled_at, skipped_at
           FROM application_fields WHERE session_id = ? ORDER BY order_index ASC, id ASC`, [sessionId]
    );
    const [messages] = await pool.execute(
        `SELECT id, role, content, created_at FROM application_messages
          WHERE session_id = ? ORDER BY id ASC`, [sessionId]
    );
    return { session, fields, messages };
}

module.exports = { buildRouter, SESSION_STATUS };
