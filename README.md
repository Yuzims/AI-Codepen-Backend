# AI-Codepen-Backend

AI 代码编辑器后端服务，提供基础健康检查和代码生成功能。

## 快速开始

```bash
npm install
npm start
```

服务默认启动在 `http://127.0.0.1:3000`。

## API

### `GET /health`
返回服务健康状态：

```json
{"status":"ok"}
```

### `POST /api/generate`
### `POST /api/code/generate`
请求体：

```json
{
  "prompt": "根据需求生成代码",
  "language": "javascript",
  "model": "gpt-4o-mini"
}
```

当未配置 `OPENAI_API_KEY` 时，接口会返回 mock 代码，便于本地联调。

## 环境变量

- `PORT`：服务端口（默认 `3000`）
- `OPENAI_API_KEY`：OpenAI API Key（可选）
- `OPENAI_BASE_URL`：OpenAI 兼容接口地址（默认 `https://api.openai.com/v1`）
- `OPENAI_MODEL`：默认模型名（默认 `gpt-4o-mini`）
