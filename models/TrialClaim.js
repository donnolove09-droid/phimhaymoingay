const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    ip: { type: String, required: true, index: true },
    contact: String,
    keyValue: String,
    userAgent: String,
    claimedAt: { type: Date, default: Date.now, index: true }
});

// TTL: tự xoá sau 7 ngày
schema.index({ claimedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

module.exports = mongoose.model('TrialClaim', schema);
