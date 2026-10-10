const crypto = require('crypto');
const { countAvailable, allocateKey } = require('../services/keys');
const { publicUrl } = require('../config/env');
const TrialToken = require('../models/TrialToken');
const TrialClaim = require('../models/TrialClaim');

const TOKEN_TTL_MINUTES = 15;
const TRIAL_DURATION_HOURS = 1;
const USER_COOLDOWN_HOURS = 24;

exports.createToken = async (chatId, telegramUsername) => {
    const recent = await TrialToken.findOne({
        chatId,
        isUsed: true,
        usedAt: { $gt: new Date(Date.now() - USER_COOLDOWN_HOURS * 3600 * 1000) }
    }).sort({ usedAt: -1 });

    if (recent) {
        const nextAt = new Date(recent.usedAt.getTime() + USER_COOLDOWN_HOURS * 3600 * 1000);
        const remainMin = Math.ceil((nextAt - Date.now()) / 60000);
        return { success: false, reason: 'cooldown', remainMin, nextAt };
    }

    const unusedCount = await countAvailable();
    if (unusedCount === 0) {
        return { success: false, reason: 'out_of_stock' };
    }

    await TrialToken.deleteMany({ chatId, isUsed: false });

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

    await TrialToken.create({
        token,
        chatId,
        telegramUsername,
        expiresAt
    });

    return {
        success: true,
        token,
        expiresAt,
        url: `${publicUrl()}/getkeyfree?token=${token}`
    };
};

exports.verifyToken = async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).json({ error: 'Thiếu token' });
        }

        const record = await TrialToken.findOne({ token });

        if (!record) {
            return res.status(404).json({
                valid: false,
                reason: 'not_found',
                message: 'Link không tồn tại hoặc đã hết hạn'
            });
        }

        if (record.isUsed) {
            return res.status(410).json({
                valid: false,
                reason: 'used',
                message: 'Link này đã được sử dụng',
                keyIssued: record.keyIssued,
                usedAt: record.usedAt
            });
        }

        if (new Date(record.expiresAt) < new Date()) {
            return res.status(410).json({
                valid: false,
                reason: 'expired',
                message: 'Link đã hết hạn, vui lòng gõ /getkeyfree lại trên Telegram'
            });
        }

        res.json({
            valid: true,
            expiresAt: record.expiresAt,
            durationHours: TRIAL_DURATION_HOURS,
            telegramUsername: record.telegramUsername
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.claimByToken = async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Thiếu token' });

    const record = await TrialToken.findOne({ token });
    if (!record) return res.status(404).json({ error: 'Link không tồn tại hoặc đã hết hạn' });
    if (record.isUsed) {
        return res.status(410).json({ error: 'Link này đã được sử dụng', keyIssued: record.keyIssued });
    }
    if (new Date(record.expiresAt) < new Date()) {
        return res.status(410).json({ error: 'Link đã hết hạn, vui lòng gõ /getkeyfree lại trên Telegram' });
    }

    // Khoá token atomic: bấm 2 lần / 2 tab cùng lúc không thể lấy 2 key
    const locked = await TrialToken.findOneAndUpdate(
        { _id: record._id, isUsed: false },
        { $set: { isUsed: true, usedAt: new Date() } },
        { new: true }
    );
    if (!locked) return res.status(410).json({ error: 'Link này đã được sử dụng' });

    const key = await allocateKey(`telegram:${record.chatId}`, {
        plan: 'TRIAL',
        durationHours: TRIAL_DURATION_HOURS,
        note: `Telegram trial from ${record.chatId}`
    });

    if (!key) {
        // Hết key: mở lại token để người dùng thử lại sau
        await TrialToken.updateOne({ _id: record._id }, { $set: { isUsed: false }, $unset: { usedAt: 1 } });
        return res.status(503).json({ error: 'Đã hết key dùng thử. Vui lòng thử lại sau.' });
    }

    await TrialToken.updateOne({ _id: record._id }, { $set: { keyIssued: key.key } });

    await TrialClaim.create({
        ip: getClientIP(req),
        contact: `telegram:${record.chatId}`,
        keyValue: key.key,
        userAgent: req.headers['user-agent'] || 'unknown'
    });

    try {
        const { notify } = require('../bot');
        if (record.chatId) {
            await notify(record.chatId,
                `<b>Bạn đã lấy key thành công</b>\n\n` +
                `Key: <code>${key.key}</code>\n` +
                `Thời hạn: <b>${TRIAL_DURATION_HOURS} giờ</b>\n\n` +
                `Vào website và nhập key để xem phim.\n` +
                `Có thể lấy key mới sau 24 giờ.`);
        }
    } catch (e) { console.error('[telegram] notify:', e.message); }

    res.json({
        success: true,
        key: key.key,
        durationHours: TRIAL_DURATION_HOURS,
        websiteUrl: '/'
    });
};

exports.stats = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [totalTokens, activeTokens, usedTokens, todayIssued] = await Promise.all([
            TrialToken.countDocuments(),
            TrialToken.countDocuments({ isUsed: false, expiresAt: { $gt: new Date() } }),
            TrialToken.countDocuments({ isUsed: true }),
            TrialToken.countDocuments({ isUsed: true, usedAt: { $gte: today } })
        ]);

        res.json({ totalTokens, activeTokens, usedTokens, todayIssued });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

function getClientIP(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}
