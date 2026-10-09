require('dotenv').config();
require('./utils/asyncPatch');          // phải đứng trước mọi khai báo route

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const { validateEnv, publicUrl } = require('./config/env');
const mailer = require('./services/mailer');

const { problems, warnings } = validateEnv();
warnings.forEach(w => console.warn('[config] ⚠', w));
if (problems.length) {
    problems.forEach(p => console.error('[config] ✖', p));
    console.error('Dừng server vì thiếu cấu hình bắt buộc. Xem README_RENDER.md');
    process.exit(1);
}

const app = express();
app.set('trust proxy', 1);              // Render đứng sau proxy -> có IP thật, rate-limit chạy đúng
app.disable('x-powered-by');
app.use(cors());

// Health check đặt TRƯỚC mọi thứ để Render luôn thấy server còn sống
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        services: {
            tmdb: !!process.env.TMDB_API_KEY,
            telegram: !!process.env.TELEGRAM_BOT_TOKEN,
            vietqr: !!process.env.BANK_ID,
            mail: mailer.provider() || false
        }
    });
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const { setupWebhook, startBot } = require('./bot/webhook');
setupWebhook(app);

const { checkAccess } = require('./controllers/accessController');

app.use('/api/access', require('./routes/access'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/trial', require('./routes/trial'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/comments', require('./routes/comments'));

app.use('/api/multi', checkAccess, require('./routes/multiApi'));
app.use('/api/tmdb', checkAccess, require('./routes/tmdb'));
app.use('/api/ophim', checkAccess, require('./routes/ophim'));
app.use('/api/phimapi', checkAccess, require('./routes/phimapi'));
app.use('/api/movies', checkAccess, require('./routes/movies'));

const customRouter = require('./routes/custom');
app.use('/api/custom', (req, res, next) => {
    if (req.path.startsWith('/admin')) return next();
    return checkAccess(req, res, next);
}, customRouter);

app.use(express.static(path.join(__dirname, 'public')));

const page = name => path.join(__dirname, 'public', name);
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    if (req.path.startsWith('/admin')) return res.sendFile(page('admin.html'));
    if (req.path.startsWith('/auth')) return res.sendFile(page('auth.html'));
    if (req.path.startsWith('/getkeyfree')) return res.sendFile(page('getkeyfree.html'));
    if (req.path.startsWith('/getkey')) return res.sendFile(page('getkey.html'));
    res.sendFile(page('index.html'));
});

// Bắt mọi lỗi từ handler (kể cả async) -> trả JSON thay vì treo/crash
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return;
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ' });
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    if (err.code === 11000) return res.status(409).json({ error: 'Dữ liệu bị trùng' });
    res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Lỗi máy chủ' : err.message });
});

process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));
process.on('uncaughtException', e => console.error('[uncaughtException]', e));

const PORT = process.env.PORT || 5000;

// Mở cổng NGAY (Render cần thấy port mở trong ~vài phút), kết nối Mongo song song.
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));

mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 })
    .then(async () => {
        console.log('MongoDB connected');
        const bot = await startBot();
        console.log('[telegram] mode:', bot.mode, bot.ok === false ? `(lỗi: ${bot.error})` : '');
        startKeepAlive();
    })
    .catch(e => {
        console.error('MongoDB lỗi kết nối:', e.message);
        console.error('→ Kiểm tra MONGO_URI và Network Access của Atlas (cho phép 0.0.0.0/0).');
        process.exit(1);
    });

/**
 * Render gói free ngủ sau 15 phút không có request. Bật KEEP_ALIVE=true để tự ping chính mình
 * mỗi 10 phút (giúp bot Telegram phản hồi nhanh hơn). Lưu ý: gói free có 750 giờ/tháng.
 */
function startKeepAlive() {
    if (process.env.KEEP_ALIVE !== 'true') return;
    const url = publicUrl();
    if (!url) return;
    setInterval(() => {
        require('axios').get(`${url}/api/health`, { timeout: 10000 }).catch(() => {});
    }, 10 * 60 * 1000).unref();
    console.log('[keep-alive] bật, ping', url);
}

function shutdown(sig) {
    console.log(`${sig} -> tắt server`);
    server.close(() => mongoose.connection.close(false).finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
