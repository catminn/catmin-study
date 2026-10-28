// 用 PR #10 的 manifest 校验器检查世界清单。stdin：{"manifest":{...},"available":[{kind,ref,rev}]|null}；只输出错误类别。
import { validateManifest } from './lib/world-manifest-validator.mjs';
let raw = ''; process.stdin.on('data', (d) => (raw += d)).on('end', () => {
  try { const { manifest, available } = JSON.parse(raw); const e = validateManifest(manifest, available ?? undefined); process.stdout.write(JSON.stringify({ ok: e.length === 0, errors: e })); process.exitCode = e.length ? 1 : 0; }
  catch { process.stdout.write(JSON.stringify({ ok: false, errors: ['unreadable'] })); process.exitCode = 1; }
});
