const { validateToolCall, validatePatchProposal, validateRunRequest, isTimedOut, GUARDRAILS } = require('../services/agentGuardrails');

describe('agentGuardrails', () => {
    describe('validateToolCall', () => {
        test('白名单内工具允许调用', () => {
            const result = validateToolCall('get_current_pen', 0);
            expect(result).toEqual({ allowed: true });
        });

        test('白名单外工具拒绝调用', () => {
            const result = validateToolCall('shell_exec', 0);
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('不在允许列表中');
        });

        test('超过最大步数拒绝调用', () => {
            const result = validateToolCall('get_current_pen', 6);
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('最大步数');
        });
    });

    describe('validatePatchProposal', () => {
        const validProposal = {
            summary: '添加标题',
            operations: [
                { target: 'html', type: 'replace_full', after: '<h1>Hello</h1>', reason: '添加标题' }
            ],
            expectedOutcome: '页面显示标题',
            warnings: []
        };

        test('合法 proposal 通过校验', () => {
            const result = validatePatchProposal(validProposal);
            expect(result).toEqual({ valid: true });
        });

        test('operations 超过 3 条拒绝', () => {
            const proposal = {
                ...validProposal,
                operations: [
                    { target: 'html', type: 'replace_full', after: 'a', reason: 'r' },
                    { target: 'css', type: 'replace_full', after: 'b', reason: 'r' },
                    { target: 'js', type: 'replace_full', after: 'c', reason: 'r' },
                    { target: 'html', type: 'replace_full', after: 'd', reason: 'r' },
                ]
            };
            const result = validatePatchProposal(proposal);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('超出限制');
        });

        test('after 超过 30000 字符拒绝', () => {
            const proposal = {
                ...validProposal,
                operations: [
                    { target: 'html', type: 'replace_full', after: 'x'.repeat(30001), reason: 'r' }
                ]
            };
            const result = validatePatchProposal(proposal);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('超出长度限制');
        });

        test('非法 target 拒绝', () => {
            const proposal = {
                ...validProposal,
                operations: [
                    { target: 'python', type: 'replace_full', after: 'code', reason: 'r' }
                ]
            };
            const result = validatePatchProposal(proposal);
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('target 无效');
        });
    });

    describe('validateRunRequest', () => {
        const validBody = {
            userInstruction: '添加一个按钮',
            html: '<div></div>',
            css: 'body {}',
            js: 'console.log(1)'
        };

        test('合法请求通过校验', () => {
            const result = validateRunRequest(validBody);
            expect(result).toEqual({ valid: true });
        });

        test('userInstruction 为空拒绝', () => {
            const result = validateRunRequest({ ...validBody, userInstruction: '  ' });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('不能为空');
        });

        test('userInstruction 超过 1000 字符拒绝', () => {
            const result = validateRunRequest({ ...validBody, userInstruction: 'a'.repeat(1001) });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('超出长度限制');
        });

        test('总代码长度超过 50000 拒绝', () => {
            const result = validateRunRequest({ ...validBody, html: 'x'.repeat(50001) });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('代码总长度超出限制');
        });

        test('html/css/js 非字符串拒绝', () => {
            const result = validateRunRequest({ ...validBody, html: 123 });
            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('必须为字符串');
        });
    });

    describe('isTimedOut', () => {
        test('未超时返回 false', () => {
            expect(isTimedOut(Date.now())).toBe(false);
        });

        test('超时返回 true', () => {
            const pastTime = Date.now() - GUARDRAILS.MAX_DURATION_MS - 1000;
            expect(isTimedOut(pastTime)).toBe(true);
        });
    });
});
