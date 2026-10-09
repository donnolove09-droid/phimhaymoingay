const { Telegraf, Markup } = require('telegraf');
const Order = require('../models/Order');
const TelegramUser = require('../models/TelegramUser');
const TrialToken = require('../models/TrialToken');
const trialTokenCtrl = require('../controllers/trialTokenController');
const PLANS = require('../config/plans');

let bot = null;

/* ---------- tiện ích ---------- */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const formatPrice = p => (p === 0 ? 'Miễn phí' : p.toLocaleString('vi-VN') + 'đ');
const isAdmin = ctx => !!process.env.TELEGRAM_ADMIN_CHAT_ID && String(ctx.from?.id) === String(process.env.TELEGRAM_ADMIN_CHAT_ID);
const paidPlans = () => Object.entries(PLANS).filter(([, p]) => p.price > 0);

// Callback query cũ (vd. bấm nút sau khi Render vừa thức dậy) làm answerCbQuery ném lỗi
// -> bản cũ dừng luôn handler nên nút "chết". Giờ nuốt lỗi này.
const ack = ctx => ctx.answerCbQuery().catch(() => {});

async function safeEdit(ctx, text, extra = {}) {
    try {
        return await ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
    } catch (e) {
        if (/message is not modified/i.test(e.message)) return;
        return ctx.reply(text, { parse_mode: 'HTML', ...extra });   // tin nhắn ảnh/quá cũ không sửa được
    }
}

async function upsertUser(ctx) {
    const from = ctx.from;
    if (!from) return null;
    try {
        return await TelegramUser.findOneAndUpdate(
            { chatId: String(from.id) },
            {
                chatId: String(from.id),
                username: from.username,
                firstName: from.first_name,
                lastName: from.last_name,
                lastInteraction: new Date()
            },
            { upsert: true, new: true }
        );
    } catch (e) {
        console.error('[telegram] upsertUser:', e.message);   // lỗi DB không được chặn bot trả lời
        return null;
    }
}

/** Gửi tin nhắn tới 1 chat (dùng từ controller). Không bao giờ ném lỗi. */
async function notify(chatId, html, extra = {}) {
    const b = getBot();
    if (!b || !chatId) return false;
    try {
        await b.telegram.sendMessage(chatId, html, { parse_mode: 'HTML', ...extra });
        return true;
    } catch (e) {
        console.error(`[telegram] gửi tin tới ${chatId} lỗi:`, e.message);
        return false;
    }
}

function paymentMethods() {
    const m = [];
    if (process.env.BANK_ID && process.env.BANK_ACCOUNT) m.push(['vietqr', 'VietQR (chuyển khoản)']);
    if (process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET) m.push(['vnpay', 'VNPay']);
    if (process.env.MOMO_PARTNER_CODE && process.env.MOMO_SECRET_KEY) m.push(['momo', 'MoMo']);
    return m;
}

function mainMenu() {
    const buttons = paidPlans().map(([code, p]) => [
        Markup.button.callback(`${p.emoji} ${p.name} — ${p.durationHours}h — ${formatPrice(p.price)}`, `buy_${code}`)
    ]);
    buttons.push([Markup.button.callback('🎁 Lấy key dùng thử miễn phí', 'trial_free')]);
    buttons.push([Markup.button.callback('🔑 Key của tôi', 'my_keys')]);
    return Markup.inlineKeyboard(buttons);
}

