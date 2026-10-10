import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertPreviewComment } from './preview-comment.mjs';

const options = { repository: 'team/app', pr: 123, url: 'https://example.org/pr/123/', sha: 'abc', state: 'ready', token: 'test-only' };
const response = (data) => ({ ok: true, json: async () => data });

test('creates a preview comment without modifying a matching human comment', async () => {
  const calls = [];
  await upsertPreviewComment({ ...options, fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    return response(init.method === 'GET' ? [{ id: 7, user: { login: 'human' }, body: '<!-- wurst-pr-preview -->' }] : {});
  } });
  assert.equal(calls[1].method, 'POST');
  assert.ok(calls[1].url.endsWith('/issues/123/comments'));
  assert.match(JSON.parse(calls[1].body).body, /https:\/\/example.org\/pr\/123\//);
});

test('finds the bot comment on later pages and updates it on close', async () => {
  const calls = [];
  await upsertPreviewComment({ ...options, state: 'removed', fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    if (url.endsWith('page=1')) return response(Array.from({ length: 100 }, () => ({ user: { login: 'human' } })));
    if (init.method === 'GET') return response([{ id: 42, user: { login: 'github-actions[bot]' }, body: '<!-- wurst-pr-preview --> old URL' }]);
    return response({});
  } });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, 'PATCH');
  assert.ok(calls[2].url.endsWith('/issues/comments/42'));
  assert.match(JSON.parse(calls[2].body).body, /was removed/);
});

test('closing a PR without a deployed preview adds no comment', async () => {
  let requests = 0;
  await upsertPreviewComment({ ...options, state: 'removed', fetchImpl: async (_url, init) => {
    requests++;
    assert.equal(init.method, 'GET');
    return response([]);
  } });
  assert.equal(requests, 1);
});
