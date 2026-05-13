const express = require('express');
const auth = require('../middleware/auth');
const agentService = require('../services/agentService');
const agentPatchService = require('../services/agentPatchService');
const agentOrchestrator = require('../services/agentOrchestrator');
const { validateRunRequest } = require('../services/agentGuardrails');

const router = express.Router();

const generatePlanTraceId = () =>
    `agent-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const generatePatchTraceId = () =>
    `agent-patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const generateRunTraceId = () =>
    `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

router.post('/plan', auth, async (req, res) => {
    const traceId = generatePlanTraceId();
    const startTime = Date.now();

    try {
        const { userInstruction, html, css, js, penId, title, cssLanguage, jsLanguage, selection, errors } = req.body;

        // 参数校验
        if (typeof userInstruction !== 'string' || !userInstruction.trim()) {
            return res.status(400).json({ message: '请输入指令', traceId });
        }
        if (userInstruction.trim().length > 1000) {
            return res.status(400).json({ message: '指令长度不能超过 1000 字符', traceId });
        }
        if (typeof html !== 'string' || typeof css !== 'string' || typeof js !== 'string') {
            return res.status(400).json({ message: 'html/css/js 必须为字符串', traceId });
        }

        const totalCodeLength = html.length + css.length + js.length;
        if (totalCodeLength > 50000) {
            return res.status(400).json({ message: '代码总长度超出限制（最大 50000 字符）', traceId });
        }

        // selection 校验
        if (selection !== undefined && selection !== null) {
            if (typeof selection !== 'object' ||
                !['html', 'css', 'js'].includes(selection.target) ||
                typeof selection.from !== 'number' ||
                typeof selection.to !== 'number' ||
                typeof selection.text !== 'string') {
                return res.status(400).json({ message: 'selection 结构不合法', traceId });
            }
        }

        // errors 校验与截断
        let validatedErrors = [];
        if (Array.isArray(errors)) {
            validatedErrors = errors.slice(0, 20).filter(e =>
                typeof e === 'object' &&
                ['html', 'css', 'js'].includes(e.target) &&
                ['error', 'warning'].includes(e.severity) &&
                typeof e.message === 'string'
            );
        }

        console.log(`[${traceId}] Agent plan request`, {
            penId: penId || null,
            title: title || null,
            instructionLength: userInstruction.trim().length,
            htmlLength: html.length,
            cssLength: css.length,
            jsLength: js.length,
            totalCodeLength,
            errorsCount: validatedErrors.length,
            hasSelection: !!(selection && selection.target)
        });

        const plan = await agentService.generatePlan({
            penId,
            title,
            html,
            css,
            js,
            cssLanguage,
            jsLanguage,
            selection: selection || null,
            errors: validatedErrors,
            userInstruction: userInstruction.trim()
        });

        const duration = Date.now() - startTime;
        console.log(`[${traceId}] Agent plan success`, {
            duration: `${duration}ms`,
            targets: plan.targets,
            stepsCount: plan.steps.length,
            risksCount: plan.risks.length
        });

        res.json({ traceId, plan });
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[${traceId}] Agent plan error (${duration}ms):`, error.message || error);
        const message = error instanceof Error ? error.message : 'Agent 计划生成失败';
        res.status(500).json({ message, traceId });
    }
});

