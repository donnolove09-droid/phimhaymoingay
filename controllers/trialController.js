const { countAvailable, allocateKey } = require('../services/keys');
const TrialClaim = require('../models/TrialClaim');

const CLAIM_COOLDOWN_HOURS = 24;
const TRIAL_DURATION_HOURS = 1;

exports.availability = async (req, res) => {
    try {
        const ip = getClientIP(req);
        const recent = await TrialClaim.findOne({
            ip,
            claimedAt: { $gt: new Date(Date.now() - CLAIM_COOLDOWN_HOURS * 3600 * 1000) }
        }).sort({ claimedAt: -1 });

        const unusedCount = await countAvailable();

        if (recent) {
            const nextAt = new Date(recent.claimedAt.getTime() + CLAIM_COOLDOWN_HOURS * 3600 * 1000);
            const remainMin = Math.ceil((nextAt - Date.now()) / 60000);
            return res.json({
                canClaim: false,
                reason: 'cooldown',
                message: `Bạn đã lấy key rồi. Thử lại sau ${remainMin} phút.`,
                nextClaimAt: nextAt
            });
        }

        if (unusedCount === 0) {
            return res.json({
                canClaim: false,
                reason: 'out_of_stock',
                message: 'Đã hết key dùng thử. Vui lòng quay lại sau.'
            });
        }

        res.json({
            canClaim: true,
            remaining: unusedCount,
            durationHours: TRIAL_DURATION_HOURS
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.claim = async (req, res) => {
    try {
        const ip = getClientIP(req);
        const { contact } = req.body;

        const recent = await TrialClaim.findOne({
            ip,
            claimedAt: { $gt: new Date(Date.now() - CLAIM_COOLDOWN_HOURS * 3600 * 1000) }
        }).sort({ claimedAt: -1 });

        if (recent) {
            const nextAt = new Date(recent.claimedAt.getTime() + CLAIM_COOLDOWN_HOURS * 3600 * 1000);
            const remainMin = Math.ceil((nextAt - Date.now()) / 60000);
            return res.status(429).json({
                error: `Bạn đã lấy key rồi. Thử lại sau ${remainMin} phút.`,
                nextClaimAt: nextAt
            });
        }

        const key = await allocateKey(`ip:${ip}`, {
            plan: 'TRIAL',
            durationHours: TRIAL_DURATION_HOURS,
            note: `Trial claim từ ${ip}`
        });

        if (!key) {
            return res.status(503).json({
                error: 'Đã hết key dùng thử. Vui lòng quay lại sau.'
            });
        }

        await TrialClaim.create({
            ip,
            contact: contact || null,
            keyValue: key.key,
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        res.json({
            success: true,
            key: key.key,
            durationHours: TRIAL_DURATION_HOURS,
            message: `Key dùng thử ${TRIAL_DURATION_HOURS} giờ. Vào trang chủ nhập key để xem phim.`,
            websiteUrl: '/'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.stats = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [totalClaims, todayClaims, uniqueIPs] = await Promise.all([
            TrialClaim.countDocuments(),
            TrialClaim.countDocuments({ claimedAt: { $gte: today } }),
            TrialClaim.distinct('ip').then(arr => arr.length)
        ]);

        res.json({ totalClaims, todayClaims, uniqueIPs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

function getClientIP(req) {
    // app.set('trust proxy', 1) đã bật -> req.ip là IP thật phía sau proxy của Render
    // (không đọc thẳng x-forwarded-for vì client có thể tự giả mạo để né giới hạn 24h)
    return req.ip || req.socket.remoteAddress || 'unknown';
}
