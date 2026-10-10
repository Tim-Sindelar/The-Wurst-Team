import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSocialMode } from '../src/domain/socialMode.ts';

test('production enables live social without sample data', () => {
  assert.deepEqual(resolveSocialMode(undefined, undefined), {
    enabled: true,
    demo: false,
  });
  assert.deepEqual(resolveSocialMode('true', 'false'), {
    enabled: true,
    demo: false,
  });
});

test('local samples and PR samples require a separate demo switch', () => {
  assert.equal(resolveSocialMode(undefined, undefined, true).demo, true);
  assert.equal(resolveSocialMode('true', 'true').demo, true);
  assert.equal(resolveSocialMode('true', 'false', true).demo, false);
});

test('disabling social also disables samples', () => {
  assert.deepEqual(resolveSocialMode('false', 'true', true), {
    enabled: false,
    demo: false,
  });
});
