const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { localComparison } = require('../src/similarity');
const question = { questionText: '自由与公平，如何权衡？', options: ['自由', '公平', '平衡'] };
async function fixture(t, options = {}) {
  const app = createApp({ env: {}, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        app.server.close(resolve);
        app.server.closeAllConnections();
      }),
  );
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (path, body, token, extra = {}) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const create = async (extra = {}) =>
    (await request('/api/rooms', { nickname: '甲', question, ...extra })).data;
  return { ...app, base, request, create };
}
test('two-person blind reveal, authentication, refresh, option-only answer and next-round history', async (t) => {
  const { request, create, store } = await fixture(t);
  const host = await create();
  const path = '/api/rooms/' + host.roomId;
  assert.equal(host.participantCount, 1);
  const guest = (await request(path + '/join', { nickname: '乙' })).data;
  assert.equal((await request(path + '/join', { nickname: '第三人' })).status, 409);
  assert.equal((await request(path + '/submit', { round: 1, answerText: '偷窥' })).status, 403);
  assert.equal((await request(path + '/result')).status, 403);
  const preview = (await request(path)).data;
  assert.ok(!preview.question && !preview.answers && !preview.participants);
  const first = await request(
    path + '/submit',
    { round: 1, answerText: '保密回答', selectedOption: '自由' },
    host.token,
  );
  assert.equal(first.status, 200);
  const waiting = (await request(path, undefined, guest.token)).data;
  assert.equal(waiting.answers, null);
  assert.ok(!JSON.stringify(waiting).includes('保密回答'));
  const restored = (await request(path, undefined, host.token)).data;
  assert.equal(restored.mySubmission.answerText, '保密回答');
  await request(path + '/submit', { round: 1, selectedOption: '公平' }, guest.token);
  await store.get(host.roomId).pending;
  const ready = (await request(path, undefined, host.token)).data;
  assert.equal(ready.status, 'ready');
  assert.equal(ready.answers.length, 2);
  assert.equal(ready.result.similarity, null);
  assert.equal(ready.result.optionAgreement, false);
  assert.ok(!JSON.stringify(ready).includes(guest.token));
  assert.equal((await request(path + '/next', { round: 1, question }, guest.token)).status, 403);
  const next = (
    await request(
      path + '/next',
      { round: 1, question: { questionText: '什么是幸福？', options: [] } },
      host.token,
    )
  ).data;
  assert.equal(next.round, 2);
  assert.equal(next.history.length, 1);
  assert.equal(next.submissionCount, 0);
  assert.equal(next.result, null);
  assert.equal(
    (await request(path + '/submit', { round: 1, answerText: '旧答案' }, guest.token)).status,
    409,
  );
  assert.equal((await request(path + '/next', { round: 1, question }, host.token)).status, 409);
});
test('same nickname cannot overwrite another participant; invalid creation leaves no room', async (t) => {
  const { create, request, store } = await fixture(t);
  assert.equal(
    (await request('/api/rooms', { nickname: '甲', question, apiConfig: { provider: 'unknown' } }))
      .status,
    400,
  );
  assert.equal(store.rooms.size, 0);
  const host = await create();
  assert.equal(
    (await request('/api/rooms/' + host.roomId + '/join', { nickname: '甲' })).status,
    409,
  );
  assert.equal(store.get(host.roomId).members.length, 1);
});
test('blank, oversized and fabricated answers or malformed questions never mutate room state', async (t) => {
  const { create, request, store } = await fixture(t);
  for (const options of [['only'], ['same', 'same'], [7], Array(9).fill('x')]) {
    assert.equal(
      (await request('/api/rooms', { nickname: '甲', question: { ...question, options } })).status,
      400,
    );
  }
  const host = await create();
  for (const answer of [
    {},
    { answerText: 'x'.repeat(4001) },
    { selectedOption: '伪造选项' },
    { answerText: {} },
  ]) {
    assert.equal(
      (await request('/api/rooms/' + host.roomId + '/submit', { round: 1, ...answer }, host.token))
        .status,
      400,
    );
  }
  assert.equal(store.get(host.roomId).submissions.size, 0);
});
test('concurrent retries call the model once, keep original answer and prevent premature next round', async (t) => {
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { request, create, store } = await fixture(t, {
    compare: async (_q, a, b) => {
      calls++;
      await gate;
      return localComparison(a, b);
    },
  });
  const host = await create();
  const path = '/api/rooms/' + host.roomId;
  const guest = (await request(path + '/join', { nickname: '乙' })).data;
  await request(path + '/submit', { round: 1, answerText: '原回答' }, host.token);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      request(path + '/submit', { round: 1, answerText: '乙的回答' }, guest.token),
    ),
  );
  const retry = (await request(path + '/submit', { round: 1, answerText: '篡改' }, host.token))
    .data;
  assert.equal(retry.status, 'analyzing');
  assert.equal(retry.mySubmission.answerText, '原回答');
  assert.equal(calls, 1);
  assert.equal((await request(path + '/next', { round: 1, question }, host.token)).status, 409);
  release();
  await store.get(host.roomId).pending;
  await request(path + '/submit', { round: 1, answerText: '重试' }, guest.token);
  assert.equal(calls, 1);
});
test('AI rooms require both participants consent and never expose the key', async (t) => {
  const { create, request } = await fixture(t, { env: { OPENAI_API_KEY: 'server-secret' } });
  const payload = { nickname: '甲', question, apiConfig: { provider: 'openai' } };
  assert.equal((await request('/api/rooms', payload)).status, 400);
  const host = await create({ apiConfig: { provider: 'openai' }, consent: true });
  assert.ok(!JSON.stringify(host).includes('server-secret'));
  const path = '/api/rooms/' + host.roomId;
  assert.equal((await request(path + '/join', { nickname: '乙' })).status, 400);
  assert.equal((await request(path + '/join', { nickname: '乙', consent: true })).status, 200);
});
test('capacity and absolute expiry are enforced even when clients keep polling', async (t) => {
  let now = 1000;
  const { create, request, store } = await fixture(t, { now: () => now, ttlMs: 1000, maxRooms: 1 });
  const host = await create();
  assert.equal((await request('/api/rooms', { nickname: '乙', question })).status, 503);
  const expired = store.get(host.roomId);
  expired.modelConfig.apiKey = 'secret';
  now = 2001;
  assert.equal((await request('/api/rooms/' + host.roomId, undefined, host.token)).status, 404);
  assert.equal(expired.modelConfig.apiKey, '');
  assert.equal(store.rooms.size, 0);
  assert.ok((await create()).token);
});
test('body validation, request limits, static content types and security headers', async (t) => {
  const { request, base } = await fixture(t);
  for (const payload of [null, [], 'text'])
    assert.equal((await request('/api/rooms', payload)).status, 400);
  assert.equal((await request('/api/rooms', { content: 'x'.repeat(33000) })).status, 413);
  const malformed = await fetch(base + '/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  const plain = await fetch(base + '/api/rooms', { method: 'POST', body: '{}' });
  assert.equal(plain.status, 415);
  assert.equal(
    (await request('/api/rooms', {}, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status,
    403,
  );
  for (const [path, type] of [
    ['/', 'text/html'],
    ['/app.js', 'text/javascript'],
    ['/styles.css', 'text/css'],
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(type));
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e%2fserver.js')).status, 404);
  let last;
  for (let i = 0; i < 21; i++) last = await request('/api/rooms', {});
  assert.equal(last.status, 429);
});
