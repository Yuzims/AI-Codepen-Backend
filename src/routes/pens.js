const express = require('express');
const router = express.Router();
const Pen = require('../models/Pen');
const auth = require('../middleware/auth'); // Import auth middleware

// 获取所有公开的 pens
router.get('/public', async (req, res) => {
    try {
        const pens = await Pen.find({ isPublic: true })
            .populate('userId', 'username')
            .sort({ createdAt: -1 });
        res.json(pens);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 获取用户的 pens
router.get('/user/me', auth, async (req, res) => {
    try {
        // 支持分页：首屏只返回20条，后续可加载更多
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = Math.max(parseInt(req.query.skip) || 0, 0);
        
        // req.user 由 auth 中间件设置
        const pens = await Pen.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip)
            .lean(); // 返回纯对象以提升性能

        res.json(pens.map(pen => ({
            ...pen,
            id: pen.id || pen._id?.toString(),
            userId: pen.userId?.toString?.() || pen.userId
        })));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 获取单个pen详情
router.get('/:id', async (req, res) => {
    try {
        const pen = await Pen.findById(req.params.id)
            .populate('userId', 'username');

        if (!pen) {
            return res.status(404).json({ message: 'Pen 不存在' });
        }

        // 如果不是公开的pen，需要验证是否是创建者
        if (!pen.isPublic) {
            const token = req.header('Authorization');
            if (!token) {
                return res.status(401).json({ message: '需要授权访问' });
            }

            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET || 'your-secret-key');
                if (pen.userId._id.toString() !== decoded.id) {
                    return res.status(403).json({ message: '无权访问此 Pen' });
                }
            } catch (err) {
                return res.status(401).json({ message: 'Token 无效' });
            }
        }

        res.json(pen);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 创建新的 pen
router.post('/', auth, async (req, res) => {
    const pen = new Pen({
        title: req.body.title,
        description: req.body.description,
        html: req.body.html,
        css: req.body.css,
        js: req.body.js,
        cssLanguage: req.body.cssLanguage,
        jsLanguage: req.body.jsLanguage,
        userId: req.user.id, // 从认证后的用户中获取 userId
        isPublic: req.body.isPublic
    });

    try {
        const newPen = await pen.save();
        await newPen.populate('userId', 'username');
        res.status(201).json(newPen);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 更新 pen
router.patch('/:id', auth, async (req, res) => {
    try {
        const pen = await Pen.findById(req.params.id);
        if (!pen) {
            return res.status(404).json({ message: 'Pen 不存在' });
        }

        // 确保只有 pen 的创建者才能更新
        if (pen.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: '用户未授权' });
        }

        Object.keys(req.body).forEach(key => {
            pen[key] = req.body[key];
        });
        pen.updatedAt = Date.now();

        const updatedPen = await pen.save();
        await updatedPen.populate('userId', 'username');
        res.json(updatedPen);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 删除单个 pen
router.delete('/:id', auth, async (req, res) => {
    try {
        const pen = await Pen.findById(req.params.id);
        if (!pen) {
            return res.status(404).json({ message: 'Pen 不存在' });
        }

        // 确保只有 pen 的创建者才能删除
        if (pen.userId.toString() !== req.user.id) {
            return res.status(403).json({ message: '用户未授权' });
        }

        const deletedPen = {
            id: pen._id,
            title: pen.title,
            deletedAt: new Date().toISOString()
        };

        await pen.deleteOne();

        console.log(`用户 ${req.user.username} 删除了 Pen: ${pen.title} (ID: ${pen._id})`);

        res.json({
            message: 'Pen 删除成功',
            deletedPen: deletedPen
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 批量删除 pens
router.delete('/batch/delete', auth, async (req, res) => {
    try {
        const { penIds } = req.body;

        if (!Array.isArray(penIds) || penIds.length === 0) {
            return res.status(400).json({ message: '请提供要删除的 Pen ID 列表' });
        }

        // 查找所有要删除的 pens
        const pens = await Pen.find({
            _id: { $in: penIds },
            userId: req.user.id  // 确保只能删除自己的 pens
        });

        if (pens.length === 0) {
            return res.status(404).json({ message: '没有找到可删除的 Pen' });
        }

        const deletedPens = pens.map(pen => ({
            id: pen._id,
            title: pen.title,
            deletedAt: new Date().toISOString()
        }));

        // 执行批量删除
        await Pen.deleteMany({
            _id: { $in: pens.map(pen => pen._id) },
            userId: req.user.id
        });

        console.log(`用户 ${req.user.username} 批量删除了 ${deletedPens.length} 个 Pen`);

        res.json({
            message: `成功删除 ${deletedPens.length} 个 Pen`,
            deletedPens: deletedPens,
            deletedCount: deletedPens.length
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 获取用户删除的 pens 统计
router.get('/stats/deleted', auth, async (req, res) => {
    try {
        const totalPens = await Pen.countDocuments({ userId: req.user.id });

        res.json({
            userId: req.user.id,
            totalPens: totalPens,
            message: `用户共有 ${totalPens} 个 Pen`
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router; 