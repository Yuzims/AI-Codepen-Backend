import http from 'node:http';

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const MAX_PROMPT_LENGTH = 8000;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(body);
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

function sanitizePromptWhitespace(prompt) {
  return prompt.replace(/[\r\n]+/g, ' ').trim();
}

function buildFallbackCode(prompt, language = 'javascript') {
  return `// AI response placeholder (${language})\n// Prompt: ${sanitizePromptWhitespace(prompt)}`;
}

async function generateCode(prompt, language, model) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      code: buildFallbackCode(prompt, language),
      provider: 'mock'
    };
  }

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model ?? DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an AI coding assistant. Return code only when possible.'
        },
        {
          role: 'user',
          content: `Language: ${language ?? 'javascript'}\n\nTask:\n${prompt}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw createHttpError('AI provider request failed', 502);
  }

  const data = await response.json();
  const code = data?.choices?.[0]?.message?.content?.trim();

  if (!code) {
    throw createHttpError('AI provider returned an empty response', 502);
  }

  return {
    code,
    provider: 'openai'
  };
}

export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'POST' && (req.url === '/api/generate' || req.url === '/api/code/generate')) {
      try {
        const body = await readJsonBody(req);
        const prompt = body?.prompt?.trim();
        const language = body?.language?.trim() || 'javascript';
        const model = body?.model?.trim();

        if (!prompt) {
          sendJson(res, 400, { error: 'Field "prompt" is required.' });
          return;
        }

        if (prompt.length > MAX_PROMPT_LENGTH) {
          sendJson(res, 400, { error: 'Field "prompt" is too long.' });
          return;
        }

        const result = await generateCode(prompt, language, model);
        sendJson(res, 200, result);
      } catch (error) {
        if (error instanceof SyntaxError) {
          sendJson(res, 400, { error: 'Invalid JSON request body.' });
          return;
        }

        const statusCode = Number(error?.statusCode) || 500;
        const errorMessage = statusCode === 502 ? 'Failed to generate code from AI provider.' : 'Internal server error';
        sendJson(res, statusCode, { error: errorMessage });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`AI Codepen backend listening on port ${port}`);
  });
}
