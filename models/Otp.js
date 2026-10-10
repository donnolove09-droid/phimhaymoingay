const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
    email: { type: String, required: true, index: true },
    // Lưu bản băm (HMAC) chứ không lưu mã gốc
    codeHash: { type: String, required: true },
    type: { type: String, enum: ['register', 'login', 'reset'], default: 'register' },
    used: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

// Mongo tự xoá OTP đã hết hạn
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
