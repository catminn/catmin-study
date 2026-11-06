#!/usr/bin/env node
/**
 * P0: read-only legacy-save audit with explicit backup export.
 * Usage: node scripts/audit-legacy-save.mjs INPUT.json BACKUP.json
 * Requires the user to provide a manually exported legacy JSON snapshot.
 * Never connects to production, never changes INPUT.
 */
import { readFile, open } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectLegacyState, makeLegacyBackup } from '../public/study-core.mjs';
export async function auditExport(inputPath, outputPath) {
 if (!inputPath || !outputPath || resolve(inputPath) === resolve(outputPath)) throw new Error('Specify distinct input and backup paths');
 const raw = await readFile(inputPath, 'utf8');
 const legacy = JSON.parse(raw);
 const inspection = inspectLegacyState(legacy);
 const backup = makeLegacyBackup(legacy, { backupId: randomUUID(), capturedAt: Date.now() });
 const document = JSON.stringify(backup, null, 2);
 // Use exclusive creation: never overwrite an earlier backup.
 const fd = await open(outputPath, 'wx', 0o600);
 try { await fd.writeFile(document, 'utf8'); await fd.sync(); } finally { await fd.close(); }
 const verify = JSON.parse(await readFile(outputPath, 'utf8'));
 if (JSON.stringify(verify.original) !== JSON.stringify(legacy)) throw new Error('Backup verification failed');
 return { inputSha256: createHash('sha256').update(raw).digest('hex'), backupId: backup.backupId,
   backupFile: resolve(outputPath), inspection, verified: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const [input, output] = process.argv.slice(2);
 auditExport(input, output).then(report => {
   // Paths supplied explicitly; never print raw saved data to logs.
   console.log(JSON.stringify(report, null, 2));
 }).catch(e => { console.error('Audit failed: ' + e.message); process.exitCode = 1; });
}
