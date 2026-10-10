const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    avatar: String,
    lastLogin: Date
}, { timestamps: true });

// Tài khoản chưa xác thực email tự bị xoá sau 24h để không "giữ chỗ" email/username
userSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600, partialFilterExpression: { isVerified: false } });

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.comparePassword = function (pwd) {
    return bcrypt.compare(pwd, this.password);
};

module.exports = mongoose.model('User', userSchema);
