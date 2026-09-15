# ai-philosophy-match

一个用于政治/哲学争议议题的双人远程立场匹配小工具。

## 功能

- 两位用户输入相同房间号，远程回答同一道问题
- 支持预设争议题，也支持自由编辑题目和备选项
- 支持“备选项 + 自由文本”回答
- 可选输入任意兼容 OpenAI Chat Completions 的 API（base URL / model / key）
- 自定义 API 地址要求为公网 HTTPS（避免 SSRF 风险）
- 不输入 API 时默认走 GitHub Models 配置
- 输出两位回答倾向相似度（模型优先，失败时回退关键词重合度）

## 运行

```bash
npm install
npm start
```

然后访问 `http://localhost:3000`。

## 默认 GitHub Models 配置

当用户不填写自定义 API 时，服务端使用以下环境变量（可选）：

- `GITHUB_TOKEN` 或 `GITHUB_MODELS_API_KEY`
- `GITHUB_MODELS_ENDPOINT`（默认 `https://models.inference.ai.azure.com`）
- `GITHUB_MODELS_MODEL`（默认 `gpt-4o-mini`）
