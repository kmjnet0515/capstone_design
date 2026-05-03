'use strict';

/**
 * 공고 상세 페이지에서 .hwp/.hwpx 첨부파일 후보를 찾는 크롤러.
 *
 * 1차 타깃: 기업마당(www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=...)
 *   - 첨부 링크 패턴: <a href="/cmm/fms/fileDown.do?atchFileId=FILE_...&fileSn=N"
 *                      title="첨부파일 [파일명].[확장자] 다운로드">다운로드</a>
 *   - href 가 상대경로이므로 origin prefix 필요
 *   - URL 에 확장자가 없어 title 또는 인접 텍스트에서 파일명·확장자를 파싱
 *
 * 그 외 사이트는 일반 휴리스틱 fallback (a[href$=".hwp"], a[href$=".hwpx"]).
 */

const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const APPLICATION_KEYWORDS = [
    { re: /신청\s*양식/, score: 12 },
    { re: /지원\s*신청/, score: 11 },
    { re: /신청서/, score: 10 },
    { re: /공고문\s*및\s*신청서/, score: 8 },
    { re: /참가\s*신청/, score: 9 },
    { re: /접수.{0,4}양식/, score: 8 },
    { re: /신청\s*서식/, score: 7 },
    { re: /양식|서식/, score: 5 },
    { re: /제출.{0,4}서류/, score: 4 },
];

const NEGATIVE_KEYWORDS = [
    { re: /웹\s*포스터|포스터/, score: -6 },
    { re: /안내문|안내자료/, score: -2 },
    { re: /이미지|로고/, score: -3 },
    // 공고 본문/안내 문서는 실제 신청서와 분리해서 취급
    { re: /공고문|필독|faq|자주\s*묻는|안내\s*및\s*faq|신청방법/, score: -10 },
];

const SUPPORTED_EXTS = new Set(['hwp', 'hwpx']);

function evaluateCandidateRole(c) {
    const name = String(c?.fileName || '');
    const hay = `${name} ${c?.linkText || ''}`.toLowerCase();
    const hasApplicationHint = /신청\s*서식|신청서식|신청서|신청\s*양식|양식|서식/.test(hay);
    const hasNoticeHint = /공고문|안내|필독|faq|포스터|신청방법|본문\s*출력/.test(hay);
    const eligible = hasApplicationHint && !hasNoticeHint;
    return {
        role: eligible ? 'application' : (hasNoticeHint ? 'notice' : 'unknown'),
        eligible,
        reason: eligible ? '신청서식 키워드 일치' : (hasNoticeHint ? '공고/안내 계열로 추정' : '신청서식 근거 부족'),
    };
}

/** 파일명에서 확장자(소문자) 추출. 점 없으면 ''. */
function extractExtFromName(name) {
    if (!name) return '';
    const dot = name.lastIndexOf('.');
    if (dot < 0 || dot === name.length - 1) return '';
    return name.slice(dot + 1).toLowerCase();
}

/** title 속성에서 파일명·확장자 파싱.
 *  예: "첨부파일 [공고문 및 신청서] 2026 라이브커머스.hwp 다운로드"  → 파일명/확장자 추출
 */
function parseTitleAttr(title) {
    if (!title || typeof title !== 'string') return null;
    const t = title.trim();

    const m = t.match(/(?:첨부파일|파일명|파일)?\s*(.*?)(?:\s*다운로드|\s*바로보기|$)/);
    let raw = m ? m[1].trim() : t;

    raw = raw.replace(/^\(\s*/, '').replace(/\s*\)$/, '');

    const ext = extractExtFromName(raw);
    return { fileName: raw, ext };
}

/** href / fileName / 텍스트로부터 후보 점수 산정 */
function scoreCandidate({ fileName, href, linkText }) {
    const haystack = `${fileName || ''} ${linkText || ''} ${href || ''}`;

    let score = 1;
    for (const { re, score: s } of APPLICATION_KEYWORDS) {
        if (re.test(haystack)) {
            score += s;
            break;
        }
    }
    for (const { re, score: s } of NEGATIVE_KEYWORDS) {
        if (re.test(haystack)) score += s;
    }
    // 신청서식/양식은 공고문보다 우선
    if (/신청\s*서식|신청서식|신청서|신청\s*양식|서식/.test(haystack)) score += 8;
    if (/본문\s*출력\s*파일|공고문/.test(haystack)) score -= 6;
    if (/지원|신청|모집|공고/.test(haystack)) score += 1;
    return score;
}

/** anchor element 에서 절대 URL 생성 (javascript:/mailto: 등은 제외) */
function resolveHref(href, baseUrl) {
    if (!href) return null;
    const trimmed = String(href).trim();
    if (!trimmed) return null;
    if (/^(javascript|mailto|tel):/i.test(trimmed)) return null;
    try {
        const u = new URL(trimmed, baseUrl);
        if (!/^https?:$/i.test(u.protocol)) return null;
        return u.toString();
    } catch (_e) {
        return null;
    }
}

