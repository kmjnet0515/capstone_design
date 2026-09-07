#!/usr/bin/env node
'use strict';

/**
 * HWP → --extract-blocks → Grid-First messages → (선택) OpenAI 호출 → 한 텍스트 파일에 저장.
 *
 *   cd backend
 *   node scripts/run_grid_first_llm_live.js "temp/파일.hwp" [out.txt]
 *
 * LLM 호출: 환경변수 OPENAI_API_KEY 필요. 없으면 프롬프트만 저장.
 * 모델: OPENAI_MODEL (기본 gpt-4o-mini)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const OpenAI = require('openai');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { buildGridFirstLlmMessages } = require(path.join(__dirname, '..', 'services', 'field_classifier'));

async function main() {
    const hwpArg = process.argv[2];
    const outArg = process.argv[3];
    if (!hwpArg) {
        console.error('사용법: node scripts/run_grid_first_llm_live.js <file.hwp> [out.txt]');
        process.exit(2);
    }

    const backendRoot = path.join(__dirname, '..');
    const absHwp = path.isAbsolute(hwpArg) ? hwpArg : path.join(process.cwd(), hwpArg);
    if (!fs.existsSync(absHwp)) {
        console.error('파일 없음:', absHwp);
        process.exit(1);
    }

    const outPath = outArg
        ? (path.isAbsolute(outArg) ? outArg : path.join(process.cwd(), outArg))
        : path.join(backendRoot, 'temp', 'grid_first_llm_live.txt');

    const jsonStr = execFileSync('python3', ['-m', 'hwp_analysis', absHwp, '--extract-blocks'], {
        cwd: backendRoot,
        maxBuffer: 80 * 1024 * 1024,
        encoding: 'utf8',
    });
    const raw = JSON.parse(jsonStr);
    const prep = buildGridFirstLlmMessages(raw);

    const lines = [];
    lines.push('=== source file ===');
    lines.push(absHwp);
    lines.push('');
    lines.push('=== buildGridFirstLlmMessages meta ===');
    if (!prep.ok) {
        lines.push(JSON.stringify(prep, null, 2));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
        console.error('buildGridFirstLlmMessages 실패 →', outPath);
        process.exit(1);
    }
    lines.push(JSON.stringify(prep.meta, null, 2));
    lines.push('');
    lines.push('=== messages[0] role=system ===');
    lines.push(prep.messages[0].content);
    lines.push('');
    lines.push('=== messages[1] role=user ===');
    lines.push(prep.messages[1].content);
    lines.push('');
    lines.push('=== tokenToId (로컬 디버그, API user 본문에는 미포함) ===');
    lines.push(JSON.stringify(prep.tokenToId, null, 2));
    lines.push('');

    const key = (process.env.OPENAI_API_KEY || '').trim();
    if (!key) {
        lines.push('=== LLM response (생략: OPENAI_API_KEY 없음) ===');
        lines.push('프롬프트만 저장했습니다. 응답까지 받으려면 OPENAI_API_KEY 를 설정한 뒤 다시 실행하세요.');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
        console.log('OK wrote (no API key):', outPath);
        return;
    }

    const openai = new OpenAI({ apiKey: key });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    lines.push(`=== LLM call model=${model} temperature=0 response_format=json_object ===`);
    try {
        const res = await openai.chat.completions.create({
            model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: prep.messages,
        });
        const content = res.choices?.[0]?.message?.content || '{}';
        lines.push('=== LLM response (raw string) ===');
        lines.push(content);
        lines.push('');
        lines.push('=== LLM response (formatted JSON) ===');
        try {
            lines.push(JSON.stringify(JSON.parse(content), null, 2));
        } catch {
            lines.push('(JSON parse 실패 — raw 만 참고)');
        }
        lines.push('');
        lines.push('=== usage ===');
        lines.push(JSON.stringify(res.usage || {}, null, 2));
    } catch (e) {
        lines.push('=== LLM error ===');
        lines.push(e && e.message ? e.message : String(e));
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log('OK wrote:', outPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
