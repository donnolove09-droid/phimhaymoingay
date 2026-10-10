const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    orderCode: { type: String, required: true, unique: true, index: true },
    chatId: { type: String, index: true },
    telegramUsername: String,
    customerEmail: String,
    plan: { type: String, enum: ['TRIAL', 'BASIC', 'PRO', 'VIP'], required: true },
    durationHours: { type: Number, required: true },
    price: { type: Number, default: 0 },
    paymentMethod: {
        type: String,
        enum: ['vietqr', 'vnpay', 'momo', 'manual', 'free'],
        default: 'vietqr'
    },
    paymentRef: String,
    paymentData: Object,
    status: {
        type: String,
        enum: ['pending', 'paid', 'delivered', 'cancelled', 'expired'],
        default: 'pending',
        index: true
    },
    keyId: { type: mongoose.Schema.Types.ObjectId, ref: 'AccessKey' },
    keyValue: String,
    paidAt: Date,
    deliveredAt: Date,
    note: String
}, { timestamps: true });

module.exports = mongoose.model('Order', schema);
