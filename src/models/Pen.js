const mongoose = require('mongoose');

const penSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: String,
    html: {
        type: String,
        default: ''
    },
    css: {
        type: String,
        default: ''
    },
    js: {
        type: String,
        default: ''
    },
    cssLanguage: {
        type: String,
        enum: ['css', 'scss', 'less'],
        default: 'css'
    },
    jsLanguage: {
        type: String,
        enum: ['js', 'react', 'vue', 'ts'],
        default: 'js'
    },
    importedCssPenIds: {
        type: [String],
        default: []
    },
    importedJsPenIds: {
        type: [String],
        default: []
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isPublic: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    toJSON: {
        transform: (doc, ret) => {
            ret.id = ret._id.toString();
            delete ret._id;
            delete ret.__v;
        }
    }
});

// 添加性能优化索引
penSchema.index({ userId: 1 }); // 用于 userId 查询
penSchema.index({ userId: 1, createdAt: -1 }); // 用于 userId + 排序查询
penSchema.index({ isPublic: 1, createdAt: -1 }); // 用于公开pen查询

module.exports = mongoose.model('Pen', penSchema); 