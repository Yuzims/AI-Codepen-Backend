const express = require('express');
const OpenAI = require('openai');
const auth = require('../middleware/auth');

const router = express.Router();

const getClient = () => new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY
});

const GENERATE_SYSTEM_PROMPT = `你是一个前端代码生成助手。根据用户描述，生成可运行的 HTML/CSS/JS 代码。

严格按照以下 JSON 格式返回，不要有任何其他文字：
{
  "title": "Pen 标题（简短）",
  "html": "HTML 代码",
  "css": "CSS 代码",
  "cssLanguage": "css | scss | less",
  "js": "JS 代码",
  "jsLanguage": "js | react | vue | ts"
}

编辑器编译及依赖注入机制（重要）：
- 编辑器的编译环境（Babel、TypeScript、SCSS/Less 编译器）已内置
- 当 jsLanguage 为 react 时：编辑器自动在 iframe 中注入 React 18、ReactDOM、Babel
- 当 jsLanguage 为 vue 时：编辑器自动在 iframe 中注入 Vue 3
- 当 jsLanguage 为 ts 时：编辑器自动在 iframe 中注入 TypeScript 编译器、React、ReactDOM
- 当 cssLanguage 为 scss/less 时：编辑器自动编译为 CSS
- 因此，生成的代码中这些库作为全局对象可用，禁止使用 import/require 语句，禁止在 HTML 中添加 CDN script 标签

各语言的标准代码模板（必须严格遵循）：

React 模板：
\`\`\`
// HTML: <div id="app"></div>
// JS (jsLanguage: "react"):
const { useState, useEffect, useRef, useCallback } = React;

function App() {
  const [count, setCount] = useState(0);
  return <div onClick={() => setCount(c => c + 1)}>{count}</div>;
}

const root = ReactDOM.createRoot(document.getElementById("app"));
window.reactRoot = root;
root.render(<App />);
\`\`\`

Vue 模板（Composition API）：
\`\`\`
// HTML: <div id="app"></div>
// JS (jsLanguage: "vue"):
const { createApp, ref, computed, onMounted } = Vue;

const App = {
  setup() {
    const count = ref(0);
    return { count };
  },
  template: \\\`<div @click="count++">{{ count }}</div>\\\`
};

const app = createApp(App);
window.vueApp = app;
app.mount("#app");
\`\`\`

关键规则：
- HTML 中必须有 <div id="app"></div> 作为挂载点
- React 代码必须设置 window.reactRoot = root（用于编辑器清理和热更新）
- Vue 代码必须设置 window.vueApp = app（用于编辑器清理和热更新）
- HTML 只写页面结构，不需要 <!DOCTYPE>、<html>、<head>、<body> 标签
- HTML 中禁止包含 <script>、<link> 标签
- CSS 直接写样式规则
- 如果用户未指定语言/框架，默认使用原生 JS（jsLanguage: "js"）
- 如果用户要求 SCSS/Sass 或 Less，在 css 字段写相应语法，返回相应的 cssLanguage
- 代码要完整可运行，视觉效果要美观`;

const writeSse = (res, payload) => {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    res.write(`data: ${data}\n\n`);
};

router.post('/generate', auth, async (req, res) => {
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

    if (!prompt) {
        return res.status(400).json({ message: '请输入生成描述' });
    }

    if (!process.env.DEEPSEEK_API_KEY) {
        return res.status(500).json({ message: '服务端未配置 DEEPSEEK_API_KEY' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const client = getClient();
    let clientDisconnected = false;

    const handleDisconnect = () => {
        clientDisconnected = true;
    };
    res.on('close', handleDisconnect);

    try {
        const stream = await client.chat.completions.create({
            model: 'deepseek-chat',
            max_tokens: 4096,
            stream: true,
            messages: [
                { role: 'system', content: GENERATE_SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ]
        });

        for await (const chunk of stream) {
            if (clientDisconnected || res.writableEnded) break;

            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
                writeSse(res, { delta });
            }
        }

        if (!res.writableEnded) {
            writeSse(res, '[DONE]');
            res.end();
        }
    } catch (error) {
        if (clientDisconnected) return;

        console.error('AI generate error:', error);
        if (!res.writableEnded) {
            writeSse(res, {
                error: error instanceof Error ? error.message : 'AI 生成失败'
            });
            res.end();
        }
    } finally {
        res.off('close', handleDisconnect);
    }
});

module.exports = router;
