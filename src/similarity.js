const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
function tokenize(text) {
  return [
    ...segmenter.segment(
      String(text || '')
        .normalize('NFKC')
        .toLowerCase(),
    ),
  ]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment);
}
function fallbackSimilarity(answerA, answerB) {
  const a = new Set(tokenize(answerA));
  const b = new Set(tokenize(answerB));
  const union = new Set([...a, ...b]).size;
  if (!union) return 0;
  return Math.round(([...a].filter((token) => b.has(token)).length / union) * 100);
}
function localComparison(first, second, notice = '') {
  const bothSelected = first.selectedOption && second.selectedOption;
  const optionAgreement = bothSelected ? first.selectedOption === second.selectedOption : null;
  const hasText = tokenize(first.answerText).length > 0 && tokenize(second.answerText).length > 0;
  return {
    similarity: hasText ? fallbackSimilarity(first.answerText, second.answerText) : null,
    metric: '词语重合度',
    provider: 'local',
    optionAgreement,
    reason: '仅比较回答中的词语，无法识别否定、语境或价值取舍。词语相似不等于观点相同。',
    commonGround: optionAgreement === true ? ['你们选择了同一个选项，可以进一步比较理由。'] : [],
    differences:
      optionAgreement === false ? ['你们选择了不同选项，可以先解释各自最看重的价值。'] : [],
    followUp: '在什么具体情境下，你愿意改变刚才的选择？',
    notice,
  };
}
function parseModelSimilarity(content) {
  if (typeof content !== 'string') return null;
  const raw = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.similarity !== 'number' ||
      !Number.isFinite(parsed.similarity) ||
      parsed.similarity < 0 ||
      parsed.similarity > 100
    )
      return null;
    for (const key of ['reason', 'followUp']) {
      if (typeof parsed[key] !== 'string' || !parsed[key].trim() || parsed[key].length > 2000)
        return null;
    }
    for (const key of ['commonGround', 'differences']) {
      if (
        !Array.isArray(parsed[key]) ||
        parsed[key].length > 5 ||
        parsed[key].some((item) => typeof item !== 'string' || !item.trim() || item.length > 1000)
      )
        return null;
    }
    return {
      similarity: Math.round(parsed.similarity),
      reason: parsed.reason,
      commonGround: parsed.commonGround,
      differences: parsed.differences,
      followUp: parsed.followUp,
      metric: '本题观点相近度',
      provider: 'openai',
      notice: 'AI 分析仅供讨论参考，不代表对个人或政治身份的判断。',
    };
  } catch {
    return null;
  }
}
module.exports = { tokenize, fallbackSimilarity, localComparison, parseModelSimilarity };