/* ---------- /getkeyfree (dùng chung cho lệnh và nút bấm) ---------- */
async function handleGetKeyFree(ctx) {
    await upsertUser(ctx);
    const chatId = String(ctx.from.id);
    const loading = await ctx.reply('Đang tạo link lấy key...');

    try {
        const result = await trialTokenCtrl.createToken(chatId, ctx.from.username || '');
        await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});

        if (!result.success) {
            if (result.reason === 'cooldown') {
                return ctx.replyWithHTML(
                    `<b>Bạn đã lấy key hôm nay rồi</b>\n\nVui lòng thử lại sau <b>${result.remainMin} phút</b>.\n\nMỗi người chỉ được lấy 1 key mỗi 24 giờ.`
                );
            }
            if (result.reason === 'out_of_stock') {
                return ctx.replyWithHTML('<b>Đã hết key dùng thử</b>\n\nVui lòng quay lại sau hoặc liên hệ admin.');
            }
            return ctx.reply('Không thể tạo link, vui lòng thử lại sau.');
        }

        const expiresInMin = Math.max(1, Math.floor((new Date(result.expiresAt) - Date.now()) / 60000));
        const text =
            `<b>Link lấy key dùng thử của bạn</b>\n\n` +
            `Bấm nút bên dưới để nhận key miễn phí.\n\n` +
            `Lưu ý:\n` +
            `- Link chỉ dùng được <b>1 lần</b>\n` +
            `- Hết hạn sau <b>${expiresInMin} phút</b>\n` +
            `- Key dùng được <b>1 giờ</b> xem phim\n` +
            `- Mỗi người lấy được 1 key / 24h`;

        // Telegram từ chối nút URL không phải https (vd. chưa cấu hình PUBLIC_URL) -> gửi link dạng chữ
        if (/^https:\/\//i.test(result.url)) {
            await ctx.replyWithHTML(text, Markup.inlineKeyboard([
                [Markup.button.url('Lấy key ngay', result.url)],
                [Markup.button.callback('Kiểm tra trạng thái', 'check_trial_status')]
            ]));
        } else {
            await ctx.replyWithHTML(`${text}\n\n${esc(result.url)}`);
        }
    } catch (e) {
        console.error('[telegram] getkeyfree:', e);
        await ctx.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
        await ctx.reply('Có lỗi xảy ra, vui lòng thử lại sau.').catch(() => {});
    }
}

