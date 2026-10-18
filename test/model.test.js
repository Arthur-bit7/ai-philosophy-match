const test = require('node:test');
const assert = require('node:assert/strict');
const { compareAnswers } = require('../src/model');
const config = {
  provider: 'openai',
  apiKey: 'do-not-leak',
  model: 'test',
  completionUrl: 'https://api.openai.com/v1/chat/completions',
};
const a = { nickname: 'Private name', answerText: '我支持', selectedOption: '支持' };
const b = { nickname: 'Other name', answerText: '我反对', selectedOption: '反对' };
test('model request omits names and credentials from prompt and validates its result', async () => {
  const result = await compareAnswers({ questionText: '问题' }, a, b, config, {
    fetchImpl: async (url, options) => {
      assert.equal(url, config.completionUrl);
      assert.equal(options.headers.Authorization, 'Bearer do-not-leak');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      assert.ok(!options.body.includes('Private name'));
      assert.ok(!options.body.includes('do-not-leak'));
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  similarity: 20,
                  reason: '选项不同',
                  commonGround: [],
                  differences: ['选择相反'],
                  followUp: '为什么？',
                }),
              },
            },
          ],
        }),
      };
    },
  });
  assert.equal(result.provider, 'openai');
  assert.equal(result.similarity, 20);
});
test('local mode makes no outbound call', async () => {
  const result = await compareAnswers(
    {},
    a,
    b,
    { provider: 'local' },
    {
      fetchImpl: () => {
        throw new Error('must not call');
      },
    },
  );
  assert.equal(result.provider, 'local');
  assert.equal(result.notice, '');
});
test('HTTP, malformed output and network errors degrade without leaking upstream details', async () => {
  const responses = [
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({ choices: [] }) }),
    async () => {
      throw new Error('do-not-leak');
    },
  ];
  for (const fetchImpl of responses) {
    const result = await compareAnswers({}, a, b, config, { fetchImpl });
    assert.equal(result.provider, 'local');
    assert.match(result.notice, /暂时不可用/);
    assert.ok(!JSON.stringify(result).includes('do-not-leak'));
  }
});
test('a stalled upstream request is aborted and returns the fallback', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const result = await compareAnswers({}, a, b, config, {
      timeoutMs: 15,
      fetchImpl: (_url, { signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    });
    assert.equal(result.provider, 'local');
  } finally {
    clearInterval(keepAlive);
  }
});
