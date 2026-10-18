const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModelConfig } = require('../src/model-config');
test('local is the explicit default even when a server key exists', () => {
  assert.equal(buildModelConfig({}, { OPENAI_API_KEY: 'secret' }).provider, 'local');
});
test('OpenAI uses a fixed endpoint and supports a server key', () => {
  const config = buildModelConfig(
    { provider: 'openai' },
    { OPENAI_API_KEY: 'secret', OPENAI_MODEL: 'my-model' },
  );
  assert.equal(config.completionUrl, 'https://api.openai.com/v1/chat/completions');
  assert.equal(config.model, 'my-model');
  assert.equal(config.apiKey, 'secret');
  assert.equal(
    buildModelConfig({ provider: 'openai', apiKey: 'custom', model: 'model' }, {}).apiKey,
    'custom',
  );
});
test('invalid and retired providers or incomplete credentials do not silently fall back', () => {
  for (const provider of ['github-models', 'custom-url'])
    assert.throws(() => buildModelConfig({ provider }, {}), /不支持/);
  assert.throws(() => buildModelConfig({ provider: 'openai' }, {}), /API Key/);
  assert.throws(() => buildModelConfig(null), /对象/);
  assert.throws(() => buildModelConfig({ provider: 'openai', apiKey: {} }), /文本/);
  assert.throws(() => buildModelConfig({ provider: 'openai', apiKey: 'a\nb' }), /格式/);
});
