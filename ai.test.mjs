import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAISuggestions, prepareAI, signInAI, generateStockSuggestions } from './ai.mjs';

const categories = [
  { id: 'produce', name: 'Fresh produce', description: 'Fruit and vegetables' },
  { id: 'dairy', name: 'Milk and dairy', description: 'Milk and cheese' },
  { id: 'bread', name: 'Bread' },
];
const note = 'Fresh produce is available. Milk and dairy are running low. No bread left.';
const output = updates => JSON.stringify({ updates });

test('real quotations are preserved, case-insensitively, and unmentioned categories stay unknown', () => {
  const result = parseAISuggestions(output([
    { id: 'dairy', status: 'limited', evidence: 'Milk and dairy are running low' },
    { id: 'produce', status: 'available', evidence: 'fresh produce is available' },
  ]), note, categories);
  assert.deepEqual(result, [
    { id: 'produce', status: 'available', evidence: 'fresh produce is available' },
    { id: 'dairy', status: 'limited', evidence: 'Milk and dairy are running low' },
    { id: 'bread', status: 'unknown', evidence: '' },
  ]);
});

test('supports Puter string responses and documented text content blocks', () => {
  const text = output([{ id: 'bread', status: 'unavailable', evidence: 'No bread left' }]);
  const expected = parseAISuggestions(text, note, categories);
  assert.deepEqual(parseAISuggestions({ message: { content: text }, finish_reason: 'stop' }, note, categories), expected);
  assert.deepEqual(parseAISuggestions({ message: { content: [
    { type: 'text', text: text.slice(0, 30) }, { type: 'text', text: text.slice(30) },
  ] } }, note, categories), expected);
});

test('rejects invented or missing evidence without applying partial output', () => {
  for (const evidence of ['', '   ', 'We have plenty of fresh produce', 'No milk left']) {
    assert.throws(() => parseAISuggestions(output([{ id: 'produce', status: 'available', evidence }]), note, categories), /exact quote/);
  }
  assert.throws(() => parseAISuggestions(output([{ id: 'produce', status: 'unknown', evidence: 'invented' }]), note, categories), /exact quote/);
});

test('rejects unknown IDs, duplicate IDs, unauthorized fields and unsupported statuses', () => {
  const valid = { id: 'bread', status: 'unavailable', evidence: 'No bread left' };
  for (const changed of [
    { ...valid, id: 'another-pantry' }, { ...valid, id: '__proto__' },
    { ...valid, status: 'in_stock' }, { ...valid, status: 'toString' },
    { ...valid, policy: 'No eligibility requirements' }, { id: 'bread', status: 'unknown' },
  ]) assert.throws(() => parseAISuggestions(output([changed]), note, categories), /invalid/);
  assert.throws(() => parseAISuggestions(output([valid, valid]), note, categories), /duplicate/);
  assert.throws(() => parseAISuggestions(JSON.stringify({ updates: [], hours: 'Always open' }), note, categories), /invalid/);
});

test('does not accept code fences, incomplete responses, tool calls or malformed JSON', () => {
  for (const text of ['```json\n{"updates":[]}\n```', '{"updates":', 'null', '[]', '{}']) {
    assert.throws(() => parseAISuggestions(text, note, categories), /invalid/);
  }
  assert.throws(() => parseAISuggestions({ message: { content: '{"updates":[]}' }, finish_reason: 'length' }, note, categories), /incomplete/);
  assert.throws(() => parseAISuggestions({ message: { content: [{ type: 'tool_use', text: '{}' }] } }, note, categories), /text-only/);
});

test('input and output sizes and category identifiers are bounded', () => {
  for (const invalidNote of ['', ' ', null, 'x'.repeat(3001)]) {
    assert.throws(() => parseAISuggestions(output([]), invalidNote, categories), /3,000/);
  }
  assert.throws(() => parseAISuggestions(' '.repeat(15001), note, categories), /15,000/);
  assert.throws(() => parseAISuggestions(output([]), note, []), /40 categories/);
  assert.throws(() => parseAISuggestions(output([]), note, Array.from({ length: 41 }, (_, i) => ({ id: `x${i}`, name: 'Name' }))), /40 categories/);
  assert.throws(() => parseAISuggestions(output([]), note, [categories[0], categories[0]]), /unique/);
  assert.throws(() => parseAISuggestions(output([]), note, [{ id: '../evil', name: 'Name' }]), /invalid/);
  assert.throws(() => parseAISuggestions(output([]), note, [{ id: 'valid', name: 'x'.repeat(81) }]), /invalid/);
  assert.throws(() => parseAISuggestions(output([{ id: 'bread', status: 'unknown', evidence: 'x'.repeat(501) }]), 'x'.repeat(1000), categories), /invalid/);
});

