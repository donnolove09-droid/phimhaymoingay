const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Otp = require('../models/Otp');
const mailer = require('../services/mailer');

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_S = 60;
const MAX_ATTEMPTS = 5;

const isProd = () => process.env.NODE_ENV === 'production';
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const genOtp = () => String(crypto.randomInt(100000, 1000000));
const hashOtp = (email, code) =>
    crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(`${email}:${code}`).digest('hex');

function signToken(user) {
    return jwt.sign(
        { userId: user._id.toString(), username: user.username, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );
}

const publicUser = u => ({ id: u._id, email: u.email, username: u.username, role: u.role });

/**
 * Tạo OTP mới và gửi mail.
 * Trả về { ok:true } | { ok:false, status, error, code, wait? }
 */
async function issueOtp(email) {
    const last = await Otp.findOne({ email, used: false }).sort({ createdAt: -1 });
    if (last) {
        const wait = RESEND_COOLDOWN_S - Math.floor((Date.now() - last.createdAt.getTime()) / 1000);
        if (wait > 0) return { ok: false, status: 429, code: 'COOLDOWN', wait, error: `Vui lòng đợi ${wait}s rồi gửi lại mã` };
    }

    const code = genOtp();
    await Otp.deleteMany({ email, used: false });
    const doc = await Otp.create({
        email, codeHash: hashOtp(email, code), type: 'register',
        expiresAt: new Date(Date.now() + OTP_TTL_MS)
    });

    try {
        const via = await mailer.sendOtpEmail(email, code);
        console.log(`[otp] đã gửi mail OTP tới ${email} qua ${via}`);
        return { ok: true };
    } catch (e) {
        if (e.code === 'MAIL_NOT_CONFIGURED' && !isProd()) {
            // Chạy local chưa cấu hình mail: in OTP ra console để vẫn test được
            console.warn(`[otp][DEV] Chưa cấu hình mail. OTP của ${email} = ${code}`);
            return { ok: true, dev: true };
        }
        await doc.deleteOne().catch(() => {});
        console.error('[otp] Gửi mail thất bại:', mailer.describeError(e));
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return { ok: false, status: 503, code: 'MAIL_NOT_CONFIGURED', error: 'Máy chủ chưa cấu hình gửi email. Liên hệ admin.' };
        }
        return { ok: false, status: 502, code: 'MAIL_FAILED', error: 'Không gửi được email OTP. Kiểm tra lại địa chỉ email hoặc thử lại sau.' };
    }
}

exports.register = async (req, res) => {
    let { email, username, password } = req.body || {};
    email = String(email || '').trim().toLowerCase();
    username = String(username || '').trim();
    password = String(password || '');

    if (!email || !username || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' });
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
        return res.status(400).json({ error: 'Username 3-30 ký tự: chữ, số, _ . - (không dấu, không khoảng trắng)' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu từ 6 ký tự' });
    if (password.length > 72) return res.status(400).json({ error: 'Mật khẩu tối đa 72 ký tự' });

    const usernameRe = new RegExp(`^${escapeRegex(username)}$`, 'i');
    const conflicts = await User.find({ $or: [{ email }, { username: usernameRe }] });

    for (const u of conflicts) {
        if (u.isVerified) {
            return res.status(409).json({
                error: u.email === email ? 'Email này đã được đăng ký' : 'Username này đã có người dùng'
            });
        }
    }
    // Các bản ghi chưa xác thực (đăng ký dở) -> xoá hết rồi tạo lại.
    // Bản cũ chỉ xoá 1 bản ghi nên dễ dính lỗi trùng username (E11000) -> báo nhầm "lỗi gửi email".
    if (conflicts.length) await User.deleteMany({ _id: { $in: conflicts.map(u => u._id) } });

    const user = await User.create({ email, username, password, isVerified: false });

    const sent = await issueOtp(email);
    if (!sent.ok) {
        await user.deleteOne().catch(() => {});      // để người dùng đăng ký lại được ngay
        return res.status(sent.status).json({ error: sent.error, code: sent.code });
    }
    res.json({ success: true, message: 'OTP đã gửi đến email', email, resendIn: RESEND_COOLDOWN_S });
};

exports.verifyOtp = async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Mã OTP gồm 6 chữ số' });

    const otp = await Otp.findOne({ email, used: false }).sort({ createdAt: -1 });
    if (!otp) return res.status(400).json({ error: 'Không có mã OTP hợp lệ. Hãy bấm "Gửi lại".' });
    if (otp.expiresAt < new Date()) return res.status(400).json({ error: 'Mã OTP đã hết hạn. Hãy bấm "Gửi lại".' });

    if (otp.attempts >= MAX_ATTEMPTS) {
        otp.used = true;
        await otp.save();
        return res.status(429).json({ error: 'Nhập sai quá nhiều lần. Hãy bấm "Gửi lại" để nhận mã mới.' });
    }

    const a = Buffer.from(hashOtp(email, code));
    const b = Buffer.from(otp.codeHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        otp.attempts += 1;
        await otp.save();
        return res.status(400).json({ error: `Mã OTP không đúng (còn ${Math.max(0, MAX_ATTEMPTS - otp.attempts)} lần thử)` });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản. Hãy đăng ký lại.' });

    otp.used = true;
    await otp.save();
    user.isVerified = true;
    user.lastLogin = new Date();
    await user.save();

    res.json({ success: true, token: signToken(user), user: publicUser(user) });
};

exports.login = async (req, res) => {
    const id = String(req.body?.emailOrUsername || '').trim();
    const password = String(req.body?.password || '');
    if (!id || !password) return res.status(400).json({ error: 'Thiếu thông tin' });

    const user = await User.findOne({
        $or: [{ email: id.toLowerCase() }, { username: id }]
    }) || await User.findOne({ username: new RegExp(`^${escapeRegex(id)}$`, 'i') });

    if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    }
    if (!user.isVerified) {
        return res.status(403).json({
            error: 'Tài khoản chưa xác thực email. Nhập mã OTP để hoàn tất.',
            code: 'NOT_VERIFIED',
            email: user.email
        });
    }

    user.lastLogin = new Date();
    await user.save();
    res.json({ success: true, token: signToken(user), user: publicUser(user) });
};

exports.resendOtp = async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Thiếu email' });

    const user = await User.findOne({ email, isVerified: false });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản chưa xác thực' });

    const sent = await issueOtp(email);
    if (!sent.ok) return res.status(sent.status).json({ error: sent.error, code: sent.code, wait: sent.wait });
    res.json({ success: true, message: 'Đã gửi lại OTP', resendIn: RESEND_COOLDOWN_S });
};

exports.me = async (req, res) => {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(user);
};
