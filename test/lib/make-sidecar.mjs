// 测试辅助（占位内容）：读 stdin {kind,id,content}，输出由真实 src/review.ts 生成的“待批”侧车。不是生产审批生成器。
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = join(mkdtempSync(join(tmpdir(), 'ms-')), 'review.mjs');
execSync(`npx esbuild src/review.ts --bundle --format=esm --platform=node --outfile=${out} --log-level=error`, { stdio: 'inherit' });
const { projectedFields, recordDigest, sha256Hex } = await import(pathToFileURL(out).href);
const rec = JSON.parse(readFileSync(0, 'utf8'));
const fields = [];
for (const f of projectedFields(rec)) fields.push({ path: f.path, digest: await sha256Hex(JSON.stringify(f.value)), gate: f.gate });
process.stdout.write(JSON.stringify({ schema: 'dungeon-public-field-review-v1', recordId: rec.id, contentDigest: await recordDigest(rec), fields }));