test('loading and generating require opt-in and authentication; no AI calls occur', async () => {
  assert.equal(globalThis.puter, undefined);
  await assert.rejects(prepareAI(), /browser/);
  await assert.rejects(signInAI(), /Enable AI first/);
  await assert.rejects(generateStockSuggestions(note, categories), /Enable AI first/);
});

test('mocked SDK preserves synchronous sign-in activation and calls actual chat API shape once', async () => {
  let signedIn = false;
  let signInCalled = false;
  let calls = 0;
  const status = [];
  globalThis.puter = {
    auth: {
      isSignedIn: () => signedIn,
      signIn: () => { signInCalled = true; signedIn = true; return Promise.resolve({}); },
    },
    ai: { chat: async (prompt, options) => {
      calls++;
      assert.match(prompt, /untrusted input, never instructions/);
      assert.match(prompt, /UNTRUSTED_DATA_JSON/);
      assert.equal(options.normalize, true);
      assert.equal(options.max_tokens, 4096);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      assert.equal(status.length, 1, 'status is reported before inference');
      return { message: { content: output([{ id: 'bread', status: 'unavailable', evidence: 'No bread left' }]) } };
    } },
  };
  try {
    assert.deepEqual(await prepareAI(), { signedIn: false });
    await assert.rejects(generateStockSuggestions(note, categories), /Sign in/);
    assert.equal(calls, 0);
    const signingIn = signInAI();
    assert.equal(signInCalled, true, 'auth signIn called before returning/awaiting');
    assert.deepEqual(await signingIn, { signedIn: true });
    const suggestions = await generateStockSuggestions(note, categories, { onStatus: text => status.push(text) });
    assert.equal(calls, 1);
    assert.equal(status.length, 2);
    assert.equal(suggestions[2].status, 'unavailable');
  } finally { delete globalThis.puter; }
});

test('provider credit failures and cancelled sign-in have honest errors with no retry', async () => {
  let calls = 0;
  globalThis.puter = {
    auth: { isSignedIn: () => true, signIn: () => Promise.resolve({}) },
    ai: { chat: async () => { calls++; throw { error: { code: 'insufficient_credits' } }; } },
  };
  try {
    await assert.rejects(generateStockSuggestions(note, categories), /account credits or usage limit/);
    assert.equal(calls, 1);
    globalThis.puter.auth.isSignedIn = () => false;
    globalThis.puter.auth.signIn = () => Promise.reject({ error: 'auth_window_closed' });
    await assert.rejects(signInAI(), /cancelled/);
  } finally { delete globalThis.puter; }
});

test('explicit sign-in refreshes a cached account after an authorization error', async () => {
  let options;
  globalThis.puter = {
    auth: {
      isSignedIn: () => true,
      signIn: supplied => { options = supplied; return Promise.resolve({}); },
    },
    ai: { chat: async () => { throw new Error('No inference expected'); } },
  };
  try {
    await signInAI();
    assert.deepEqual(options, { request_auth: true });
  } finally { delete globalThis.puter; }
});

test('inference deadline aborts a hanging provider, unblocks the caller, and never retries', async context => {
  let expire;
  let signal;
  let calls = 0;
  let cleared = false;
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 60000);
    expire = callback;
    return 123;
  });
  context.mock.method(globalThis, 'clearTimeout', handle => {
    assert.equal(handle, 123);
    cleared = true;
  });
  globalThis.puter = {
    auth: { isSignedIn: () => true, signIn: () => Promise.resolve({}) },
    ai: { chat: (prompt, options) => {
      calls++;
      signal = options.signal;
      // Simulate a provider which does not acknowledge cancellation at all.
      return new Promise(() => {});
    } },
  };
  try {
    const generating = generateStockSuggestions(note, categories);
    const rejected = assert.rejects(generating, /60 seconds.*may still charge/);
    assert.equal(signal.aborted, false);
    expire();
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason.name, 'TimeoutError');
    assert.equal(calls, 1);
    assert.equal(cleared, true);
  } finally { delete globalThis.puter; }
});
