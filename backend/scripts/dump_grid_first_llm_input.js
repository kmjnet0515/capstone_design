#!/usr/bin/env node
'use strict';

/**
 * extract-blocks JSON (--extract-blocks 출력)을 읽어
 * classifyBlockTopology 가 OpenAI 에 보내는 messages 와 meta 를 파일로 덤프한다 (API 호출 없음).
 *
 *   node scripts/dump_grid_first_llm_input.js <extract-blocks.json> [out.txt]
 *
 * out 생략 시 temp/grid_first_llm_dump.txt
 */

const fs = require('fs');
const path = require('path');
const { buildGridFirstLlmMessages } = require(path.join(__dirname, '..', 'services', 'field_classifier'));

function main() {
    const inPath = process.argv[2];
    if (!inPath) {
        console.error('사용법: node scripts/dump_grid_first_llm_input.js <extract-blocks.json> [out.txt]');
        process.exit(2);
    }
    const absIn = path.isAbsolute(inPath) ? inPath : path.join(process.cwd(), inPath);
    const raw = JSON.parse(fs.readFileSync(absIn, 'utf8'));
    const prep = buildGridFirstLlmMessages(raw);

    const outArg = process.argv[3];
    const outPath = outArg
        ? (path.isAbsolute(outArg) ? outArg : path.join(process.cwd(), outArg))
        : path.join(__dirname, '..', 'temp', 'grid_first_llm_dump.txt');

    if (!prep.ok) {
        const err = JSON.stringify(prep, null, 2);
        console.error(err);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, err, 'utf8');
        console.error('실패 내용을 썼습니다:', outPath);
        process.exit(1);
    }

    const lines = [];
    lines.push('=== meta (UTF-8 bytes) ===');
    lines.push(JSON.stringify(prep.meta, null, 2));
    lines.push('');
    lines.push('=== messages[0] system ===');
    lines.push(prep.messages[0].content);
    lines.push('');
    lines.push('=== messages[1] user (API 에 전송되는 내용; token_map 미포함) ===');
    lines.push(prep.messages[1].content);
    lines.push('');
    lines.push('=== tokenToId (덤프 전용; API user 메시지에는 넣지 않음) ===');
    lines.push(JSON.stringify(prep.tokenToId, null, 2));

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log('OK wrote', outPath);
    console.log(JSON.stringify(prep.meta));
}

main();
