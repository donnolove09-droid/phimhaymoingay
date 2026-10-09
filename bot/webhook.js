const crypto = require('crypto');
const { getBot } = require('./index');
const { publicUrl } = require('../config/env');

const token = () => (process.env.TELEGRAM_BOT_TOKEN || '').trim();
// KHÔNG đặt token vào URL: token có dấu ':' mà Express hiểu là tham số route -> route không khớp.
// Dùng hash của token làm đường dẫn: ổn định giữa các lần deploy, không lộ token.
const hookPath = () => `/api/telegram/webhook/${crypto.createHash('sha256').update('tg-path:' + token()).digest('hex').slice(0, 32)}`;

// Secret để chắc chắn request tới webhook đúng là từ Telegram
const secretToken = () => crypto.createHash('sha256').update('tg-hook:' + token()).digest('hex');

/** Gắn route nhận update từ Telegram. Gọi SAU express.json(). */
function setupWebhook(app) {
    if (!getBot()) {
        console.warn('[telegram] Không có TELEGRAM_BOT_TOKEN -> bot tắt');
        return;
    }
    app.post(hookPath(), (req, res) => {
        if (req.get('x-telegram-bot-api-secret-token') !== secretToken()) return res.sendStatus(403);
        res.sendStatus(200);                                   // trả lời Telegram ngay, xử lý nền
        getBot().handleUpdate(req.body).catch(e => console.error('[telegram] handleUpdate:', e.message));
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Đăng ký webhook với Telegram (có retry vì lúc mới deploy mạng/DNS có thể chưa sẵn sàng). */
async function registerWebhook() {
    const bot = getBot();
    if (!bot) return { ok: false, error: 'Chưa đặt TELEGRAM_BOT_TOKEN' };
    const base = publicUrl();
    if (!/^https:\/\//i.test(base)) return { ok: false, error: 'PUBLIC_URL phải là https (Render tự đặt RENDER_EXTERNAL_URL)' };

    const url = base + hookPath();
    let lastErr;
    for (let i = 1; i <= 4; i++) {
        try {
            await bot.telegram.setWebhook(url, {
                secret_token: secretToken(),
                allowed_updates: ['message', 'callback_query'],
                max_connections: 20
            });
            await bot.telegram.setMyCommands([
                { command: 'getkeyfree', description: 'Lấy key dùng thử miễn phí' },
                { command: 'menu', description: 'Xem các gói trả phí' },
                { command: 'mykeys', description: 'Key đã nhận' },
                { command: 'help', description: 'Trợ giúp' }
            ]).catch(() => {});
            console.log('[telegram] Webhook đã đặt:', base + '/api/telegram/webhook/***');
            return { ok: true, url: base + '/api/telegram/webhook/***' };
        } catch (e) {
            lastErr = e;
            console.error(`[telegram] setWebhook lần ${i} lỗi:`, e.message);
            await sleep(2000 * i);
        }
    }
    return { ok: false, error: lastErr?.message };
}

/** Khởi động bot: webhook nếu có URL public, ngược lại polling (chạy local). */
async function startBot() {
    const bot = getBot();
    if (!bot) return { mode: 'off' };

    if (/^https:\/\//i.test(publicUrl())) {
        const r = await registerWebhook();
        return { mode: 'webhook', ...r };
    }

    // Local: không có https public -> dùng long polling
    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        bot.launch().catch(e => console.error('[telegram] polling dừng:', e.message));
        console.log('[telegram] Chạy chế độ polling (local)');
        return { mode: 'polling', ok: true };
    } catch (e) {
        console.error('[telegram] không khởi động được polling:', e.message);
        return { mode: 'polling', ok: false, error: e.message };
    }
}

module.exports = { setupWebhook, registerWebhook, startBot };
