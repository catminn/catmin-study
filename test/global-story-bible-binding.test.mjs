import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function load(relativePath) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}
const canonical = load('../content/contracts/global-story-bible-v1.json');
const legacyDraft = load('../content/contracts/global-story-rules-v1.json');
const sample = { worldId: 'world01', manifestRevision: 1, globalRulesVersion: 'global-story-bible-v1' };

function validateBinding(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest_missing'];
  const errors = [];
  if (typeof manifest.worldId !== 'string' || !/^[a-z][a-z0-9-]*$/.test(manifest.worldId)) errors.push('world_id_invalid');
  if (!Number.isSafeInteger(manifest.manifestRevision) || manifest.manifestRevision < 1) errors.push('manifest_revision_invalid');
  if (typeof manifest.globalRulesVersion !== 'string' || !manifest.globalRulesVersion.trim()) errors.push('global_rules_version_missing');
  else if (manifest.globalRulesVersion !== canonical.globalRulesVersion) errors.push('global_rules_version_mismatch');
  return errors;
}

test('canonical release binding is explicit, not a legacy alias', () => {
  assert.equal(canonical.schema, 'global-story-rules-v1');
  assert.equal(canonical.globalRulesVersion, 'global-story-bible-v1');
  assert.equal(canonical.lineage.legacyDraftVersion, 'global-v1');
  assert.equal(legacyDraft.globalRulesVersion, 'global-v1');
  assert.notEqual(canonical.globalRulesVersion, legacyDraft.globalRulesVersion);
});

test('canonical contract retains exactly the eight public narrative requirements', () => {
  assert.deepEqual(canonical.rules, legacyDraft.rules);
  assert.deepEqual(canonical.rules.map(rule => rule.id), ['G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08']);
  assert.equal(new Set(canonical.rules.map(rule => rule.id)).size, 8);
  assert.equal(canonical.revisionPolicy.publishedVersionIsImmutable, true);
  assert.equal(canonical.revisionPolicy.mismatch, 'fail-closed-before-import');
});

test('matching world01 manifest binding passes this isolated contract check', () => {
  assert.deepEqual(validateBinding(sample), []);
});

test('legacy global-v1 binding cannot silently pass as canonical', () => {
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: 'global-v1' }), ['global_rules_version_mismatch']);
});

test('unrecognized future binding cannot silently pass as canonical', () => {
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: 'global-story-bible-v2' }), ['global_rules_version_mismatch']);
});

test('missing and whitespace-only binding fail closed', () => {
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: undefined }), ['global_rules_version_missing']);
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: ' ' }), ['global_rules_version_missing']);
});

test('trailing whitespace is not a version alias', () => {
  assert.deepEqual(validateBinding({ ...sample, globalRulesVersion: 'global-story-bible-v1 ' }), ['global_rules_version_mismatch']);
});

test('world id and manifest revision must be valid', () => {
  assert.deepEqual(validateBinding({ ...sample, worldId: '', manifestRevision: 0 }), ['world_id_invalid', 'manifest_revision_invalid']);
  assert.deepEqual(validateBinding({ ...sample, worldId: 'World01' }), ['world_id_invalid']);
});

test('missing or malformed manifest fails closed', () => {
  assert.deepEqual(validateBinding(null), ['manifest_missing']);
  assert.deepEqual(validateBinding([]), ['manifest_missing']);
});

// This tests public authoring semantics only; it does not execute the importer,
// Cloudflare Worker, private content, D1, or a real model.
