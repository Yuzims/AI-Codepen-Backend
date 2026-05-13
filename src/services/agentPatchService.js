const OpenAI = require('openai');
const { PATCH_SYSTEM_PROMPT, buildPatchUserMessage } = require('./agentPatchPromptService');

const getClient = () => new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY
});

const VALID_TARGETS = ['html', 'css', 'js'];

const FORBIDDEN_CODE_PATTERNS = [
    /\bimport\s+.*\s+from\s+['"`]/,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
    /<script[\s>]/i,
    /<link[\s>]/i,
];

const sanitizePatchCode = (after, target) => {
    if (target === 'html') {
        if (FORBIDDEN_CODE_PATTERNS.some(p => p.test(after))) {
            throw new Error(`生成的 HTML 代码包含禁止内容（script/link 标签或 import/require）`);
        }
    }
    if (target === 'js') {
        const importMatch = after.match(/\bimport\s+.*\s+from\s+['"`]/);
        const requireMatch = after.match(/\brequire\s*\(/);
        if (importMatch || requireMatch) {
            throw new Error(`生成的 JS 代码包含禁止的 import/require 语句`);
        }
    }
    return after;
};

const validateProposal = (proposal) => {
    if (!proposal || typeof proposal !== 'object') {
        throw new Error('模型返回结果不是有效对象');
    }

    if (typeof proposal.summary !== 'string' || !proposal.summary.trim()) {
        throw new Error('模型返回缺少 summary 字段');
    }

    if (!Array.isArray(proposal.operations) || proposal.operations.length === 0) {
        throw new Error('模型返回缺少 operations 字段');
    }

    if (proposal.operations.length > 3) {
        throw new Error('operations 数量超出限制（最多 3 条）');
    }

    const validatedOperations = proposal.operations.map((op, i) => {
        if (!op || typeof op !== 'object') {
            throw new Error(`operations[${i}] 不是有效对象`);
        }
        if (!VALID_TARGETS.includes(op.target)) {
            throw new Error(`operations[${i}].target 无效: ${op.target}`);
        }
        if (op.type !== 'replace_full') {
            throw new Error(`operations[${i}].type 必须为 replace_full`);
        }
        if (typeof op.after !== 'string') {
            throw new Error(`operations[${i}].after 必须为字符串`);
        }
        if (op.after.length > 30000) {
            throw new Error(`operations[${i}].after 超出长度限制（最大 30000 字符）`);
        }
        if (typeof op.reason !== 'string' || !op.reason.trim()) {
            throw new Error(`operations[${i}].reason 必须为非空字符串`);
        }

        sanitizePatchCode(op.after, op.target);

        return {
            target: op.target,
            type: 'replace_full',
            after: op.after,
            reason: op.reason.trim()
        };
    });

    const expectedOutcome = typeof proposal.expectedOutcome === 'string'
        ? proposal.expectedOutcome.trim()
        : '';

    const warnings = Array.isArray(proposal.warnings)
        ? proposal.warnings.filter(w => typeof w === 'string' && w.trim()).map(w => w.trim()).slice(0, 3)
        : [];

    const VALID_CSS_LANGUAGES = ['css', 'scss', 'less'];
    const VALID_JS_LANGUAGES = ['js', 'react', 'vue', 'ts'];

    let languages = null;
    if (proposal.languages && typeof proposal.languages === 'object') {
        const cssLang = VALID_CSS_LANGUAGES.includes(proposal.languages.cssLanguage)
            ? proposal.languages.cssLanguage : null;
        const jsLang = VALID_JS_LANGUAGES.includes(proposal.languages.jsLanguage)
            ? proposal.languages.jsLanguage : null;
        if (cssLang || jsLang) {
            languages = {};
            if (cssLang) languages.cssLanguage = cssLang;
            if (jsLang) languages.jsLanguage = jsLang;
        }
    }

    return {
        summary: proposal.summary.trim(),
        operations: validatedOperations,
        expectedOutcome,
        warnings,
        ...(languages ? { languages } : {})
    };
};

const parseProposalFromText = (text) => {
    const trimmed = text.trim();
    const startIndex = trimmed.indexOf('{');
    const endIndex = trimmed.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
        throw new Error('模型返回不包含有效 JSON');
    }

    const jsonStr = trimmed.slice(startIndex, endIndex + 1);

    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    } catch (e) {
        throw new Error('模型返回的 JSON 解析失败: ' + e.message);
    }

    return validateProposal(parsed);
};

const generatePatch = async (context) => {
    if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error('服务端未配置 DEEPSEEK_API_KEY');
    }

    const client = getClient();
    const userMessage = buildPatchUserMessage(context);

    const llmStart = Date.now();
    const response = await client.chat.completions.create({
        model: 'deepseek-chat',
        max_tokens: 8192,
        temperature: 0.2,
        messages: [
            { role: 'system', content: PATCH_SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
        ]
    });
    const llmDuration = Date.now() - llmStart;

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('模型未返回文本内容');
    }

    const usage = response.usage;
    console.log('[AgentPatchService] LLM call completed', {
        duration: `${llmDuration}ms`,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        responseLength: content.length
    });

    const proposal = parseProposalFromText(content);

    console.log('[AgentPatchService] Proposal validated', {
        operationsCount: proposal.operations.length,
        targets: proposal.operations.map(op => op.target),
        warningsCount: proposal.warnings.length
    });

    return proposal;
};

module.exports = {
    generatePatch,
    validateProposal,
    parseProposalFromText
};
