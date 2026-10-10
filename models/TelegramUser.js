const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,
    isBlocked: { type: Boolean, default: false },
    totalOrders: { type: Number, default: 0 },
    lastInteraction: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('TelegramUser', schema);
