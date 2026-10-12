import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pantryBlobSha, preparePublishLink, PUBLISH_TITLE, REPOSITORY } from './publish.mjs';
import { validatePublishRequest, processPublishRequest } from './scripts/publish-request.mjs';

const source = JSON.parse(await readFile(new URL('./pantry.json', import.meta.url), 'utf8'));
const baseSha = 'a'.repeat(40);
const now = Date.now();
const data = { ...source, lastUpdatedAt: new Date(now).toISOString() };
const payload = () => ({ kind: 'pantryping-publish', version: 1, baseSha, data: structuredClone(data) });
function event(changes = {}) {
  return {
    action: 'opened', repository: { full_name: REPOSITORY },
    issue: { number: 12, title: PUBLISH_TITLE, user: { login: 'aaravsinhaofficial' }, body: `Public information only.\n\n\`\`\`json\n${JSON.stringify(payload())}\n\`\`\``, ...changes },
  };
}
function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('Git blob hash uses UTF-8 bytes, including non-ASCII characters', async () => {
  assert.equal(await pantryBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(await pantryBlobSha('Pantry 🥫\n'), '3e3616a762e1e6aa0cef430ed10ef3d05530aedb');
});

test('publish link rejects an editor loaded before another update', async () => {
  const fetchCurrent = async () => response({ type: 'file', path: 'pantry.json', sha: baseSha });
  await assert.rejects(preparePublishLink(data, fetchCurrent, 'b'.repeat(40)), /changed while you were editing/);
  const result = await preparePublishLink(data, fetchCurrent, baseSha);
  assert.equal(result.baseSha, baseSha);
});

test('publish link uses verified pantry SHA and round-trips reviewed data', async () => {
  const result = await preparePublishLink(data, async url => {
    assert.equal(url, `https://api.github.com/repos/${REPOSITORY}/contents/pantry.json?ref=main`);
    return response({ type: 'file', path: 'pantry.json', sha: baseSha });
  });
  const link = new URL(result.url);
  assert.equal(link.origin, 'https://github.com');
  assert.equal(link.searchParams.get('title'), PUBLISH_TITLE);
  assert.equal(result.baseSha, baseSha);
  const request = validatePublishRequest(event({ body: link.searchParams.get('body') }), { now });
  assert.deepEqual(request.data, data);
});

test('publish link rejects unexpected GitHub data and oversized links', async () => {
  await assert.rejects(preparePublishLink(data, async () => response({ sha: baseSha })), /unexpected/);
  const large = structuredClone(data);
  large.pantry.note = '🥫'.repeat(450);
  large.categories = Array.from({ length: 40 }, (_, i) => ({ id: `item-${i}`, name: 'A'.repeat(80), description: 'B'.repeat(300), status: 'available' }));
  await assert.rejects(preparePublishLink(large, async () => response({ type: 'file', path: 'pantry.json', sha: baseSha })), /too large/);
});

test('only repository owner may publish and unrelated issues are rejected', () => {
  assert.throws(() => validatePublishRequest(event({ user: { login: 'visitor' } }), { now }), /Only the repository owner/);
  assert.throws(() => validatePublishRequest(event({ title: 'Publish please' }), { now }), /not a newly opened/);
  assert.throws(() => validatePublishRequest({ ...event(), repository: { full_name: 'other/repo' } }, { now }), /configured/);
});

test('malformed, multiple, invalid schema, and stale requests are rejected', () => {
  assert.throws(() => validatePublishRequest(event({ body: '```json\n{bad}\n```' }), { now }), /could not be read/);
  assert.throws(() => validatePublishRequest(event({ body: `${event().issue.body}\n${event().issue.body}` }), { now }), /exactly one/);
  const invalid = payload();
  invalid.data.categories[0].status = 'definitely-stocked';
  assert.throws(() => validatePublishRequest(event({ body: `\`\`\`json\n${JSON.stringify(invalid)}\n\`\`\`` }), { now }), /failed validation/);
  assert.throws(() => validatePublishRequest(event(), { now: now + 16 * 60 * 1000 }), /15 minutes/);
  assert.throws(() => validatePublishRequest(event(), { now: now - 16 * 60 * 1000 }), /15 minutes/);
});

test('unauthorized request makes no API call', async () => {
  const result = await processPublishRequest(event({ user: { login: 'visitor' } }), {
    now, token: 'test-token', fetchImpl: () => assert.fail('Unauthorized requests must not touch GitHub data'),
  });
  assert.equal(result.published, false);
});

test('changed base SHA rejects before any write', async () => {
  let requests = 0;
  const result = await processPublishRequest(event(), {
    now, token: 'test-token', fetchImpl: async (url, options) => {
      requests++;
      assert.equal(options.method, undefined);
      return response({ type: 'file', path: 'pantry.json', sha: 'b'.repeat(40) });
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.published, false);
  assert.match(result.message, /Nothing was overwritten/);
});

test('publish writes only pantry.json, expected SHA, and validated JSON', async () => {
  const calls = [];
  const result = await processPublishRequest(event(), {
    now, token: 'test-token', fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response({ type: 'file', path: 'pantry.json', sha: baseSha });
      assert.equal(url, `https://api.github.com/repos/${REPOSITORY}/contents/pantry.json`);
      assert.equal(options.method, 'PUT');
      const body = JSON.parse(options.body);
      assert.equal(body.sha, baseSha);
      assert.equal(body.branch, 'main');
      assert.deepEqual(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')), data);
      return response({}, 200);
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.published, true);
});

test('racing update never retries or force-overwrites', async () => {
  let count = 0;
  const result = await processPublishRequest(event(), {
    now, token: 'test-token', fetchImpl: async () => {
      count++;
      return count === 1 ? response({ type: 'file', path: 'pantry.json', sha: baseSha }) : response({}, 409);
    },
  });
  assert.equal(count, 2);
  assert.equal(result.published, false);
  assert.match(result.message, /No forced overwrite/);
});
