const test = require('node:test');
const assert = require('node:assert/strict');
const { buildModelConfig } = require('../src/model-config');

test('buildModelConfig maps OpenAI provider to fixed endpoint', () => {
  const config = buildModelConfig({
    provider: 'openai',
    apiKey: 'k',
    model: 'gpt-4o-mini',
  });
  assert.equal(config.baseUrl, 'https://api.openai.com');
  assert.equal(config.provider, 'openai');
});

test('buildModelConfig rejects unsupported provider', () => {
  assert.throws(
    () =>
      buildModelConfig({
        provider: 'custom-url',
        apiKey: 'k',
        model: 'x',
      }),
    /不支持/
  );
});
