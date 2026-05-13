const GUARDRAILS = {
    MAX_STEPS: 6,
    MAX_DURATION_MS: 90000,
    MAX_TOTAL_TOKENS: 16000,
    MAX_OPERATIONS: 3,
    MAX_AFTER_LENGTH: 30000,
    MAX_INPUT_CODE_LENGTH: 50000,
    MAX_INSTRUCTION_LENGTH: 1000,
    ALLOWED_TOOLS: ['get_current_pen', 'get_pen_errors', 'get_user_selection', 'get_pen_languages', 'propose_patch'],
    VALID_TARGETS: ['html', 'css', 'js']
};

function validateToolCall(toolName, stepIndex) {
    if (!GUARDRAILS.ALLOWED_TOOLS.includes(toolName)) {
        return { allowed: false, reason: `工具 "${toolName}" 不在允许列表中` };
    }
    if (stepIndex >= GUARDRAILS.MAX_STEPS) {
        return { allowed: false, reason: `已达最大步数限制（${GUARDRAILS.MAX_STEPS}）` };
    }
    return { allowed: true };
}

function validatePatchProposal(proposal) {
    const errors = [];

    if (!proposal || typeof proposal !== 'object') {
        return { valid: false, errors: ['proposal 不是有效对象'] };
    }

    if (!Array.isArray(proposal.operations)) {
        return { valid: false, errors: ['operations 必须为数组'] };
    }

    if (proposal.operations.length === 0) {
        errors.push('operations 不能为空');
    }

    if (proposal.operations.length > GUARDRAILS.MAX_OPERATIONS) {
        errors.push(`operations 数量超出限制（最多 ${GUARDRAILS.MAX_OPERATIONS} 条，当前 ${proposal.operations.length} 条）`);
    }

    for (let i = 0; i < proposal.operations.length; i++) {
        const op = proposal.operations[i];
        if (!op || typeof op !== 'object') {
            errors.push(`operations[${i}] 不是有效对象`);
            continue;
        }
        if (!GUARDRAILS.VALID_TARGETS.includes(op.target)) {
            errors.push(`operations[${i}].target 无效: "${op.target}"`);
        }
        if (typeof op.after === 'string' && op.after.length > GUARDRAILS.MAX_AFTER_LENGTH) {
            errors.push(`operations[${i}].after 超出长度限制（最大 ${GUARDRAILS.MAX_AFTER_LENGTH} 字符，当前 ${op.after.length}）`);
        }
    }

    return errors.length > 0
        ? { valid: false, errors }
        : { valid: true };
}

function validateRunRequest(body) {
    const errors = [];

    if (typeof body.userInstruction !== 'string' || !body.userInstruction.trim()) {
        errors.push('userInstruction 不能为空');
    } else if (body.userInstruction.trim().length > GUARDRAILS.MAX_INSTRUCTION_LENGTH) {
        errors.push(`userInstruction 超出长度限制（最大 ${GUARDRAILS.MAX_INSTRUCTION_LENGTH} 字符）`);
    }

    if (typeof body.html !== 'string') {
        errors.push('html 必须为字符串');
    }
    if (typeof body.css !== 'string') {
        errors.push('css 必须为字符串');
    }
    if (typeof body.js !== 'string') {
        errors.push('js 必须为字符串');
    }

    if (typeof body.html === 'string' && typeof body.css === 'string' && typeof body.js === 'string') {
        const totalLength = body.html.length + body.css.length + body.js.length;
        if (totalLength > GUARDRAILS.MAX_INPUT_CODE_LENGTH) {
            errors.push(`代码总长度超出限制（最大 ${GUARDRAILS.MAX_INPUT_CODE_LENGTH} 字符，当前 ${totalLength}）`);
        }
    }

    return errors.length > 0
        ? { valid: false, errors }
        : { valid: true };
}

function isTimedOut(startTime) {
    return Date.now() - startTime >= GUARDRAILS.MAX_DURATION_MS;
}

module.exports = {
    GUARDRAILS,
    validateToolCall,
    validatePatchProposal,
    validateRunRequest,
    isTimedOut
};
