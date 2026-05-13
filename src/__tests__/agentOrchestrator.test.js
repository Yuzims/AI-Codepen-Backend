const { runAgent } = require('../services/agentOrchestrator');
const { GUARDRAILS } = require('../services/agentGuardrails');

// Mock fetch globally
const originalFetch = global.fetch;

function mockFetchResponses(...responses) {
    let callIndex = 0;
    global.fetch = jest.fn(async () => {
        const resp = responses[callIndex] || responses[responses.length - 1];
        callIndex++;
        return {
            ok: true,
            json: async () => resp,
            text: async () => JSON.stringify(resp)
        };
    });
}

function mockFetchError(status, body) {
    global.fetch = jest.fn(async () => ({
        ok: false,
        status,
        text: async () => JSON.stringify(body)
    }));
}

beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
});

afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.DEEPSEEK_API_KEY;
});

const baseContext = {
    penId: 'pen-123',
    title: 'Test Pen',
    html: '<div id="app"></div>',
    css: 'body { margin: 0; }',
    js: 'console.log("hello")',
    cssLanguage: 'css',
    jsLanguage: 'js',
    selection: null,
    errors: [],
    userInstruction: '给页面添加一个标题'
};

describe('agentOrchestrator', () => {
    describe('正常流程', () => {
        test('Agent 读取代码后直接提交 patch — 两步完成', async () => {
            mockFetchResponses(
                // 第一次 LLM 调用：Agent 决定先读取代码
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'get_current_pen',
                                    arguments: '{}'
                                }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 500, completion_tokens: 50 }
                },
                // 第二次 LLM 调用：Agent 提交 patch
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_2',
                                type: 'function',
                                function: {
                                    name: 'propose_patch',
                                    arguments: JSON.stringify({
                                        summary: '添加居中标题',
                                        operations: [{
                                            target: 'html',
                                            type: 'replace_full',
                                            after: '<div id="app"><h1>Hello World</h1></div>',
                                            reason: '用户要求添加标题'
                                        }],
                                        expectedOutcome: '页面显示居中标题',
                                        warnings: []
                                    })
                                }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 800, completion_tokens: 200 }
                }
            );

            const result = await runAgent(baseContext, 'test-trace-1');

            expect(result.status).toBe('completed');
            expect(result.steps).toHaveLength(2);
            expect(result.steps[0].tool).toBe('get_current_pen');
            expect(result.steps[1].tool).toBe('propose_patch');
            expect(result.proposal).not.toBeNull();
            expect(result.proposal.summary).toBe('添加居中标题');
            expect(result.proposal.operations).toHaveLength(1);
            expect(result.proposal.operations[0].target).toBe('html');
            expect(result.proposal.operations[0].after).toContain('<h1>Hello World</h1>');
        });

        test('Agent 多步工具调用：读代码 → 读错误 → 读语言 → 提交 patch', async () => {
            mockFetchResponses(
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'get_current_pen', arguments: '{}' }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 500, completion_tokens: 30 }
                },
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_2',
                                type: 'function',
                                function: { name: 'get_pen_errors', arguments: '{}' }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 700, completion_tokens: 30 }
                },
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_3',
                                type: 'function',
                                function: { name: 'get_pen_languages', arguments: '{}' }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 900, completion_tokens: 30 }
                },
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_4',
                                type: 'function',
                                function: {
                                    name: 'propose_patch',
                                    arguments: JSON.stringify({
                                        summary: '修复错误并添加功能',
                                        operations: [
                                            { target: 'html', type: 'replace_full', after: '<div>fixed</div>', reason: '修复结构' },
                                            { target: 'js', type: 'replace_full', after: 'console.log("fixed")', reason: '修复逻辑' }
                                        ],
                                        expectedOutcome: '错误消失',
                                        warnings: ['注意测试']
                                    })
                                }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 1100, completion_tokens: 300 }
                }
            );

            const contextWithErrors = {
                ...baseContext,
                errors: [{ target: 'js', severity: 'error', message: 'Unexpected token', line: 1 }]
            };

            const result = await runAgent(contextWithErrors, 'test-trace-2');

            expect(result.status).toBe('completed');
            expect(result.steps).toHaveLength(4);
            expect(result.steps.map(s => s.tool)).toEqual([
                'get_current_pen', 'get_pen_errors', 'get_pen_languages', 'propose_patch'
            ]);
            expect(result.proposal.operations).toHaveLength(2);
            expect(result.proposal.warnings).toEqual(['注意测试']);
        });

        test('Agent 返回纯文本（无 tool_calls）— 视为无需修改', async () => {
            mockFetchResponses({
                choices: [{
                    message: {
                        role: 'assistant',
                        content: '当前代码已经很好了，不需要修改。'
                    }
                }],
                usage: { prompt_tokens: 500, completion_tokens: 20 }
            });

            const result = await runAgent(baseContext, 'test-trace-3');

            expect(result.status).toBe('completed');
            expect(result.proposal).toBeNull();
            expect(result.steps).toHaveLength(0);
        });
    });

    describe('安全边界', () => {
        test('超过最大步数时返回 max_steps_reached', async () => {
            // 模拟 Agent 一直调用只读工具不提交 patch
            const readResponse = {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call_x',
                            type: 'function',
                            function: { name: 'get_current_pen', arguments: '{}' }
                        }]
                    }
                }],
                usage: { prompt_tokens: 500, completion_tokens: 30 }
            };

            // 提供足够多的响应让循环跑满
            mockFetchResponses(readResponse, readResponse, readResponse, readResponse, readResponse, readResponse, readResponse);

            const result = await runAgent(baseContext, 'test-trace-4');

            // 因为同一工具调用超过 2 次会被强制终止
            expect(result.status).toBe('max_steps_reached');
            expect(result.proposal).toBeNull();
        });

        test('非法工具调用被拒绝但循环继续', async () => {
            mockFetchResponses(
                // Agent 尝试调用非法工具
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_bad',
                                type: 'function',
                                function: { name: 'shell_exec', arguments: '{"cmd":"rm -rf /"}' }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 500, completion_tokens: 30 }
                },
                // Agent 改为正常调用
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_ok',
                                type: 'function',
                                function: {
                                    name: 'propose_patch',
                                    arguments: JSON.stringify({
                                        summary: '添加标题',
                                        operations: [{ target: 'html', type: 'replace_full', after: '<h1>Hi</h1>', reason: 'add' }],
                                        expectedOutcome: 'ok',
                                        warnings: []
                                    })
                                }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 700, completion_tokens: 100 }
                }
            );

            const result = await runAgent(baseContext, 'test-trace-5');

            expect(result.status).toBe('completed');
            // 第一步是被拒绝的工具调用
            expect(result.steps[0].tool).toBe('shell_exec');
            expect(result.steps[0].output).toContain('拒绝');
            // 第二步是正常的 propose_patch
            expect(result.steps[1].tool).toBe('propose_patch');
            expect(result.proposal).not.toBeNull();
        });

        test('propose_patch 校验失败 — operations 超限', async () => {
            mockFetchResponses({
                choices: [{
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'propose_patch',
                                arguments: JSON.stringify({
                                    summary: '大改动',
                                    operations: [
                                        { target: 'html', type: 'replace_full', after: 'a', reason: 'r' },
                                        { target: 'css', type: 'replace_full', after: 'b', reason: 'r' },
                                        { target: 'js', type: 'replace_full', after: 'c', reason: 'r' },
                                        { target: 'html', type: 'replace_full', after: 'd', reason: 'r' }
                                    ],
                                    expectedOutcome: 'ok',
                                    warnings: []
                                })
                            }
                        }]
                    }
                }],
                usage: { prompt_tokens: 500, completion_tokens: 200 }
            });

            const result = await runAgent(baseContext, 'test-trace-6');

            expect(result.status).toBe('error');
            expect(result.error).toContain('校验失败');
            expect(result.proposal).toBeNull();
        });

        test('propose_patch 校验失败 — after 超长', async () => {
            mockFetchResponses({
                choices: [{
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'propose_patch',
                                arguments: JSON.stringify({
                                    summary: '超长内容',
                                    operations: [{
                                        target: 'html',
                                        type: 'replace_full',
                                        after: 'x'.repeat(30001),
                                        reason: '太长了'
                                    }],
                                    expectedOutcome: 'ok',
                                    warnings: []
                                })
                            }
                        }]
                    }
                }],
                usage: { prompt_tokens: 500, completion_tokens: 200 }
            });

            const result = await runAgent(baseContext, 'test-trace-7');

            expect(result.status).toBe('error');
            expect(result.error).toContain('超出长度限制');
        });

        test('同一只读工具连续调用超过 2 次被强制终止', async () => {
            const sameToolResponse = {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call_repeat',
                            type: 'function',
                            function: { name: 'get_pen_errors', arguments: '{}' }
                        }]
                    }
                }],
                usage: { prompt_tokens: 500, completion_tokens: 30 }
            };

            mockFetchResponses(sameToolResponse, sameToolResponse, sameToolResponse);

            const result = await runAgent(baseContext, 'test-trace-8');

            expect(result.status).toBe('max_steps_reached');
            expect(result.error).toContain('get_pen_errors');
            expect(result.steps.length).toBeLessThanOrEqual(3);
        });
    });

    describe('错误处理', () => {
        test('DEEPSEEK_API_KEY 未配置时抛出错误', async () => {
            delete process.env.DEEPSEEK_API_KEY;

            await expect(runAgent(baseContext, 'test-trace-9'))
                .rejects.toThrow('服务端未配置 DEEPSEEK_API_KEY');
        });

        test('LLM API 返回非 200 时返回 error', async () => {
            mockFetchError(500, { error: 'Internal Server Error' });

            const result = await runAgent(baseContext, 'test-trace-10');

            expect(result.status).toBe('error');
            expect(result.error).toContain('DeepSeek API error');
        });

        test('LLM 返回无效 JSON arguments 时优雅处理', async () => {
            mockFetchResponses(
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_bad_json',
                                type: 'function',
                                function: {
                                    name: 'get_current_pen',
                                    arguments: '{invalid json!!!'
                                }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 500, completion_tokens: 30 }
                },
                // Agent 恢复正常
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: '我无法完成这个任务。'
                        }
                    }],
                    usage: { prompt_tokens: 700, completion_tokens: 20 }
                }
            );

            const result = await runAgent(baseContext, 'test-trace-11');

            expect(result.status).toBe('completed');
            expect(result.steps[0].output).toContain('参数解析失败');
            expect(result.proposal).toBeNull();
        });

        test('LLM 返回空 choices 时返回 error', async () => {
            mockFetchResponses({
                choices: [],
                usage: { prompt_tokens: 500, completion_tokens: 0 }
            });

            const result = await runAgent(baseContext, 'test-trace-12');

            expect(result.status).toBe('error');
            expect(result.error).toContain('格式异常');
        });

        test('超时时优雅终止', async () => {
            // Mock Date.now 来模拟超时
            const realDateNow = Date.now;
            let callCount = 0;
            Date.now = jest.fn(() => {
                callCount++;
                // 第一次调用正常，后续调用模拟已超时
                if (callCount <= 2) return 1000;
                return 1000 + GUARDRAILS.MAX_DURATION_MS + 1000;
            });

            mockFetchResponses({
                choices: [{
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call_1',
                            type: 'function',
                            function: { name: 'get_current_pen', arguments: '{}' }
                        }]
                    }
                }],
                usage: { prompt_tokens: 500, completion_tokens: 30 }
            });

            const result = await runAgent(baseContext, 'test-trace-13');

            expect(result.status).toBe('error');
            expect(result.error).toContain('超时');

            Date.now = realDateNow;
        });
    });

    describe('工具执行正确性', () => {
        test('get_user_selection 正确传递选区信息给 LLM', async () => {
            const contextWithSelection = {
                ...baseContext,
                selection: { target: 'js', from: 0, to: 7, text: 'console' }
            };

            mockFetchResponses(
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_sel',
                                type: 'function',
                                function: { name: 'get_user_selection', arguments: '{}' }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 500, completion_tokens: 30 }
                },
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: '选区内容已读取，无需修改。'
                        }
                    }],
                    usage: { prompt_tokens: 700, completion_tokens: 20 }
                }
            );

            const result = await runAgent(contextWithSelection, 'test-trace-14');

            expect(result.steps[0].tool).toBe('get_user_selection');
            expect(result.steps[0].output).toContain('console');
        });

        test('多个 tool_calls 在同一响应中按顺序执行', async () => {
            mockFetchResponses(
                // Agent 一次返回多个工具调用
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [
                                {
                                    id: 'call_a',
                                    type: 'function',
                                    function: { name: 'get_current_pen', arguments: '{}' }
                                },
                                {
                                    id: 'call_b',
                                    type: 'function',
                                    function: { name: 'get_pen_languages', arguments: '{}' }
                                }
                            ]
                        }
                    }],
                    usage: { prompt_tokens: 500, completion_tokens: 50 }
                },
                {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [{
                                id: 'call_c',
                                type: 'function',
                                function: {
                                    name: 'propose_patch',
                                    arguments: JSON.stringify({
                                        summary: '完成',
                                        operations: [{ target: 'js', type: 'replace_full', after: 'done()', reason: 'done' }],
                                        expectedOutcome: 'ok',
                                        warnings: []
                                    })
                                }
                            }]
                        }
                    }],
                    usage: { prompt_tokens: 900, completion_tokens: 150 }
                }
            );

            const result = await runAgent(baseContext, 'test-trace-15');

            expect(result.status).toBe('completed');
            // 两个工具在同一步中执行
            expect(result.steps.filter(s => s.tool === 'get_current_pen')).toHaveLength(1);
            expect(result.steps.filter(s => s.tool === 'get_pen_languages')).toHaveLength(1);
            expect(result.proposal).not.toBeNull();
        });

        test('propose_patch 的 arguments 为空对象时校验失败', async () => {
            mockFetchResponses({
                choices: [{
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call_empty',
                            type: 'function',
                            function: {
                                name: 'propose_patch',
                                arguments: '{}'
                            }
                        }]
                    }
                }],
                usage: { prompt_tokens: 500, completion_tokens: 50 }
            });

            const result = await runAgent(baseContext, 'test-trace-16');

            expect(result.status).toBe('error');
            expect(result.error).toContain('校验失败');
        });
    });

    describe('消息历史构建', () => {
        test('工具结果正确追加到 messages 中传给下一次 LLM 调用', async () => {
            let capturedBodies = [];
            let callIndex = 0;

            global.fetch = jest.fn(async (url, opts) => {
                capturedBodies.push(JSON.parse(opts.body));
                const responses = [
                    {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: null,
                                tool_calls: [{
                                    id: 'call_1',
                                    type: 'function',
                                    function: { name: 'get_current_pen', arguments: '{}' }
                                }]
                            }
                        }],
                        usage: { prompt_tokens: 500, completion_tokens: 30 }
                    },
                    {
                        choices: [{
                            message: { role: 'assistant', content: '不需要修改。' }
                        }],
                        usage: { prompt_tokens: 800, completion_tokens: 20 }
                    }
                ];
                const resp = responses[callIndex++];
                return { ok: true, json: async () => resp, text: async () => JSON.stringify(resp) };
            });

            await runAgent(baseContext, 'test-trace-17');

            // 第二次调用应该包含 tool result message
            const secondCall = capturedBodies[1];
            expect(secondCall.messages.length).toBeGreaterThan(2);

            const toolMessage = secondCall.messages.find(m => m.role === 'tool');
            expect(toolMessage).toBeDefined();
            expect(toolMessage.tool_call_id).toBe('call_1');

            const content = JSON.parse(toolMessage.content);
            expect(content.html).toBe('<div id="app"></div>');
            expect(content.js).toBe('console.log("hello")');
        });
    });
});
