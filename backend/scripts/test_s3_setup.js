'use strict';

/**
 * AWS S3 설정 종합 검증.
 *
 *   1) 클라이언트 활성 (.env)
 *   2) 작은 객체 업로드 → 다운로드 → 검증 → 삭제
 *   3) presigned URL 발급 후 실제로 GET 가능한지 확인
 *   4) DeleteObjects (배치 삭제) 동작 확인
 *
 * 사용:
 *   node scripts/test_s3_setup.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');

const s3 = require('../services/s3');

(async () => {
    console.log('════════════════════════════════════════');
    console.log(' S3 동작 검증');
    console.log('════════════════════════════════════════');
    console.log(`Region: ${process.env.AWS_REGION}`);
    console.log(`Bucket: ${process.env.S3_BUCKET}`);
    console.log(`Prefix: ${process.env.S3_KEY_PREFIX}`);
    console.log(`Access Key: ${(process.env.AWS_ACCESS_KEY_ID || '').slice(0, 8)}…`);

    // 1) enabled 확인
    console.log('\n[1/5] isS3Enabled()');
    if (!s3.isS3Enabled()) {
        console.error('  ✗ 비활성. .env 의 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET 확인');
        process.exit(1);
    }
    console.log('  ✓ S3 활성');

    // 2) 임시 .hwp 형태의 파일 생성
    const tmpFile = path.join(os.tmpdir(), `s3_test_${Date.now()}.hwp`);
    const payload = Buffer.concat([
        Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), // OLE 시그니처 흉내
        crypto.randomBytes(2048),
    ]);
    fs.writeFileSync(tmpFile, payload);
    const md5Local = crypto.createHash('md5').update(payload).digest('hex');
    console.log(`\n[2/5] 임시 파일 ${tmpFile} (${payload.length}B, md5=${md5Local.slice(0, 12)}…)`);

    const sessionId = `test_${Date.now()}`;
    const key = s3.buildKey({ sessionId, kind: 'filled', fileName: 'application_filled.hwp' });
    console.log(`     → Key: ${key}`);

    // 3) 업로드
    console.log('\n[3/5] 업로드 + 다운로드 round-trip');
    try {
        await s3.uploadFile({ key, filePath: tmpFile });
        console.log('  ✓ 업로드 OK');
    } catch (e) {
        console.error('  ✗ 업로드 실패:', e.message);
        if (/AccessDenied/i.test(e.message)) {
            console.error('  → IAM 정책에 s3:PutObject 권한이 없거나 Resource ARN 이 잘못됐을 수 있음');
        } else if (/NoSuchBucket/i.test(e.message)) {
            console.error('  → S3_BUCKET 이름이 틀렸거나 다른 리전에 있음');
        }
        process.exit(2);
    }

    const downloadDest = path.join(os.tmpdir(), `s3_test_dl_${Date.now()}.hwp`);
    try {
        await s3.downloadToFile({ key, dest: downloadDest });
        const md5Down = crypto.createHash('md5').update(fs.readFileSync(downloadDest)).digest('hex');
        if (md5Down !== md5Local) {
            console.error(`  ✗ MD5 불일치: 로컬=${md5Local} 다운=${md5Down}`);
            process.exit(3);
        }
        console.log(`  ✓ 다운로드 OK (md5 일치)`);
    } catch (e) {
        console.error('  ✗ 다운로드 실패:', e.message);
        if (/AccessDenied/i.test(e.message)) {
            console.error('  → IAM 정책에 s3:GetObject 권한 누락');
        }
        process.exit(3);
    } finally {
        if (fs.existsSync(downloadDest)) fs.unlinkSync(downloadDest);
    }

    // 4) presigned URL
    console.log('\n[4/5] presigned URL 발급 + 실제 GET');
    try {
        const url = await s3.getPresignedDownloadUrl({
            key, fileName: '신청서_작성완료.hwp', expiresInSeconds: 60,
        });
        console.log('  ✓ presigned URL 발급');
        console.log(`    ${url.slice(0, 120)}…`);

        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 15_000, validateStatus: () => true });
        if (r.status !== 200) {
            console.error(`  ✗ presigned GET 실패: HTTP ${r.status}`);
            console.error(`     ${Buffer.from(r.data).toString('utf8').slice(0, 300)}`);
            process.exit(4);
        }
        const md5Pre = crypto.createHash('md5').update(Buffer.from(r.data)).digest('hex');
        if (md5Pre !== md5Local) {
            console.error(`  ✗ MD5 불일치 (presigned)`);
            process.exit(4);
        }
        const cd = r.headers['content-disposition'];
        console.log(`  ✓ presigned GET OK (${r.data.byteLength}B, md5 일치)`);
        if (cd) console.log(`    Content-Disposition: ${cd}`);
    } catch (e) {
        console.error('  ✗ presigned 실패:', e.message);
        process.exit(4);
    }

    // 5) 삭제 (단건 + 배치)
    console.log('\n[5/5] 삭제 (단건/배치)');
    try {
        const ok = await s3.deleteKey(key);
        console.log(`  ✓ deleteKey: ${ok}`);

        // 배치 삭제 테스트: 더미 2개 더 만들기
        const dummies = [];
        for (let i = 0; i < 2; i++) {
            const k = s3.buildKey({ sessionId: `${sessionId}_d${i}`, kind: 'filled', fileName: `d${i}.hwp` });
            await s3.uploadFile({ key: k, filePath: tmpFile });
            dummies.push(k);
        }
        const n = await s3.deleteKeys(dummies);
        console.log(`  ✓ deleteKeys: ${n}건 삭제됨`);
    } catch (e) {
        console.error('  ✗ 삭제 실패:', e.message);
        if (/AccessDenied/i.test(e.message)) {
            console.error('  → IAM 정책에 s3:DeleteObject 권한 누락 (cron 자동 만료 동작 안 함)');
        }
        process.exit(5);
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }

    console.log('\n════════════════════════════════════════');
    console.log(' ✅ S3 모든 검증 통과 — 배포 준비 완료');
    console.log('════════════════════════════════════════');
})().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(99);
});
