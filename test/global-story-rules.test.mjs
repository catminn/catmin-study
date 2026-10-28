import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const contractPath = fileURLToPath(new URL('../content/contracts/global-story-rules-v1.json', import.meta.url));
const rules = JSON.parse(readFileSync(contractPath, 'utf8'));

function validateBinding(manifest, ruleSet = rules) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest_missing'];
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.worldId ?? '')) errors.push('world_id_invalid');
  if (!Number.isSafeInteger(manifest.manifestRevision) || manifest.manifestRevision < 1) errors.push('manifest_revision_invalid');
  if (typeof manifest.globalRulesVersion !== 'string' || !manifest.globalRulesVersion.trim()) errors.push('global_rules_version_missing');
  else if (manifest.globalRulesVersion !== ruleSet.globalRulesVersion) errors.push('global_rules_version_mismatch');
  return errors;
}

const sample = { worldId: 'sampleworld', manifestRevision: 1, globalRulesVersion: 'global-v1' };

test('public global rules are versioned and have unique stable IDs', () => {
  assert.equal(rules.schema, 'global-story-rules-v1');
  assert.equal(rules.globalRulesVersion, 'global-v1');
  assert.equal(rules.revisionPolicy.publishedVersionIsImmutable, true);
  assert.equal(rules.revisionPolicy.mismatch, 'fail-closed-before-import');
  assert.deepEqual(rules.rules.map(r => r.id), ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08']);
  for (const rule of rules.rules) assert.ok(rule.requirement.length > 30);
});

test('manifest with explicit matching global-v1 binding is eligible for further checks', () => {
  assert.deepEqual(validateBinding(sample), []);
});

test('missing global rules version fails closed', () => {
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: undefined }), ['global_rules_version_missing']);
});

test('unrecognized newer version is not silently treated as global-v1', () => {
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: 'global-v2' }), ['global_rules_version_mismatch']);
});

test('legacy placeholder and whitespace are not accepted as the pinned version', () => {
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: ' ' }), ['global_rules_version_missing']);
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: 'global-v1 ' }), ['global_rules_version_mismatch']);
});

test('binding requires a concrete world and positive manifest revision', () => {
  assert.deepEqual(validateBinding({ ...sample, worldId: '', manifestRevision: 0 }), ['world_id_invalid', 'manifest_revision_invalid']);
});

test('missing or malformed manifest fails closed', () => {
  assert.deepEqual(validateBinding(null), ['manifest_missing']);
  assert.deepEqual(validateBinding([]), ['manifest_missing']);
});
