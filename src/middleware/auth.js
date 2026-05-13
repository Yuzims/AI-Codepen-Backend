const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    // 从请求头获取 token
    const token = req.header('Authorization');

    // 检查 token 是否存在
    if (!token) {
        return res.status(401).json({ message: '没有 token，授权被拒绝' });
    }

    try {
        const cleanToken = token.replace('Bearer ', '');

        // 检查token是否在黑名单中
        const { blacklistedTokens } = require('../routes/users');
        if (blacklistedTokens && blacklistedTokens.has(cleanToken)) {
            console.log('[Auth] Token 在黑名单中');
            return res.status(401).json({ message: 'Token 已失效，请重新登录' });
        }

        // 验证 token
        const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET || 'your-secret-key');

        // 将用户添加到请求中
        req.user = decoded;
        next();
    } catch (err) {
        console.error('[Auth] Token 验证失败:', {
            error: err.name,
            message: err.message,
            tokenPrefix: token.substring(0, 20) + '...'
        });

        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token 已过期，请重新登录' });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Token 格式错误' });
        }
        res.status(401).json({ message: 'Token 无效' });
    }
}; 