/* ---------- đăng ký handler ---------- */
function registerHandlers(b) {
    // Mọi lỗi trong handler được ghi log + báo người dùng, KHÔNG làm webhook trả 500
    // (nếu trả 500 Telegram sẽ gửi lại update liên tục).
    b.catch((err, ctx) => {
        console.error(`[telegram] lỗi khi xử lý ${ctx?.updateType}:`, err);
        ctx?.reply?.('Có lỗi xảy ra, vui lòng thử lại sau.').catch(() => {});
    });

    b.start(async ctx => {
        await upsertUser(ctx);
        await ctx.replyWithHTML(
            `<b>Chào mừng đến PhimHay</b>\n\n` +
            `Bot giúp bạn nhận key xem phim.\n\n` +
            `<b>Lệnh chính:</b>\n` +
            `/getkeyfree - Lấy key dùng thử miễn phí\n` +
            `/menu - Xem các gói trả phí\n` +
            `/mykeys - Key đã nhận\n` +
            `/help - Trợ giúp`,
            mainMenu()
        );
    });

    b.command('menu', async ctx => {
        await upsertUser(ctx);
        await ctx.replyWithHTML('<b>Chọn gói:</b>', mainMenu());
    });

    b.command('help', ctx => ctx.replyWithHTML(
        `<b>Hướng dẫn</b>\n\n` +
        `/getkeyfree - Lấy key dùng thử 1 giờ miễn phí\n` +
        `/menu - Xem các gói trả phí\n` +
        `/mykeys - Key đã nhận\n\n` +
        `Mỗi người lấy được 1 key dùng thử / 24h`
    ));

    b.command('getkeyfree', handleGetKeyFree);

    b.action('trial_free', async ctx => {
        await ack(ctx);
        return handleGetKeyFree(ctx);        // gọi thẳng, không giả lập update như bản cũ
    });

    b.command('mykeys', async ctx => {
        await upsertUser(ctx);
        const chatId = String(ctx.from.id);
        const [orders, trials] = await Promise.all([
            Order.find({ chatId, status: 'delivered' }).sort({ deliveredAt: -1 }).limit(10),
            TrialToken.find({ chatId, isUsed: true, keyIssued: { $exists: true } }).sort({ usedAt: -1 }).limit(5)
        ]);
        if (!orders.length && !trials.length) return ctx.replyWithHTML('Chưa có key nào. Gõ /menu để mua hoặc /getkeyfree để lấy key dùng thử.');

        let msg = '<b>Key đã nhận:</b>\n\n';
        for (const t of trials) {
            msg += `<b>Dùng thử</b>\n<code>${esc(t.keyIssued)}</code>\nNhận: ${new Date(t.usedAt).toLocaleString('vi-VN')}\nThời hạn: 1h\n\n`;
        }
        for (const o of orders) {
            msg += `<b>${esc(PLANS[o.plan]?.name || o.plan)}</b>\n<code>${esc(o.keyValue)}</code>\n`;
            msg += `Nhận: ${new Date(o.deliveredAt).toLocaleString('vi-VN')}\nThời hạn: ${o.durationHours}h\n\n`;
        }
        await ctx.replyWithHTML(msg);
    });

    b.action('my_keys', async ctx => {
        await ack(ctx);
        await ctx.replyWithHTML('Gõ /mykeys để xem danh sách key.');
    });

    b.action('check_trial_status', async ctx => {
        await ack(ctx);
        const chatId = String(ctx.from.id);
        const last = await TrialToken.findOne({ chatId, isUsed: true }).sort({ usedAt: -1 });
        if (!last) return ctx.replyWithHTML('Bạn chưa lấy key nào.\nGõ /getkeyfree để lấy key dùng thử.');

        const remainMin = Math.ceil((new Date(last.usedAt).getTime() + 24 * 3600 * 1000 - Date.now()) / 60000);
        if (remainMin > 0) {
            return ctx.replyWithHTML(
                `<b>Key gần nhất</b>\n\nKey: <code>${esc(last.keyIssued)}</code>\n` +
                `Lấy lúc: ${new Date(last.usedAt).toLocaleString('vi-VN')}\n\nCó thể lấy key mới sau <b>${remainMin} phút</b>.`
            );
        }
        await ctx.replyWithHTML(`<b>Key gần nhất</b>\n\nKey: <code>${esc(last.keyIssued)}</code>\n\nBạn đã có thể lấy key mới.\nGõ /getkeyfree để lấy.`);
    });

    /* ----- mua gói ----- */
    b.action(/^buy_(.+)$/, async ctx => {
        await ack(ctx);
        await upsertUser(ctx);
        const planCode = ctx.match[1];
        const plan = PLANS[planCode];
        if (!plan) return ctx.reply('Gói không tồn tại');
        if (plan.price === 0) return handleGetKeyFree(ctx);      // gói free luôn đi qua cooldown 24h

        const methods = paymentMethods();
        if (!methods.length) {
            return ctx.reply('Hiện chưa mở thanh toán tự động. Vui lòng liên hệ admin để mua key.');
        }
        const rows = methods.map(([id, label]) => [Markup.button.callback(label, `pay_${id}_${planCode}`)]);
        rows.push([Markup.button.callback('Quay lại', 'back_menu')]);

        await safeEdit(ctx,
            `<b>${plan.emoji} ${esc(plan.name)}</b>\n\nThời hạn: <b>${plan.durationHours}h</b>\nGiá: <b>${formatPrice(plan.price)}</b>\n\nChọn phương thức:`,
            Markup.inlineKeyboard(rows)
        );
    });

    b.action('back_menu', async ctx => {
        await ack(ctx);
        await safeEdit(ctx, '<b>Chọn gói:</b>', mainMenu());
    });

    b.action(/^pay_(vietqr|vnpay|momo)_(.+)$/, async ctx => {
        await ack(ctx);
        const [, method, planCode] = ctx.match;
        const plan = PLANS[planCode];
        if (!plan || plan.price === 0) return ctx.reply('Gói không tồn tại');

        const payment = require('../controllers/paymentController');
        const chatId = String(ctx.from.id);
        await safeEdit(ctx, 'Đang tạo đơn hàng...');

        try {
            if (method === 'vietqr') {
                const { order, qrUrl, bankInfo } = await payment.createVietQROrder({ plan: planCode, chatId });
                const caption =
                    `<b>Đơn ${order.orderCode}</b>\n\nGói: <b>${esc(plan.name)}</b>\nSố tiền: <b>${formatPrice(plan.price)}</b>\n\n` +
                    `<b>Chuyển khoản:</b>\nNH: <code>${esc(bankInfo.bankId)}</code>\nSTK: <code>${esc(bankInfo.account)}</code>\n` +
                    `Chủ TK: <code>${esc(bankInfo.accountName)}</code>\nNội dung: <code>${order.orderCode}</code>\n\n` +
                    `Quét QR hoặc chuyển khoản đúng nội dung.\nBot sẽ tự gửi key sau khi nhận tiền.`;
                await ctx.deleteMessage().catch(() => {});
                try {
                    await ctx.replyWithPhoto(qrUrl, { caption, parse_mode: 'HTML' });
                } catch (e) {
                    console.error('[telegram] gửi QR lỗi:', e.message);
                    await ctx.replyWithHTML(caption);         // vẫn có đủ thông tin chuyển khoản
                }
            } else if (method === 'vnpay') {
                const { order, payUrl } = await payment.createVNPayOrder({ plan: planCode, chatId });
                await safeEdit(ctx,
                    `<b>Đơn ${order.orderCode}</b>\n\nGói: <b>${esc(plan.name)}</b>\nSố tiền: <b>${formatPrice(plan.price)}</b>\n\nBấm để thanh toán:`,
                    Markup.inlineKeyboard([[Markup.button.url('Thanh toán VNPay', payUrl)]])
                );
            } else {
                const { order, payUrl, qrCodeUrl } = await payment.createMoMoOrder({ plan: planCode, chatId });
                const caption = `<b>Đơn ${order.orderCode}</b>\n\nGói: <b>${esc(plan.name)}</b>\nSố tiền: <b>${formatPrice(plan.price)}</b>\n\nBấm nút để thanh toán MoMo`;
                const kb = Markup.inlineKeyboard([[Markup.button.url('Mở MoMo', payUrl)]]);
                await ctx.deleteMessage().catch(() => {});
                await ctx.replyWithHTML(caption, kb);
            }
        } catch (e) {
            console.error('[telegram] tạo đơn lỗi:', e.response?.data || e.message);
            await safeEdit(ctx, 'Không tạo được đơn: ' + esc(e.status ? e.message : 'lỗi hệ thống, thử lại sau'));
        }
    });

    /* ----- lệnh admin ----- */
    b.command('stats', async ctx => {
        if (!isAdmin(ctx)) return;
        const AccessKey = require('../models/AccessKey');
        const { AVAILABLE } = require('../services/keys');
        const [total, used, unused, pending, delivered] = await Promise.all([
            AccessKey.countDocuments(),
            AccessKey.countDocuments({ isUsed: true }),
            AccessKey.countDocuments(AVAILABLE),
            Order.countDocuments({ status: 'pending' }),
            Order.countDocuments({ status: 'delivered' })
        ]);
        await ctx.replyWithHTML(
            `<b>Thống kê</b>\n\nKey tổng: <b>${total}</b>\nCòn trong kho: <b>${unused}</b>\nĐã dùng: <b>${used}</b>\n\nĐơn chờ: <b>${pending}</b>\nĐơn giao: <b>${delivered}</b>`
        );
    });

    b.command('confirm', async ctx => {
        if (!isAdmin(ctx)) return;
        const orderCode = ctx.message.text.split(/\s+/)[1];
        if (!orderCode) return ctx.reply('Dùng: /confirm <orderCode>');

        const order = await Order.findOne({ orderCode });
        if (!order) return ctx.reply('Không tìm thấy');
        if (order.status === 'delivered') return ctx.reply('Đã giao rồi');

        order.status = 'paid';
        order.paidAt = new Date();
        await order.save();

        const { deliverKey } = require('../controllers/paymentController');
        const done = await deliverKey(order);
        ctx.reply(done ? `Đã xác nhận và gửi key cho đơn ${orderCode}` : `Đã xác nhận ${orderCode} nhưng HẾT KEY, chưa giao được`);
    });
}

function getBot() {
    if (bot) return bot;
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) return null;                 // không có token -> tắt bot, KHÔNG làm sập server
    bot = new Telegraf(token, { handlerTimeout: 60000 });
    registerHandlers(bot);
    return bot;
}

module.exports = { getBot, notify, esc };
