/** URL public của site. Render tự đặt RENDER_EXTERNAL_URL nên không cần khai PUBLIC_URL thủ công. */
function publicUrl() {
    return String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
}

/** Kiểm tra biến môi trường khi khởi động -> báo lỗi rõ ràng thay vì crash khó hiểu. */
function validateEnv() {
    const problems = [];
    const warnings = [];

    if (!process.env.MONGO_URI) problems.push('Thiếu MONGO_URI');
    if (!process.env.JWT_SECRET) problems.push('Thiếu JWT_SECRET (đăng nhập/key sẽ lỗi 500)');
    else if (process.env.JWT_SECRET.length < 24) warnings.push('JWT_SECRET quá ngắn, nên >= 32 ký tự');

    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) warnings.push('Chưa có ADMIN_USERNAME/ADMIN_PASSWORD -> không đăng nhập admin được');
    if (process.env.ADMIN_PASSWORD === 'DoiMatKhauManh123') warnings.push('ADMIN_PASSWORD vẫn là giá trị mẫu, hãy đổi!');

    const mail = require('../services/mailer').provider();
    if (!mail) warnings.push('Chưa cấu hình email (BREVO_API_KEY / RESEND_API_KEY / SMTP) -> OTP đăng ký sẽ KHÔNG gửi được');
    else if (mail === 'smtp' && process.env.RENDER) warnings.push('Đang dùng SMTP trên Render: Render chặn cổng SMTP, hãy dùng BREVO_API_KEY hoặc RESEND_API_KEY');

    if (!process.env.TELEGRAM_BOT_TOKEN) warnings.push('Chưa có TELEGRAM_BOT_TOKEN -> bot Telegram tắt');
    if (process.env.TELEGRAM_BOT_TOKEN && !publicUrl()) warnings.push('Không có PUBLIC_URL/RENDER_EXTERNAL_URL -> bot chạy chế độ polling');

    return { problems, warnings };
}

module.exports = { publicUrl, validateEnv };
