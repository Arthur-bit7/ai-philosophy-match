function buildModelConfig(apiConfig = {}, env = process.env) {
  if (!apiConfig || typeof apiConfig !== 'object' || Array.isArray(apiConfig))
    throw new Error('模型配置必须为对象。');
  const provider = apiConfig.provider || 'local';
  if (provider === 'local') return { provider: 'local', apiKey: '', model: '' };
  if (provider !== 'openai') throw new Error('不支持的模型供应商，请选择本地比较或 OpenAI。');
  for (const key of ['apiKey', 'model']) {
    if (apiConfig[key] !== undefined && typeof apiConfig[key] !== 'string')
      throw new Error('模型名和 API Key 必须为文本。');
  }
  const apiKey = (apiConfig.apiKey || env.OPENAI_API_KEY || '').trim();
  const model = (apiConfig.model || env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  if (!apiKey) throw new Error('请填写 OpenAI API Key，或先在服务器配置 OPENAI_API_KEY。');
  if (apiKey.length > 512 || /\s/.test(apiKey) || !model || model.length > 120)
    throw new Error('模型名或 API Key 格式不正确。');
  return {
    provider,
    apiKey,
    model,
    baseUrl: 'https://api.openai.com',
    completionUrl: 'https://api.openai.com/v1/chat/completions',
  };
}
module.exports = { buildModelConfig };
