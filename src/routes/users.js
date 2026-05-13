const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');

// 用于存储已失效的token（在生产环境中应该使用Redis等持久化存储）
const blacklistedTokens = new Set();

// 注册新用户
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // 检查用户是否已存在
        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });

        if (existingUser) {
            return res.status(400).json({
                message: '用户名或邮箱已被注册'
            });
        }

        const user = new User({
            username,
            email,
            password // 注意：实际应用中需要对密码进行加密
        });

        const newUser = await user.save();
        res.status(201).json({
            id: newUser._id,
            username: newUser.username,
            email: newUser.email
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 用户登录
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 查找用户
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: '用户不存在' });
        }

        // 验证密码（实际应用中需要加密比较）
        if (user.password !== password) {
            return res.status(400).json({ message: '密码错误' });
        }

        // 生成 JWT token
        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 用户登出
router.post('/logout', auth, async (req, res) => {
    try {
        // 获取请求头中的token
        const token = req.header('Authorization');

        if (token) {
            // 将token添加到黑名单
            const cleanToken = token.replace('Bearer ', '');
            blacklistedTokens.add(cleanToken);

            console.log(`用户 ${req.user.username} 已登出，token已加入黑名单`);
        }

        res.json({
            message: '登出成功',
            user: {
                id: req.user.id,
                username: req.user.username
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 获取用户信息
router.get('/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 获取当前用户信息
router.get('/profile/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 导出黑名单，供中间件使用
module.exports = router;
module.exports.blacklistedTokens = blacklistedTokens; 