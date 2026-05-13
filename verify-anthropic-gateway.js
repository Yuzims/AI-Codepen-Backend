require('dotenv').config();

const AnthropicModule = require('@anthropic-ai/sdk');

const Anthropic = AnthropicModule.default || AnthropicModule.Anthropic || AnthropicModule;
const baseURL = process.env.ANTHROPIC_BASE_URL || undefined;
const apiKey = process.env.ANTHROPIC_API_KEY || undefined;
const authToken = process.env.ANTHROPIC_AUTH_TOKEN || undefined;
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const prompt = process.argv.slice(2).join(' ').trim() || '请只返回 OK';
const disableCacheControl = process.env.ANTHROPIC_DISABLE_CACHE_CONTROL === '1';

if (!apiKey && !authToken) {
  console.error('缺少凭证：请设置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN');
  console.error('示例：');
  console.error('  ANTHROPIC_BASE_URL="https://www.yuesecoding.top" ANTHROPIC_AUTH_TOKEN="sk-xxx" npm run verify:gateway');
  console.error('  ANTHROPIC_API_KEY="sk-ant-xxx" npm run verify:gateway -- "请只返回 OK"');
  process.exit(1);
}

const clientOptions = {};

if (baseURL) {
  clientOptions.baseURL = baseURL;
}

if (authToken) {
  clientOptions.authToken = authToken;
} else {
  clientOptions.apiKey = apiKey;
}

const client = new Anthropic(clientOptions);
const systemPrompt = 'You are a compatibility probe. Reply with plain text OK only.';
const system = disableCacheControl
  ? systemPrompt
  : [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral', ttl: '5m' },
      },
    ];

const printProbeInfo = () => {
  console.log('[probe] baseURL:', client.baseURL);
  console.log('[probe] auth:', authToken ? 'ANTHROPIC_AUTH_TOKEN (Bearer)' : 'ANTHROPIC_API_KEY (X-Api-Key)');
  console.log('[probe] model:', model);
  console.log('[probe] cache_control:', disableCacheControl ? 'disabled' : 'enabled');
  console.log('[probe] prompt:', prompt);
  console.log('[probe] starting stream...');
};

const printError = (error) => {
  console.error('\n[probe] failed');
  console.error('[probe] name:', error?.name || 'UnknownError');
  console.error('[probe] message:', error?.message || String(error));

  if (typeof error?.status === 'number') {
    console.error('[probe] status:', error.status);
  }

  if (error?.error) {
    console.error('[probe] api error:', JSON.stringify(error.error, null, 2));
  }

  if (error?.headers?.get) {
    const requestId = error.headers.get('request-id') || error.headers.get('x-request-id');
    if (requestId) {
      console.error('[probe] request id:', requestId);
    }
  }

  if (error?.status === 404) {
    console.error('[hint] 这个中转很可能不支持 Anthropic 的 /v1/messages 路径，或 baseURL 配错了。');
  } else if (error?.status === 401 || error?.status === 403) {
    console.error('[hint] 凭证无效，或中转要求的认证方式与你当前使用的 authToken/apiKey 不一致。');
  } else if (error?.message && /cache_control/i.test(error.message)) {
    console.error('[hint] 这个中转可能不支持 prompt caching；可先设置 ANTHROPIC_DISABLE_CACHE_CONTROL=1 再试一次。');
  } else {
    console.error('[hint] 如果这是流式解析错误，通常表示该服务不兼容 Anthropic SDK 的 messages.stream() / SSE。');
  }
};

(async () => {
  printProbeInfo();

  const stream = client.messages.stream({
    model,
    max_tokens: 128,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  let chunkCount = 0;
  let combinedText = '';

  stream.on('text', (text) => {
    chunkCount += 1;
    combinedText += text;
    process.stdout.write(text);
  });

  const finalMessage = await stream.finalMessage();

  console.log('\n\n[probe] success');
  console.log('[probe] text chunks:', chunkCount);
  console.log('[probe] final text length:', combinedText.length);
  console.log('[probe] stop reason:', finalMessage.stop_reason || 'unknown');
  console.log('[probe] usage:', JSON.stringify(finalMessage.usage || {}, null, 2));
})().catch((error) => {
  printError(error);
  process.exit(1);
});
