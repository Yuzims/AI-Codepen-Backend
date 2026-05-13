const AGENT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'get_current_pen',
            description: '获取当前 Pen 的完整代码内容（html/css/js）',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_pen_errors',
            description: '获取当前 Pen 的 lint 和运行时错误列表',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_user_selection',
            description: '获取用户在编辑器中的当前选区文本和位置',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_pen_languages',
            description: '获取当前 Pen 的语言配置（cssLanguage/jsLanguage）',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    {
        type: 'function',
        function: {
            name: 'propose_patch',
            description: '提交结构化代码修改提案，调用此工具后 Agent 循环终止',
            parameters: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: '改动摘要' },
                    operations: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                target: { type: 'string', enum: ['html', 'css', 'js'] },
                                type: { type: 'string', enum: ['replace_full'] },
                                after: { type: 'string', description: '替换后的完整内容' },
                                reason: { type: 'string', description: '修改原因' }
                            },
                            required: ['target', 'type', 'after', 'reason']
                        }
                    },
                    expectedOutcome: { type: 'string' },
                    warnings: { type: 'array', items: { type: 'string' } }
                },
                required: ['summary', 'operations', 'expectedOutcome', 'warnings']
            }
        }
    }
];

const ALLOWED_TOOLS = ['get_current_pen', 'get_pen_errors', 'get_user_selection', 'get_pen_languages', 'propose_patch'];
const TERMINAL_TOOL = 'propose_patch';

function executeToolCall(toolName, args, context) {
    if (!ALLOWED_TOOLS.includes(toolName)) {
        throw new Error(`Unknown tool: ${toolName}`);
    }

    switch (toolName) {
        case 'get_current_pen':
            return {
                html: context.html || '',
                css: context.css || '',
                js: context.js || '',
                title: context.title || ''
            };

        case 'get_pen_errors':
            if (context.errors && context.errors.length > 0) {
                return { errors: context.errors };
            }
            return { errors: [], message: '当前无错误' };

        case 'get_user_selection':
            if (context.selection && context.selection.target) {
                return { selection: context.selection };
            }
            return { selection: null, message: '用户未选中任何内容' };

        case 'get_pen_languages':
            return {
                cssLanguage: context.cssLanguage || 'css',
                jsLanguage: context.jsLanguage || 'js'
            };

        case 'propose_patch':
            return { accepted: true };

        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}

module.exports = {
    AGENT_TOOLS,
    ALLOWED_TOOLS,
    TERMINAL_TOOL,
    executeToolCall
};
