const jwt = require('jsonwebtoken');
const AccessKey = require('../models/AccessKey');

const TOKEN_TTL_HOURS = 4;

exports.verifyKey = async (req, res) => {
    const { key } = req.body || {};
    if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: 'Chưa nhập key' });
    }
    const normalized = key.trim().toUpperCase();

    const existing = await AccessKey.findOne({ key: normalized });
    if (!existing) return res.status(403).json({ error: 'Key không tồn tại' });
    if (existing.isUsed) return res.status(403).json({ error: 'Key đã được sử dụng' });

    const now = new Date();
    const ttl = existing.durationHours || TOKEN_TTL_HOURS;
    const expiresAt = new Date(now.getTime() + ttl * 3600 * 1000);

    // Kích hoạt atomic: nếu 2 thiết bị nhập cùng lúc chỉ 1 thiết bị thành công
    const record = await AccessKey.findOneAndUpdate(
        { _id: existing._id, isUsed: false },
        {
            $set: {
                isUsed: true,
                usedAt: now,
                expiresAt,
                usedBy: {
                    ip: req.ip || 'unknown',
                    userAgent: req.headers['user-agent'] || 'unknown'
                }
            }
        },
        { new: true }
    );
    if (!record) return res.status(403).json({ error: 'Key đã được sử dụng' });

    const token = jwt.sign(
        { role: 'viewer', key: normalized, keyId: record._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: `${ttl}h` }
    );

    res.json({ success: true, token, expiresAt });
};

exports.checkAccess = async (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Cần nhập key' });

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.role === 'admin') return next();

        const record = await AccessKey.findById(payload.keyId);
        if (!record || !record.isUsed) {
            return res.status(401).json({ error: 'Key không hợp lệ' });
        }
        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            return res.status(401).json({ error: 'Key đã hết hạn' });
        }
        req.viewer = payload;
        next();
    } catch (e) {
        if (e.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Phiên đã hết hạn' });
        }
        res.status(401).json({ error: 'Token không hợp lệ' });
    }
};

exports.status = async (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.json({ valid: false });

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.role === 'admin') return res.json({ valid: true, role: 'admin' });

        const record = await AccessKey.findById(payload.keyId);
        if (!record || !record.isUsed) return res.json({ valid: false });
        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            return res.json({ valid: false, reason: 'expired' });
        }
        res.json({
            valid: true,
            expiresAt: record.expiresAt,
            secondsLeft: Math.floor((new Date(record.expiresAt) - Date.now()) / 1000)
        });
    } catch {
        res.json({ valid: false });
    }
};
