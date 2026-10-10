const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    isUsed: { type: Boolean, default: false, index: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    usedBy: { ip: String, userAgent: String },
    plan: { type: String, default: 'BASIC' },
    durationHours: { type: Number, default: 4 },
    // Đã phát cho đơn hàng / người dùng nào (chưa chắc đã được nhập)
    issuedTo: { type: String, default: null, index: true },
    note: String
}, { timestamps: true });

module.exports = mongoose.model('AccessKey', schema);
