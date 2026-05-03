'use strict';

/**
 * Python hwp_analysis / hwpx_analysis CLI 호출 래퍼.
 *  - listFillableCells(filePath) → { ok, format, fields:[{section_index/section_path, table_index, row_index, label_col, value_col, label_text, kind, ...}] }
 *  - applyFields(filePath, fields, outPath) → { ok, applied, results }
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const BACKEND_ROOT = path.join(__dirname, '..');
const venvPython = path.join(BACKEND_ROOT, 'venv', 'bin', 'python');
const PYTHON_PATH = process.env.PYTHON_PATH
    || (fs.existsSync(venvPython) ? venvPython : 'python3');

function detectFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.hwp') return 'hwp';
    if (ext === '.hwpx') return 'hwpx';
    return null;
}

function _moduleFor(format) {
    return format === 'hwpx' ? 'hwpx_analysis' : 'hwp_analysis';
}

function _runPython(args, { timeoutMs = 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(PYTHON_PATH, args, {
            cwd: BACKEND_ROOT,
            env: process.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
        child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
        const tid = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`python timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        child.on('error', (e) => { clearTimeout(tid); reject(e); });
        child.on('close', (code) => {
            clearTimeout(tid);
            if (code !== 0) {
                const detail = [stderr, stdout].filter(Boolean).join('\n---\n').slice(0, 4000);
                return reject(new Error(`python exit ${code}: ${detail || '(no output)'}`));
            }
            resolve({ stdout, stderr });
        });
    });
}

async function listFillableCells(filePath, { timeoutMs } = {}) {
    const format = detectFormat(filePath);
    if (!format) {
        return { ok: false, error: `지원 안 되는 확장자: ${filePath}` };
    }
    const mod = _moduleFor(format);
    const args = ['-m', mod, filePath, '--list-fillable-cells'];
    const { stdout, stderr } = await _runPython(args, { timeoutMs });
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (e) {
        return {
            ok: false,
            error: `JSON 파싱 실패: ${e.message}`,
            raw: stdout.slice(0, 500),
            stderr: (stderr || '').slice(0, 1200),
        };
    }
    if (parsed && parsed.ok) {
        parsed.format = parsed.format || format;
    }
    return parsed;
}

/**
 * 표 그리드(셀 텍스트 + 위치 메타) 추출 — LLM 분류기 입력용.
 * @returns {Promise<{ok, format, sections:[{section_index|section_path, table_count, tables:[{table_index, row_count, col_counts, rows:[[string,...]], _cell_meta:[[{...}]]}]}]}>}
 */
async function extractTableGrids(filePath, { timeoutMs } = {}) {
    const format = detectFormat(filePath);
    if (!format) {
        return { ok: false, error: `지원 안 되는 확장자: ${filePath}` };
    }
    const mod = _moduleFor(format);
    const args = ['-m', mod, filePath, '--extract-grids'];
    const { stdout, stderr } = await _runPython(args, { timeoutMs });
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch (e) {
        return {
            ok: false,
            error: `JSON 파싱 실패: ${e.message}`,
            raw: stdout.slice(0, 500),
            stderr: (stderr || '').slice(0, 1200),
        };
    }
    if (parsed && parsed.ok) {
        parsed.format = parsed.format || format;
    }
    return parsed;
}

/**
 * @param {string} srcPath  원본 .hwp / .hwpx
 * @param {Array<object>} fields  [{section_index|section_path, table_index, label_col, value_col, label_text, value}]
 * @param {string} outPath  결과 파일
 */
/**
 * HWPX: 그리드 + 블록 토폴로지 (--extract-blocks). HWPX 전용.
 */
async function extractDocumentTopology(filePath, { timeoutMs } = {}) {
    const format = detectFormat(filePath);
    if (format !== 'hwpx') {
        return { ok: false, error: 'extractDocumentTopology 는 .hwpx 만 지원합니다.', format };
    }
    const args = ['-m', 'hwpx_analysis', filePath, '--extract-blocks'];
    let parsed;
    try {
        const { stdout, stderr } = await _runPython(args, { timeoutMs });
        try {
            parsed = JSON.parse(stdout);
        } catch (e) {
            return {
                ok: false,
                error: `JSON 파싱 실패: ${e.message}`,
                raw: stdout.slice(0, 500),
                stderr: (stderr || '').slice(0, 1200),
            };
        }
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
    return parsed;
}

async function applyFields(srcPath, fields, outPath, { timeoutMs = 120_000 } = {}) {
    const format = detectFormat(srcPath);
    if (!format) return { ok: false, error: `지원 안 되는 확장자: ${srcPath}` };

    const mod = _moduleFor(format);
    const tmp = path.join(os.tmpdir(), `apply_fields_${Date.now()}.json`);
    await fs.promises.writeFile(tmp, JSON.stringify({ fields }, null, 2), 'utf8');

    try {
        const args = [
            '-m', mod, srcPath,
            '--apply-fields-json', tmp,
            '--apply-fields-out', outPath,
        ];
        const { stdout, stderr } = await _runPython(args, { timeoutMs });
        let parsed;
        try {
            parsed = JSON.parse(stdout);
        } catch (e) {
            return {
                ok: false,
                error: `JSON 파싱 실패: ${e.message}`,
                raw: stdout.slice(0, 500),
                stderr: (stderr || '').slice(0, 1200),
            };
        }
        return parsed;
    } finally {
        try { await fs.promises.unlink(tmp); } catch (_) { /* ignore */ }
    }
}

module.exports = {
    detectFormat,
    listFillableCells,
    extractTableGrids,
    extractDocumentTopology,
    applyFields,
    PYTHON_PATH,
};
