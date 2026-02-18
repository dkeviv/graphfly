import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldProcessPushForTrackedBranch } from '../apps/api/src/lib/tracked-branch.js';

test('shouldProcessPushForTrackedBranch allows when trackedBranch is unset', () => {
  assert.equal(shouldProcessPushForTrackedBranch({ trackedBranch: null, ref: 'refs/heads/main' }), true);
  assert.equal(shouldProcessPushForTrackedBranch({ trackedBranch: '', ref: 'refs/heads/main' }), true);
});

test('shouldProcessPushForTrackedBranch matches refs/heads/<trackedBranch>', () => {
  assert.equal(shouldProcessPushForTrackedBranch({ trackedBranch: 'main', ref: 'refs/heads/main' }), true);
  assert.equal(shouldProcessPushForTrackedBranch({ trackedBranch: 'refs/heads/main', ref: 'refs/heads/main' }), true);
});

test('shouldProcessPushForTrackedBranch rejects non-tracked branches and tags', () => {
  assert.equal(shouldProcessPushForTrackedBranch({ trackedBranch: 'main', ref: 'refs/heads/feature' }), false);
  assert.equal(shouldProcessPushForTrackedBranch({ trackedBranch: 'main', ref: 'refs/tags/v1.0.0' }), false);
  assert.equal(shouldProcessPushForTrackedBranch({ trackedBranch: 'main', ref: '' }), false);
});

