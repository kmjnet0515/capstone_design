'use strict';

const fs = require('fs');
const path = require('path');
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'ap-northeast-2';
const BUCKET = process.env.S3_BUCKET || '';
const KEY_PREFIX = process.env.S3_KEY_PREFIX || 'applications';

let _client = null;

/** S3가 .env에 설정되어 있으면 true. 미설정이면 호출자가 fallback 가능. */
function isS3Enabled() {
    return Boolean(BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function getClient() {
    if (_client) return _client;
    _client = new S3Client({
        region: REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });
    return _client;
}

/** key 자동 생성 헬퍼 */
function buildKey({ sessionId, kind, fileName }) {
    const safe = (fileName || 'file').replace(/[^\w.\-]+/g, '_');
    const ts = Date.now();
    return `${KEY_PREFIX}/${sessionId}/${kind}/${ts}_${safe}`;
}

async function uploadBuffer({ key, body, contentType = 'application/octet-stream' }) {
    if (!isS3Enabled()) throw new Error('S3가 설정되지 않았습니다 (.env 의 AWS_*/S3_BUCKET 확인).');
    const client = getClient();
    await client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
    return { bucket: BUCKET, key };
}

async function uploadFile({ key, filePath, contentType }) {
    const stream = fs.createReadStream(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (!contentType) {
        if (ext === '.hwp') contentType = 'application/x-hwp';
        else if (ext === '.hwpx') contentType = 'application/vnd.hancom.hwpx';
        else if (ext === '.pdf') contentType = 'application/pdf';
        else contentType = 'application/octet-stream';
    }
    return uploadBuffer({ key, body: stream, contentType });
}

async function getPresignedDownloadUrl({ key, fileName, expiresInSeconds = 3600 }) {
    if (!isS3Enabled()) throw new Error('S3가 설정되지 않았습니다.');
    const client = getClient();
    const cmd = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ResponseContentDisposition: fileName
            ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
            : undefined,
    });
    return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds });
}

async function downloadToFile({ key, dest }) {
    if (!isS3Enabled()) throw new Error('S3가 설정되지 않았습니다.');
    const client = getClient();
    const out = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(dest);
        out.Body.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', resolve);
        out.Body.pipe(ws);
    });
    return dest;
}

async function deleteKey(key) {
    if (!isS3Enabled() || !key) return false;
    try {
        await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        return true;
    } catch (e) {
        console.warn('[s3] deleteKey 실패:', key, e.message);
        return false;
    }
}

async function deleteKeys(keys) {
    const arr = (keys || []).filter(Boolean);
    if (!isS3Enabled() || arr.length === 0) return 0;
    try {
        const r = await getClient().send(new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: arr.map((Key) => ({ Key })), Quiet: true },
        }));
        return (r.Deleted || []).length || arr.length;
    } catch (e) {
        console.warn('[s3] deleteKeys 실패:', e.message);
        return 0;
    }
}

async function existsKey(key) {
    if (!isS3Enabled()) return false;
    try {
        await getClient().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return true;
    } catch (e) {
        if (e && (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404)) return false;
        throw e;
    }
}

module.exports = {
    isS3Enabled,
    buildKey,
    uploadBuffer,
    uploadFile,
    getPresignedDownloadUrl,
    downloadToFile,
    existsKey,
    deleteKey,
    deleteKeys,
};
