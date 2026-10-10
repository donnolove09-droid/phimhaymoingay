const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    token: { type: String, required: true, unique: true, index: true },
    chatId: { type: String, required: true, index: true },
    telegramUsername: String,
    isUsed: { type: Boolean, default: false, index: true },
    usedAt: Date,
    keyIssued: String,
    expiresAt: { type: Date, required: true, index: true }
}, { timestamps: true });

// TTL: tự xoá khi hết hạn
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TrialToken', schema);
