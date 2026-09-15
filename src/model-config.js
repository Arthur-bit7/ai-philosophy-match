function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;

  if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (v4) {
    const parts = host.split('.').map((x) => Number(x));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    if (parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }

  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true;
  }

  return false;
}

function isSafeRemoteBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(String(baseUrl));
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  return !isPrivateHostname(parsed.hostname);
}

function buildModelConfig(apiConfig = {}) {
  const hasCustomApi = Boolean(apiConfig.apiKey && apiConfig.baseUrl && apiConfig.model);

  if (hasCustomApi) {
    if (!isSafeRemoteBaseUrl(apiConfig.baseUrl)) {
      throw new Error('自定义模型地址必须是公网 HTTPS 地址。');
    }

    return {
      provider: 'custom',
      apiKey: String(apiConfig.apiKey),
      baseUrl: String(apiConfig.baseUrl).replace(/\/$/, ''),
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
  isSafeRemoteBaseUrl,
};
