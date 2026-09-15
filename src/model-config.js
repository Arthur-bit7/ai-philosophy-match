function buildModelConfig(apiConfig = {}) {
  const hasCustomApi = Boolean(apiConfig.apiKey && apiConfig.model);

  if (hasCustomApi) {
    const selectedProvider = String(apiConfig.provider || 'github-models');
    let customBaseUrl;

    switch (selectedProvider) {
      case 'github-models':
        customBaseUrl = process.env.GITHUB_MODELS_ENDPOINT || 'https://models.inference.ai.azure.com';
        break;
      case 'openai':
        customBaseUrl = 'https://api.openai.com';
        break;
      default:
        throw new Error('不支持的模型供应商。');
    }

    return {
      provider: selectedProvider,
      apiKey: String(apiConfig.apiKey),
      baseUrl: String(customBaseUrl).replace(/\/$/, ''),
      model: String(apiConfig.model),
    };
  }

  return {
    provider: 'github-models',
    apiKey: process.env.GITHUB_TOKEN || process.env.GITHUB_MODELS_API_KEY || '',
    baseUrl: (process.env.GITHUB_MODELS_ENDPOINT || 'https://models.inference.ai.azure.com').replace(/\/$/, ''),
    model: process.env.GITHUB_MODELS_MODEL || 'gpt-4o-mini',
  };
}

module.exports = {
  buildModelConfig,
};
