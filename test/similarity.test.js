const test = require('node:test');
const assert = require('node:assert/strict');
const { fallbackSimilarity, parseModelSimilarity } = require('../src/similarity');

test('fallbackSimilarity returns 100 for two empty answers', () => {
  assert.equal(fallbackSimilarity('', ''), 100);
});

test('fallbackSimilarity returns expected overlap score', () => {
  const score = fallbackSimilarity('自由 平等 博爱', '自由 法治 平等');
  assert.equal(score, 50);
});

test('parseModelSimilarity extracts and clamps similarity', () => {
  const parsed = parseModelSimilarity('```json\n{"similarity": 120, "reason": "很像", "leaning": "自由主义"}\n```');
  assert.deepEqual(parsed, {
    similarity: 100,
    reason: '很像',
    leaning: '自由主义',
  });
});
