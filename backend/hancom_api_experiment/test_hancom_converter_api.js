#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const baseUrl = process.env.HANCOM_BASE_URL || 'http://127.0.0.1:8101';
const moduleName = process.env.HANCOM_MODULE || 'hwp2pdf';
const showType = process.env.HANCOM_SHOW_TYPE || 'json';
const fnName = process.env.HANCOM_FUNCTION || '';
const timeoutMs = Number(process.env.HANCOM_TIMEOUT_MS || 15000);

const experimentDir = __dirname;
const srcFile = path.join(experimentDir, 'testhwp.hwp');

if (!fs.existsSync(srcFile)) {
  console.error('testhwp.hwp 파일이 없습니다:', srcFile);
  process.exit(1);
}

const candidates = [
  `${baseUrl.replace(/\/$/, '')}/${moduleName}`,
  `${baseUrl.replace(/\/$/, '')}/convert/${moduleName}`,
  `${baseUrl.replace(/\/$/, '')}/converter/${moduleName}`,
  `${baseUrl.replace(/\/$/, '')}/docsconverter/${moduleName}`,
];

const payload = {
  file_path: srcFile,
  show_type: showType,
  ignore_cache: 1,
};
if (fnName) payload.function = fnName;

function shorten(data, max = 500) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '...';
}

async function tryRequest(method, url) {
  try {
    const res = await axios({
      method,
      url,
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: new URLSearchParams(payload),
      params: method === 'get' ? payload : undefined,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      contentType: res.headers['content-type'],
      bodyPreview: shorten(res.data),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.code || err.message,
      detail: shorten(err.response?.data || ''),
    };
  }
}

(async () => {
  console.log('=== Hancom DocsConverter API 실험 ===');
  console.log('baseUrl:', baseUrl);
  console.log('module:', moduleName);
  console.log('file_path:', srcFile);
  console.log('show_type:', showType);
  if (fnName) console.log('function:', fnName);
  console.log('timeout_ms:', timeoutMs);
  console.log('');

  const results = [];
  for (const url of candidates) {
    const postRes = await tryRequest('post', url);
    results.push({ method: 'POST', url, ...postRes });

    const getRes = await tryRequest('get', url);
    results.push({ method: 'GET', url, ...getRes });
  }

  for (const r of results) {
    console.log(`- ${r.method} ${r.url}`);
    if (r.error) {
      console.log(`  error: ${r.error}`);
      if (r.detail) console.log(`  detail: ${r.detail}`);
      continue;
    }
    console.log(`  status: ${r.status}`);
    console.log(`  content-type: ${r.contentType || '(none)'}`);
    if (r.bodyPreview) console.log(`  body: ${r.bodyPreview}`);
  }

  const success = results.find((r) => r.ok);
  console.log('');
  if (success) {
    console.log('✅ 성공 응답 발견:', success.method, success.url, success.status);
    process.exit(0);
  }

  console.log('❌ 성공 응답 없음.');
  console.log('힌트: HANCOM_BASE_URL/HANCOM_MODULE/HANCOM_FUNCTION 값을 문서에 맞게 조정하세요.');
  process.exit(2);
})();
