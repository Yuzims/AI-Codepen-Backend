const { AGENT_TOOLS, TERMINAL_TOOL, executeToolCall } = require('./agentTools');
const { validateToolCall, validatePatchProposal, isTimedOut, GUARDRAILS } = require('./agentGuardrails');
const { ORCHESTRATOR_SYSTEM_PROMPT, buildOrchestratorUserMessage } = require('./agentPromptService');

function truncate(str, maxLen) {
    if (typeof str !== 'string') str = JSON.stringify(str);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '...(truncated)';
}

async function callLLM(messages, traceId) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages,
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
            temperature: 0.2,
            max_tokens: 8192
        })
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`DeepSeek API error: ${response.status} ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    return data;
}

async function runAgent(context, traceId) {
    if (!process.env.DEEPSEEK_API_KEY) {
        throw new Error('服务端未配置 DEEPSEEK_API_KEY');
    }

    const startTime = Date.now();
    const steps = [];
    const toolCallCounts = {};

    const messages = [
        { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
        { role: 'user', content: buildOrchestratorUserMessage(context) }
    ];

    let totalTokens = 0;

    for (let stepIndex = 0; stepIndex < GUARDRAILS.MAX_STEPS; stepIndex++) {
        if (isTimedOut(startTime)) {
            console.log(`[AgentOrchestrator] traceId=${traceId}, timeout at step ${stepIndex}`);
            return { steps, proposal: null, status: 'error', error: '执行超时' };
        }

        const llmStart = Date.now();
        let llmResponse;
        try {
            llmResponse = await callLLM(messages, traceId);
        } catch (err) {
            console.error(`[AgentOrchestrator] traceId=${traceId}, LLM call failed at step ${stepIndex}:`, err.message);
            return { steps, proposal: null, status: 'error', error: 'LLM 调用失败: ' + err.message };
        }
        const llmDuration = Date.now() - llmStart;

        if (llmResponse.usage) {
            totalTokens += (llmResponse.usage.prompt_tokens || 0) + (llmResponse.usage.completion_tokens || 0);
        }

        const choice = llmResponse.choices?.[0];
        if (!choice || !choice.message) {
            console.error(`[AgentOrchestrator] traceId=${traceId}, invalid LLM response at step ${stepIndex}`);
            return { steps, proposal: null, status: 'error', error: 'LLM 返回格式异常' };
        }

        const message = choice.message;
        messages.push(message);

        if (!message.tool_calls || message.tool_calls.length === 0) {
            console.log(`[AgentOrchestrator] traceId=${traceId}, agent finished without tool call at step ${stepIndex}`);
            return { steps, proposal: null, status: 'completed' };
        }

        for (const toolCall of message.tool_calls) {
            if (isTimedOut(startTime)) {
                console.log(`[AgentOrchestrator] traceId=${traceId}, timeout during tool execution`);
                return { steps, proposal: null, status: 'error', error: '执行超时' };
            }

            const toolName = toolCall.function?.name;
            const toolCallId = toolCall.id;

            const validation = validateToolCall(toolName, stepIndex);
            if (!validation.allowed) {
                console.log(`[AgentOrchestrator] traceId=${traceId}, tool rejected: ${toolName}, reason: ${validation.reason}`);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    content: JSON.stringify({ error: validation.reason })
                });
                steps.push({
                    stepIndex,
                    tool: toolName || 'unknown',
                    input: {},
                    output: `拒绝: ${validation.reason}`,
                    durationMs: 0
                });
                continue;
            }

            toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
            if (toolName !== TERMINAL_TOOL && toolCallCounts[toolName] > 2) {
                console.log(`[AgentOrchestrator] traceId=${traceId}, tool ${toolName} called too many times, forcing stop`);
                return { steps, proposal: null, status: 'max_steps_reached', error: `工具 ${toolName} 重复调用过多` };
            }

            let toolArgs = {};
            try {
                if (toolCall.function?.arguments) {
                    toolArgs = JSON.parse(toolCall.function.arguments);
                }
            } catch (e) {
                console.error(`[AgentOrchestrator] traceId=${traceId}, failed to parse tool args for ${toolName}:`, e.message);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    content: JSON.stringify({ error: '参数解析失败' })
                });
                steps.push({
                    stepIndex,
                    tool: toolName,
                    input: {},
                    output: '参数解析失败',
                    durationMs: 0
                });
                continue;
            }

            if (toolName === TERMINAL_TOOL) {
                const patchValidation = validatePatchProposal(toolArgs);
                if (!patchValidation.valid) {
                    console.error(`[AgentOrchestrator] traceId=${traceId}, patch proposal validation failed:`, patchValidation.errors);
                    steps.push({
                        stepIndex,
                        tool: toolName,
                        input: { summary: toolArgs.summary || '' },
                        output: `校验失败: ${patchValidation.errors.join('; ')}`,
                        durationMs: Date.now() - llmStart
                    });
                    return { steps, proposal: null, status: 'error', error: `提案校验失败: ${patchValidation.errors.join('; ')}` };
                }

                steps.push({
                    stepIndex,
                    tool: toolName,
                    input: { summary: toolArgs.summary || '' },
                    output: '提案已提交',
                    durationMs: Date.now() - llmStart
                });

                const proposal = {
                    summary: toolArgs.summary || '',
                    operations: toolArgs.operations.map(op => ({
                        target: op.target,
                        type: 'replace_full',
                        after: op.after,
                        reason: op.reason || ''
                    })),
                    expectedOutcome: toolArgs.expectedOutcome || '',
                    warnings: Array.isArray(toolArgs.warnings) ? toolArgs.warnings : []
                };

                const totalDuration = Date.now() - startTime;
                console.log(`[AgentOrchestrator] traceId=${traceId}, completed with proposal`, {
                    totalSteps: steps.length,
                    totalDuration: `${totalDuration}ms`,
                    totalTokens,
                    operations: proposal.operations.length
                });

                return { steps, proposal, status: 'completed' };
            }

            const toolStart = Date.now();
            let toolResult;
            try {
                toolResult = executeToolCall(toolName, toolArgs, context);
            } catch (err) {
                console.error(`[AgentOrchestrator] traceId=${traceId}, tool execution error:`, err.message);
                toolResult = { error: err.message };
            }
            const toolDuration = Date.now() - toolStart;

            const resultStr = JSON.stringify(toolResult);
            messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: resultStr
            });

            steps.push({
                stepIndex,
                tool: toolName,
                input: toolArgs,
                output: truncate(resultStr, 500),
                durationMs: toolDuration + llmDuration
            });

            console.log(`[AgentOrchestrator] traceId=${traceId}, step=${stepIndex}, tool=${toolName}, duration=${toolDuration}ms`);
        }
    }

    console.log(`[AgentOrchestrator] traceId=${traceId}, max steps reached`);
    return { steps, proposal: null, status: 'max_steps_reached' };
}

module.exports = { runAgent };
