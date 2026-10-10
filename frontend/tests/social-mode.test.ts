import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSocialEnabled } from '../src/domain/socialMode.ts';

test('social is on unless a build turns it off', () => {
  assert.equal(resolveSocialEnabled(undefined), true);
  assert.equal(resolveSocialEnabled('true'), true);
  assert.equal(resolveSocialEnabled('false'), false);
});
