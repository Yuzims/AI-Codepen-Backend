const { executeToolCall, AGENT_TOOLS, ALLOWED_TOOLS, TERMINAL_TOOL } = require('../services/agentTools');

describe('agentTools', () => {
    const mockContext = {
        html: '<div>hello</div>',
        css: 'body { color: red; }',
        js: 'console.log("hi")',
        title: 'Test Pen',
        cssLanguage: 'css',
        jsLanguage: 'js',
        selection: { target: 'js', from: 0, to: 5, text: 'conso' },
        errors: [{ target: 'js', severity: 'error', message: 'Unexpected token', line: 1 }]
    };

    test('AGENT_TOOLS 包含 5 个工具定义', () => {
        expect(AGENT_TOOLS).toHaveLength(5);
    });

    test('TERMINAL_TOOL 为 propose_patch', () => {
        expect(TERMINAL_TOOL).toBe('propose_patch');
    });

    test('ALLOWED_TOOLS 包含所有工具名', () => {
        expect(ALLOWED_TOOLS).toEqual([
            'get_current_pen', 'get_pen_errors', 'get_user_selection', 'get_pen_languages', 'propose_patch'
        ]);
    });

    test('get_current_pen 返回完整代码内容', () => {
        const result = executeToolCall('get_current_pen', {}, mockContext);
        expect(result).toEqual({
            html: '<div>hello</div>',
            css: 'body { color: red; }',
            js: 'console.log("hi")',
            title: 'Test Pen'
        });
    });

    test('get_pen_errors 返回错误列表', () => {
        const result = executeToolCall('get_pen_errors', {}, mockContext);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toBe('Unexpected token');
    });

    test('get_pen_errors 无错误时返回空数组', () => {
        const ctx = { ...mockContext, errors: [] };
        const result = executeToolCall('get_pen_errors', {}, ctx);
        expect(result.errors).toEqual([]);
        expect(result.message).toBe('当前无错误');
    });

    test('get_user_selection 返回选区信息', () => {
        const result = executeToolCall('get_user_selection', {}, mockContext);
        expect(result.selection).toEqual({ target: 'js', from: 0, to: 5, text: 'conso' });
    });

    test('get_user_selection 无选区时返回 null', () => {
        const ctx = { ...mockContext, selection: null };
        const result = executeToolCall('get_user_selection', {}, ctx);
        expect(result.selection).toBeNull();
        expect(result.message).toBe('用户未选中任何内容');
    });

    test('get_pen_languages 返回语言配置', () => {
        const result = executeToolCall('get_pen_languages', {}, mockContext);
        expect(result).toEqual({ cssLanguage: 'css', jsLanguage: 'js' });
    });

    test('propose_patch 返回 accepted: true', () => {
        const result = executeToolCall('propose_patch', {}, mockContext);
        expect(result).toEqual({ accepted: true });
    });

    test('未知工具名抛出错误', () => {
        expect(() => executeToolCall('unknown_tool', {}, mockContext)).toThrow('Unknown tool: unknown_tool');
    });
});
