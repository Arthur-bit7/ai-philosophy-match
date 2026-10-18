const test = require('node:test');
const assert = require('node:assert/strict');
const { fallbackSimilarity, localComparison, parseModelSimilarity } = require('../src/similarity');
const modelResult = {
  similarity: 75,
  reason: '都关心公平，但实现方式不同。',
  commonGround: ['公平'],
  differences: ['实现方式'],
  followUp: '怎样权衡？',
};
test('Chinese continuous text is segmented instead of treated as one token', () => {
  const score = fallbackSimilarity('自由和平等都很重要', '自由和平等需要保障');
  assert.ok(score > 0 && score < 100);
  assert.equal(fallbackSimilarity('自由 平等 博爱', '自由 法治 平等'), 50);
  assert.equal(fallbackSimilarity('Hello world', 'HELLO WORLD!'), 100);
  assert.equal(fallbackSimilarity('', ''), 0);
});
test('option-only responses do not fabricate a semantic percentage', () => {
  const result = localComparison(
    { selectedOption: '支持', answerText: '' },
    { selectedOption: '支持', answerText: '' },
  );
  assert.equal(result.similarity, null);
  assert.equal(result.optionAgreement, true);
  assert.match(result.metric, /词语/);
});
test('opposing choices are exposed separately from overlapping words', () => {
  const result = localComparison(
    { selectedOption: '支持', answerText: '自由 很重要' },
    { selectedOption: '反对', answerText: '自由 很重要' },
  );
  assert.equal(result.similarity, 100);
  assert.equal(result.optionAgreement, false);
  assert.equal(result.differences.length, 1);
  assert.match(result.reason, /不等于观点相同/);
});
test('model parsing accepts valid JSON and fenced JSON but rejects invalid scores/schema', () => {
  assert.equal(parseModelSimilarity(JSON.stringify(modelResult)).similarity, 75);
  assert.equal(
    parseModelSimilarity('```json\n' + JSON.stringify(modelResult) + '\n```').provider,
    'openai',
  );
  for (const value of [null, true, '75', -1, 101])
    assert.equal(parseModelSimilarity(JSON.stringify({ ...modelResult, similarity: value })), null);
  assert.equal(parseModelSimilarity('null'), null);
  assert.equal(parseModelSimilarity(JSON.stringify({ ...modelResult, differences: 'x' })), null);
  assert.equal(parseModelSimilarity('invalid'), null);
});