/** Bizinfo 첨부파일 추출 (a.basic-btn01.icon_download / fileDown.do 패턴) */
function extractBizinfoCandidates($, baseUrl) {
    const out = [];
    $('a[href*="fileDown.do"], a.icon_download, a[title*="첨부파일"]').each((_, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const title = $a.attr('title') || '';
        const linkText = $a.text().trim();
        const url = resolveHref(href, baseUrl);
        if (!url) return;

        const parsed = parseTitleAttr(title);
        const fileName = parsed?.fileName || linkText || path.basename(href);
        const ext = parsed?.ext || extractExtFromName(fileName);

        out.push({ url, fileName, ext: ext.toLowerCase(), href, linkText, source: 'bizinfo' });
    });
    return out;
}

/** 일반 사이트 fallback: href / 인접 텍스트에서 .hwp/.hwpx 후보 */
function extractGenericCandidates($, baseUrl) {
    const out = [];

    $('a[href]').each((_, el) => {
        const $a = $(el);
        const href = $a.attr('href') || '';
        const title = $a.attr('title') || '';
        const linkText = $a.text().trim();
        const url = resolveHref(href, baseUrl);
        if (!url) return;

        let ext = extractExtFromName(href.split('?')[0]);
        let fileName = path.basename(decodeURIComponent(href.split('?')[0])) || '';

        if (!SUPPORTED_EXTS.has(ext)) {
            const fromTitle = parseTitleAttr(title);
            if (fromTitle && SUPPORTED_EXTS.has(fromTitle.ext)) {
                ext = fromTitle.ext;
                fileName = fromTitle.fileName;
            } else {
                const fromText = extractExtFromName(linkText);
                if (SUPPORTED_EXTS.has(fromText)) {
                    ext = fromText;
                    fileName = linkText;
                }
            }
        }

        if (!SUPPORTED_EXTS.has(ext)) return;

        out.push({ url, fileName, ext, href, linkText, source: 'generic' });
    });

    return out;
}

/** 중복 제거: url 기준 */
function dedupe(candidates) {
    const seen = new Map();
    for (const c of candidates) {
        if (!seen.has(c.url)) seen.set(c.url, c);
    }
    return Array.from(seen.values());
}

/**
 * @param {string} programUrl 공고 상세 페이지 URL (예: bizinfo selectSIIA200Detail.do)
 * @param {object} options { timeoutMs, userAgent }
 * @returns {Promise<{ ok: boolean, programUrl: string, candidates: Array, eligible: Array, best: object | null, error?: string }>}
 */
async function findApplicationAttachments(programUrl, options = {}) {
    if (!programUrl) {
        return { ok: false, error: 'programUrl 이 비어 있습니다.', candidates: [], eligible: [], best: null };
    }

    const timeoutMs = options.timeoutMs ?? 15000;
    const userAgent = options.userAgent
        || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

    let html;
    try {
        const resp = await axios.get(programUrl, {
            timeout: timeoutMs,
            responseType: 'text',
            headers: {
                'User-Agent': userAgent,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko,en;q=0.8',
            },
            validateStatus: (s) => s >= 200 && s < 400,
        });
        html = typeof resp.data === 'string' ? resp.data : String(resp.data);
    } catch (e) {
        return {
            ok: false,
            programUrl,
            candidates: [],
            eligible: [],
            best: null,
            error: `상세 페이지 GET 실패: ${e.message}`,
        };
    }

    const $ = cheerio.load(html);
    const baseUrl = programUrl;

    let raw = [];
    if (/bizinfo\.go\.kr/i.test(programUrl)) {
        raw = raw.concat(extractBizinfoCandidates($, baseUrl));
    }
    raw = raw.concat(extractGenericCandidates($, baseUrl));

    raw = dedupe(raw);
    const filtered = raw.filter((c) => SUPPORTED_EXTS.has(c.ext));

    const scored = filtered.map((c) => {
        const roleInfo = evaluateCandidateRole(c);
        return {
            ...c,
            score: scoreCandidate(c),
            role: roleInfo.role,
            eligible: roleInfo.eligible,
            reason: roleInfo.reason,
        };
    }).sort((a, b) => b.score - a.score || a.fileName.length - b.fileName.length);

    const eligible = scored.filter((c) => c.eligible);

    return {
        ok: true,
        programUrl,
        candidates: scored,
        eligible,
        best: eligible[0] || scored[0] || null,
    };
}

module.exports = {
    findApplicationAttachments,
    scoreCandidate,
    parseTitleAttr,
    evaluateCandidateRole,
};
