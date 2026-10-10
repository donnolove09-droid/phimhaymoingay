const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Setting = require('../models/Setting');
const AccessKey = require('../models/AccessKey');
const Order = require('../models/Order');
const { deliverKey } = require('./paymentController');
const { AVAILABLE } = require('../services/keys');
const mailer = require('../services/mailer');
const { publicUrl } = require('../config/env');

exports.login = async (req, res) => {
    const { username, password } = req.body || {};
    if (!process.env.ADMIN_USERNAME) return res.status(503).json({ error: 'Server chưa đặt ADMIN_USERNAME' });
    if (username !== process.env.ADMIN_USERNAME) {
        return res.status(401).json({ error: 'Sai thông tin' });
    }
    const hashSetting = await Setting.findOne({ key: 'admin_password_hash' });
    let ok = hashSetting?.value
        ? await bcrypt.compare(password, hashSetting.value)
        : password === process.env.ADMIN_PASSWORD;

    if (!ok) return res.status(401).json({ error: 'Sai thông tin' });

    const token = jwt.sign(
        { role: 'admin', username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
    res.json({ success: true, token, username });
};

exports.getSettings = async (req, res) => {
    const setting = await Setting.findOne({ key: 'access_key' });
    res.json({
        accessKey: setting?.value || process.env.ACCESS_KEY,
        hasCustom: !!setting
    });
};

exports.updateAccessKey = async (req, res) => {
    const { accessKey } = req.body;
    if (!accessKey || accessKey.length < 4) {
        return res.status(400).json({ error: 'Key từ 4 ký tự' });
    }
    await Setting.findOneAndUpdate(
        { key: 'access_key' },
        { value: accessKey, updatedAt: new Date() },
        { upsert: true }
    );
    res.json({ success: true, accessKey });
};

exports.changePassword = async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Mật khẩu từ 6 ký tự' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await Setting.findOneAndUpdate(
        { key: 'admin_password_hash' },
        { value: hash, updatedAt: new Date() },
        { upsert: true }
    );
    res.json({ success: true });
};

exports.getKeyStats = async (req, res) => {
    const [total, used, unused, active, expired, issued] = await Promise.all([
        AccessKey.countDocuments(),
        AccessKey.countDocuments({ isUsed: true }),
        AccessKey.countDocuments(AVAILABLE),
        AccessKey.countDocuments({ isUsed: true, expiresAt: { $gt: new Date() } }),
        AccessKey.countDocuments({ isUsed: true, expiresAt: { $lt: new Date() } }),
        AccessKey.countDocuments({ isUsed: false, issuedTo: { $ne: null } })
    ]);
    return res.json({ total, used, unused, active, expired, issued });
};

exports.getUsedKeys = async (req, res) => {
    const page = Number(req.query.page) || 1;
    const items = await AccessKey.find({ isUsed: true })
        .sort({ usedAt: -1 }).skip((page - 1) * 50).limit(50)
        .select('key usedAt expiresAt usedBy');
    res.json(items);
};

exports.resetKey = async (req, res) => {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Thiếu key' });
    const record = await AccessKey.findOne({ key: key.toUpperCase() });
    if (!record) return res.status(404).json({ error: 'Không tìm thấy' });
    record.isUsed = false;
    record.issuedTo = null;
    record.usedAt = null;
    record.expiresAt = null;
    record.usedBy = { ip: null, userAgent: null };
    await record.save();
    res.json({ success: true, key: record.key });
};

exports.revokeKey = async (req, res) => {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Thiếu key' });
    const record = await AccessKey.findOne({ key: key.toUpperCase() });
    if (!record) return res.status(404).json({ error: 'Không tìm thấy' });
    record.expiresAt = new Date();
    await record.save();
    res.json({ success: true });
};

exports.getOrders = async (req, res) => {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json(orders);
};

exports.confirmOrder = async (req, res) => {
    const order = await Order.findOne({ orderCode: req.params.orderCode });
    if (!order) return res.status(404).json({ error: 'Không tìm thấy' });
    if (order.status === 'delivered') return res.json({ success: true, already: true });

    order.status = 'paid';
    order.paidAt = new Date();
    await order.save();
    await deliverKey(order);
    res.json({ success: true, key: order.keyValue });
};

exports.importKeys = async (req, res) => {
    try {
        const { keys } = req.body;
        if (!Array.isArray(keys) || !keys.length) {
            return res.status(400).json({ error: 'Cần mảng keys' });
        }
        const cleaned = [...new Set(keys.map(k => String(k).trim().toUpperCase()).filter(Boolean))];
        const ops = cleaned.map(k => ({
            updateOne: {
                filter: { key: k },
                update: { $setOnInsert: { key: k, isUsed: false } },
                upsert: true
            }
        }));
        const result = await AccessKey.bulkWrite(ops);
        const total = await AccessKey.countDocuments();
        const unused = await AccessKey.countDocuments({ isUsed: false });
        res.json({
            success: true,
            input: cleaned.length,
            inserted: result.upsertedCount,
            total,
            unused
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

/* ---------- Chẩn đoán (chỉ admin) ---------- */

// Gửi thử 1 email để biết cấu hình mail đã chạy chưa
exports.mailTest = async (req, res) => {
    const to = String(req.body?.to || req.query.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Thiếu/sai email nhận' });
    const provider = mailer.provider();
    if (!provider) return res.status(503).json({ ok: false, error: 'Chưa cấu hình mail (BREVO_API_KEY / RESEND_API_KEY / SMTP)' });
    try {
        await mailer.sendOtpEmail(to, '123456');
        res.json({ ok: true, provider, message: `Đã gửi mail thử tới ${to} (mã 123456)` });
    } catch (e) {
        res.status(502).json({ ok: false, provider, error: mailer.describeError(e) });
    }
};

// Xem bot Telegram + webhook đang ở trạng thái nào
exports.telegramStatus = async (req, res) => {
    const { getBot } = require('../bot');
    const bot = getBot();
    if (!bot) return res.json({ enabled: false, error: 'Chưa đặt TELEGRAM_BOT_TOKEN' });
    try {
        const [me, info] = await Promise.all([bot.telegram.getMe(), bot.telegram.getWebhookInfo()]);
        res.json({
            enabled: true,
            bot: `@${me.username}`,
            publicUrl: publicUrl() || null,
            webhook: {
                url: info.url ? info.url.replace(/\/webhook\/.+$/, '/webhook/***') : '',
                pending: info.pending_update_count,
                lastError: info.last_error_message || null,
                lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000) : null
            }
        });
    } catch (e) {
        res.status(502).json({ enabled: true, error: e.message });
    }
};

exports.telegramSetWebhook = async (req, res) => {
    const { registerWebhook } = require('../bot/webhook');
    const out = await registerWebhook();
    res.status(out.ok ? 200 : 502).json(out);
};