router.post('/patch', auth, async (req, res) => {
    const traceId = generatePatchTraceId();
    const startTime = Date.now();

    try {
        const { userInstruction, html, css, js, penId, title, cssLanguage, jsLanguage, selection, errors, plan } = req.body;

        // 参数校验
        if (typeof userInstruction !== 'string' || !userInstruction.trim()) {
            return res.status(400).json({ message: '请输入指令', traceId });
        }
        if (userInstruction.trim().length > 1000) {
            return res.status(400).json({ message: '指令长度不能超过 1000 字符', traceId });
        }
        if (typeof html !== 'string' || typeof css !== 'string' || typeof js !== 'string') {
            return res.status(400).json({ message: 'html/css/js 必须为字符串', traceId });
        }

        const totalCodeLength = html.length + css.length + js.length;
        if (totalCodeLength > 50000) {
            return res.status(400).json({ message: '代码总长度超出限制（最大 50000 字符）', traceId });
        }

        // plan 校验
        if (!plan || typeof plan !== 'object') {
            return res.status(400).json({ message: 'plan 字段必须为对象', traceId });
        }
        if (typeof plan.summary !== 'string' || typeof plan.goal !== 'string') {
            return res.status(400).json({ message: 'plan 必须包含 summary 和 goal', traceId });
        }
        if (!Array.isArray(plan.targets) || plan.targets.length === 0) {
            return res.status(400).json({ message: 'plan.targets 必须为非空数组', traceId });
        }
        if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
            return res.status(400).json({ message: 'plan.steps 必须为非空数组', traceId });
        }
        if (!Array.isArray(plan.risks)) {
            return res.status(400).json({ message: 'plan.risks 必须为数组', traceId });
        }

        // selection 校验
        let validatedSelection = null;
        if (selection !== undefined && selection !== null) {
            if (typeof selection === 'object' &&
                ['html', 'css', 'js'].includes(selection.target) &&
                typeof selection.from === 'number' &&
                typeof selection.to === 'number' &&
                typeof selection.text === 'string') {
                validatedSelection = selection;
            }
        }

        // errors 校验与截断
        let validatedErrors = [];
        if (Array.isArray(errors)) {
            validatedErrors = errors.slice(0, 20).filter(e =>
                typeof e === 'object' &&
                ['html', 'css', 'js'].includes(e.target) &&
                ['error', 'warning'].includes(e.severity) &&
                typeof e.message === 'string'
            );
        }

        console.log(`[${traceId}] Agent patch request`, {
            penId: penId || null,
            title: title || null,
            instructionLength: userInstruction.trim().length,
            totalCodeLength,
            planTargets: plan.targets,
            planStepsCount: plan.steps.length
        });

        const proposal = await agentPatchService.generatePatch({
            penId,
            title,
            html,
            css,
            js,
            cssLanguage,
            jsLanguage,
            selection: validatedSelection,
            errors: validatedErrors,
            userInstruction: userInstruction.trim(),
            plan
        });

        const duration = Date.now() - startTime;
        console.log(`[${traceId}] Agent patch success`, {
            duration: `${duration}ms`,
            operationsCount: proposal.operations.length,
            targets: proposal.operations.map(op => op.target),
            warningsCount: proposal.warnings.length
        });

        res.json({ traceId, proposal });
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[${traceId}] Agent patch error (${duration}ms):`, error.message || error);
        const message = error instanceof Error ? error.message : 'Agent Patch 生成失败';
        res.status(500).json({ message, traceId });
    }
});

router.post('/run', auth, async (req, res) => {
    const traceId = generateRunTraceId();
    const startTime = Date.now();

    try {
        const validation = validateRunRequest(req.body);
        if (!validation.valid) {
            return res.status(400).json({ message: validation.errors[0], traceId });
        }

        const { userInstruction, html, css, js, penId, title, cssLanguage, jsLanguage, selection, errors } = req.body;

        let validatedSelection = null;
        if (selection && typeof selection === 'object' &&
            ['html', 'css', 'js'].includes(selection.target) &&
            typeof selection.from === 'number' &&
            typeof selection.to === 'number' &&
            typeof selection.text === 'string') {
            validatedSelection = selection;
        }

        let validatedErrors = [];
        if (Array.isArray(errors)) {
            validatedErrors = errors.slice(0, 20).filter(e =>
                typeof e === 'object' &&
                ['html', 'css', 'js'].includes(e.target) &&
                ['error', 'warning'].includes(e.severity) &&
                typeof e.message === 'string'
            );
        }

        console.log(`[${traceId}] Agent run request`, {
            penId: penId || null,
            title: title || null,
            instructionLength: userInstruction.trim().length,
            totalCodeLength: html.length + css.length + js.length,
            errorsCount: validatedErrors.length,
            hasSelection: !!(validatedSelection)
        });

        const context = {
            penId: penId || null,
            title: title || null,
            html,
            css,
            js,
            cssLanguage: cssLanguage || 'css',
            jsLanguage: jsLanguage || 'js',
            selection: validatedSelection,
            errors: validatedErrors,
            userInstruction: userInstruction.trim()
        };

        const result = await agentOrchestrator.runAgent(context, traceId);

        const duration = Date.now() - startTime;
        console.log(`[${traceId}] Agent run completed`, {
            duration: `${duration}ms`,
            status: result.status,
            stepsCount: result.steps.length,
            hasProposal: !!result.proposal
        });

        res.json({
            traceId,
            steps: result.steps,
            proposal: result.proposal,
            status: result.status,
            ...(result.error ? { error: result.error } : {})
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[${traceId}] Agent run error (${duration}ms):`, error.message || error);
        const message = error instanceof Error ? error.message : 'Agent 执行失败';
        res.status(500).json({ message, traceId });
    }
});

module.exports = router;
