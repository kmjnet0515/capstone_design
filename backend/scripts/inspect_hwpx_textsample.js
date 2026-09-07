'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { spawn } = require('child_process');

const url = process.argv[2];
const outName = process.argv[3] || 'sample';
if (!url) { console.error('URL 필요'); process.exit(1); }

(async () => {
    const buf = (await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000, headers: { 'User-Agent': 'Mozilla/5.0' } })).data;
    const sig = Buffer.from(buf).slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04])) ? 'hwpx' : 'hwp';
    const out = path.join(os.tmpdir(), `${outName}.${sig}`);
    fs.writeFileSync(out, Buffer.from(buf));
    console.log('saved', out, 'size', buf.byteLength, 'sig', sig);

    const py = path.join(__dirname, '..', 'venv', 'bin', 'python');
    const args = sig === 'hwpx'
      ? ['-m', 'hwpx_analysis', out, '--list-fillable-cells']
      : ['-m', 'hwp_analysis', out, '--list-fillable-cells'];
    const p = spawn(py, args, { cwd: path.join(__dirname, '..') });
    let s = '';
    p.stdout.on('data', d => s += d);
    p.on('close', () => {
        const data = JSON.parse(s);
        const fields = data.fields || [];
        console.log('fields:', fields.length);
        const labels = {};
        fields.forEach(f => {
            const k = (f.composed_label || f.label_text || '').slice(0, 40);
            labels[k] = (labels[k] || 0) + 1;
        });
        const top = Object.entries(labels).sort((a, b) => b[1] - a[1]).slice(0, 25);
        console.log('top labels:'); top.forEach(([k, v]) => console.log(' ', String(v).padStart(3), k));
        const previews = fields.map(f => f.value_preview).filter(Boolean);
        const preCount = {};
        previews.forEach(p => { preCount[p] = (preCount[p] || 0) + 1; });
        console.log('top previews:');
        Object.entries(preCount).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(' ', String(v).padStart(3), JSON.stringify(k.slice(0, 60))));
    });
})();
