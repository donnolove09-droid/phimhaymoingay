/**
 * Gửi email OTP.
 *
 * VÌ SAO OTP KHÔNG VỀ TRÊN RENDER?
 * Render (gói free) CHẶN các cổng SMTP đi ra (25/465/587). Code cũ dùng
 * nodemailer + Gmail SMTP nên sẽ treo rồi timeout -> không bao giờ gửi được.
 * Giải pháp: gửi qua HTTP API (cổng 443, không bị chặn).
 *
 * Thứ tự ưu tiên provider (đặt biến môi trường là tự dùng):
 *   1. BREVO_API_KEY   (+ MAIL_FROM)  -> khuyên dùng, free 300 mail/ngày, gửi cho mọi người nhận
 *   2. RESEND_API_KEY  (+ MAIL_FROM)  -> cần verify domain mới gửi được cho người khác
 *   3. SMTP            (SMTP_HOST/SMTP_USER/SMTP_PASS hoặc MAIL_USER/MAIL_PASS của Gmail)
 *                      -> chỉ chạy được khi host không chặn SMTP (VPS, máy local, Render trả phí)
 */
const axios = require('axios');
const nodemailer = require('nodemailer');

const FROM_NAME = process.env.MAIL_FROM_NAME || 'PhimHay';

function fromEmail() {
    return (process.env.MAIL_FROM || process.env.MAIL_USER || process.env.SMTP_USER || '').trim();
}

function provider() {
    if (process.env.BREVO_API_KEY) return 'brevo';
    if (process.env.RESEND_API_KEY) return 'resend';
    if (smtpConfig()) return 'smtp';
    return null;
}

function smtpConfig() {
    const user = process.env.SMTP_USER || process.env.MAIL_USER;
    // App password của Google hay bị copy kèm dấu cách: "abcd efgh ijkl mnop"
    const pass = (process.env.SMTP_PASS || process.env.MAIL_PASS || '').replace(/\s+/g, '');
    if (!user || !pass) return null;
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT) || 465;
    return { host, port, secure: port === 465, auth: { user, pass } };
}

let smtpTransport;
function getSmtp() {
    if (!smtpTransport) {
        smtpTransport = nodemailer.createTransport({
            ...smtpConfig(),
            family: 4,                 // tránh IPv6 treo trên một số host
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });
    }
    return smtpTransport;
}

function otpHtml(code) {
    return `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:30px;background:#141416;color:#f5f5f7;border-radius:10px">
  <h1 style="color:#e50914;text-align:center;margin:0 0 20px">PhimHay</h1>
  <h2 style="text-align:center;margin:0 0 20px">Xác thực email</h2>
  <p style="margin:0 0 20px">Mã OTP của bạn là:</p>
  <div style="background:#0a0a0b;border:2px dashed #e50914;border-radius:8px;padding:20px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px;color:#e50914">${code}</div>
  <p style="color:#9a9aa3;margin-top:20px;font-size:13px">Mã có hiệu lực trong <b style="color:#f5f5f7">5 phút</b>. Không chia sẻ mã này với bất kỳ ai.</p>
</div>`;
}

async function sendMail({ to, subject, html, text }) {
    const p = provider();
    const from = fromEmail();

    if (!p) {
        const err = new Error('MAIL_NOT_CONFIGURED');
        err.code = 'MAIL_NOT_CONFIGURED';
        throw err;
    }

    if (p === 'brevo') {
        if (!from) throw Object.assign(new Error('Thiếu MAIL_FROM (email người gửi đã verify trong Brevo)'), { code: 'MAIL_NOT_CONFIGURED' });
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: FROM_NAME, email: from },
            to: [{ email: to }],
            subject,
            htmlContent: html,
            textContent: text
        }, {
            headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
            timeout: 15000
        });
        return 'brevo';
    }

    if (p === 'resend') {
        if (!from) throw Object.assign(new Error('Thiếu MAIL_FROM'), { code: 'MAIL_NOT_CONFIGURED' });
        await axios.post('https://api.resend.com/emails', {
            from: `${FROM_NAME} <${from}>`,
            to: [to],
            subject,
            html,
            text
        }, {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            timeout: 15000
        });
        return 'resend';
    }

    await getSmtp().sendMail({
        from: `"${FROM_NAME}" <${from || smtpConfig().auth.user}>`,
        to, subject, html, text
    });
    return 'smtp';
}

async function sendOtpEmail(to, code) {
    return sendMail({
        to,
        subject: 'Mã xác thực PhimHay',
        html: otpHtml(code),
        text: `Mã OTP PhimHay của bạn là ${code}. Mã có hiệu lực trong 5 phút.`
    });
}

/** Rút gọn lỗi của provider thành 1 dòng dễ đọc trong log. */
function describeError(e) {
    const data = e.response?.data;
    if (data) return `${e.response.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`;
    return e.code ? `${e.code}: ${e.message}` : e.message;
}

module.exports = { sendMail, sendOtpEmail, provider, describeError };
