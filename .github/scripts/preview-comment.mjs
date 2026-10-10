import { fileURLToPath } from 'node:url';

const marker = '<!-- wurst-pr-preview -->';

export async function upsertPreviewComment({
  repository, pr, url, sha, state, token, fetchImpl = fetch,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[1-9]\d*$/.test(String(pr))) {
    throw new Error('Invalid repository or PR number');
  }
  if (!['ready', 'removed'].includes(state)) throw new Error('Invalid preview state');
  const api = `https://api.github.com/repos/${repository}`;
  async function request(path, method = 'GET', body) {
    const response = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`GitHub comment request failed: ${response.status}`);
    return response.json();
  }
  let existing;
  for (let page = 1; ; page++) {
    const comments = await request(`/issues/${pr}/comments?per_page=100&page=${page}`);
    existing = comments.find((comment) =>
      comment.user?.login === 'github-actions[bot]' && comment.body?.includes(marker));
    if (existing || comments.length < 100) break;
  }
  const body = state === 'ready'
    ? `${marker}\nPreview ready: [Open PR #${pr}](${url})\n\nCommit: \`${sha}\`. Uses the organizers’ managed login. Preview data is separate from production.`
    : `${marker}\nPreview for PR #${pr} was removed when the pull request closed.`;
  if (existing) {
    await request(`/issues/comments/${existing.id}`, 'PATCH', { body });
  } else if (state === 'ready') {
    await request(`/issues/${pr}/comments`, 'POST', { body });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await upsertPreviewComment({
    repository: process.env.GITHUB_REPOSITORY,
    pr: process.env.PR_NUMBER,
    url: process.env.PREVIEW_URL,
    sha: process.env.GITHUB_SHA,
    state: process.env.PREVIEW_STATE,
    token: process.env.GH_TOKEN,
  });
}
