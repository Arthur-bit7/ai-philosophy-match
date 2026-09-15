function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function fallbackSimilarity(answerA, answerB) {
  const setA = new Set(tokenize(answerA));
  const setB = new Set(tokenize(answerB));

  if (setA.size === 0 && setB.size === 0) {
    return 100;
  }

  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  if (union === 0) {
    return 0;
  }
  return Math.round((intersection / union) * 100);
}

function parseModelSimilarity(content) {
  const raw = String(content || '').trim();
  if (!raw) return null;

  const blockMatch = raw.match(/\{[\s\S]*\}/);
  const candidate = blockMatch ? blockMatch[0] : raw;

  try {
    const parsed = JSON.parse(candidate);
    const similarity = Number(parsed.similarity);
    if (!Number.isFinite(similarity)) return null;
    return {
      similarity: Math.max(0, Math.min(100, Math.round(similarity))),
      reason: String(parsed.reason || '模型未提供详细解释。'),
      leaning: String(parsed.leaning || '未明确'),
    };
  } catch {
    return null;
  }
}

module.exports = {
  fallbackSimilarity,
  parseModelSimilarity,
};
