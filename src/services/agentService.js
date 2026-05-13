const OpenAI = require('openai');
const { SYSTEM_PROMPT, buildUserMessage } = require('./agentPromptService');

const getClient = () => new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY
});

const VALID_TARGETS = ['html', 'css', 'js'];

const FORBIDDEN_STEP_PATTERNS = [
    /引入\s*CDN/i,
    /加载\s*CDN/i,
    /通过\s*CDN/i,
    /添加\s*script/i,
    /添加\s*link\s*标签/i,
    /import\s+.*\s+from/i,
    /require\s*\(/i,
    /npm\s+install/i,
    /安装依赖/,
];

const sanitizeSteps = (steps) => {
    return steps.filter(step => {
        return !FORBIDDEN_STEP_PATTERNS.some(pattern => pattern.test(step));
    });
};

const validatePlan = (plan) => {
    if (!plan || typeof plan !== 'object') {
        throw new Error('模型返回结果不是有效对象');
    }

    if (typeof plan.summary !== 'string' || !plan.summary.trim()) {
        throw new Error('模型返回缺少 summary 字段');
    }
    if (typeof plan.goal !== 'string' || !plan.goal.trim()) {
        throw new Error('模型返回缺少 goal 字段');
    }
    if (!Array.isArray(plan.targets) || plan.targets.length === 0) {
        throw new Error('模型返回缺少 targets 字段');
    }

    const invalidTargets = plan.targets.filter(t => !VALID_TARGETS.includes(t));
    if (invalidTargets.length > 0) {
        throw new Error(`targets 包含非法值: ${invalidTargets.join(', ')}`);
    }

    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error('模型返回缺少 steps 字段');
    }
    if (!Array.isArray(plan.risks)) {
        throw new Error('模型返回缺少 risks 字段');
    }

    return {
        summary: plan.summary.trim(),
        goal: plan.goal.trim(),
        targets: [...new Set(plan.targets)],
        steps: sanitizeSteps(plan.steps.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim())),
        risks: plan.risks.filter(r => typeof r === 'string' && r.trim()).map(r => r.trim())
    };
};

const parsePlanFromText = (text) => {
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

    return validatePlan(parsed);
};

const generatePlan = async (context) => {
    if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error('服务端未配置 DEEPSEEK_API_KEY');
    }

    const client = getClient();
    const userMessage = buildUserMessage(context);

    const llmStart = Date.now();
    const response = await client.chat.completions.create({
        model: 'deepseek-chat',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
        ]
    });
    const llmDuration = Date.now() - llmStart;

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('模型未返回文本内容');
    }

    const usage = response.usage;
    console.log('[AgentService] LLM call completed', {
        duration: `${llmDuration}ms`,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        responseLength: content.length
    });

    return parsePlanFromText(content);
};

module.exports = {
    generatePlan,
    validatePlan,
    parsePlanFromText
};
