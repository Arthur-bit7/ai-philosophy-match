const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeRemoteBaseUrl, buildModelConfig } = require('../src/model-config');

test('isSafeRemoteBaseUrl accepts public https endpoint', () => {
  assert.equal(isSafeRemoteBaseUrl('https://api.openai.com/v1'), true);
});

test('isSafeRemoteBaseUrl rejects localhost and private ranges', () => {
  assert.equal(isSafeRemoteBaseUrl('http://localhost:3000/v1'), false);
  assert.equal(isSafeRemoteBaseUrl('https://127.0.0.1/v1'), false);
  assert.equal(isSafeRemoteBaseUrl('https://192.168.1.20/v1'), false);
});

test('buildModelConfig throws for unsafe custom endpoint', () => {
  assert.throws(
    () =>
      buildModelConfig({
        apiKey: 'k',
        baseUrl: 'http://localhost:3000/v1',
        model: 'x',
      }),
    /HTTPS/
  );
});
