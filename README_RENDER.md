# Triển khai PhimHay lên Render

## 1. Chuẩn bị (làm 1 lần)

**MongoDB Atlas** → Network Access → *Add IP Address* → `0.0.0.0/0` (Render không có IP cố định).
Copy chuỗi kết nối vào `MONGO_URI`.

**Email OTP – dùng Brevo** (Render chặn SMTP nên Gmail SMTP không bao giờ gửi được):
1. Đăng ký https://www.brevo.com (miễn phí 300 mail/ngày).
2. *SMTP & API → API Keys* → tạo key → dán vào `BREVO_API_KEY`.
3. *Senders, Domains & Dedicated IPs → Senders* → thêm email của bạn, bấm link xác minh trong mail.
4. Đặt `MAIL_FROM` = đúng email vừa xác minh.

**Telegram**: tạo bot ở @BotFather → `TELEGRAM_BOT_TOKEN`. Lấy chat id của bạn ở @userinfobot → `TELEGRAM_ADMIN_CHAT_ID`.

## 2. Deploy
1. Đẩy code lên GitHub (**KHÔNG commit `data/keys.txt`** – đã có trong `.gitignore`).
2. Render → *New → Blueprint* → chọn repo (dùng `render.yaml`), hoặc *New → Web Service*:
   Build `npm install`, Start `npm start`, Health check `/api/health`.
3. Điền các biến môi trường (xem `.env.example`). **Không cần `PUBLIC_URL`** – Render tự có `RENDER_EXTERNAL_URL`, bot tự đặt webhook.
4. Nhập key: chạy `npm run import-keys` ở máy local (trỏ cùng `MONGO_URI`) hoặc dùng trang admin.

## 3. Kiểm tra sau khi deploy (đăng nhập admin lấy token, rồi gọi)
| Việc | Gọi |
|---|---|
| Server/Mongo/mail | `GET /api/health` |
| Gửi thử email OTP | `POST /api/admin/mail/test` body `{"to":"email@cua.ban"}` |
| Trạng thái bot + lỗi webhook | `GET /api/admin/telegram/status` |
| Đặt lại webhook | `POST /api/admin/telegram/set-webhook` |
| Các nguồn phim còn sống | `GET /api/multi/sources/health` |
(Header: `Authorization: Bearer <token admin>`)

## 4. Thêm nguồn phim mới (không cần sửa code)
Có sẵn: `kkphim`, `ophim`, `nguonc`, `vsphim`. Thêm nguồn bằng biến môi trường:
```
EXTRA_SOURCES=[{"id":"abc","name":"ABC Phim","base":"https://abc.example/api","preset":"ophim"}]
```
`preset` = kiểu API: `ophim` (đa số web dùng OPhim-core), `kkphim`, hoặc `nguonc`. Nguồn nào chết sẽ tự bị tạm bỏ qua 5 phút, không làm chậm trang. Tắt nguồn: `DISABLED_SOURCES=vsphim`.

## 5. Thêm phim bằng link
Dán link vào ô *URL video* – hệ thống tự nhận diện: `.m3u8` (HLS), `.mp4/.webm`, YouTube, Google Drive, Vimeo, hoặc link embed. Phim bộ: nhập link ở từng tập, để trống URL chính.
Lưu ý: Render không lưu file upload lâu dài, nên video phải nằm ở host riêng (link trực tiếp). Link m3u8/mp4 chỉ phát được nếu host cho phép CORS/hotlink; nếu không, trình phát tự thử link dự phòng và hiện nút "Mở link trực tiếp".

## Lưu ý Render free
Server ngủ sau 15 phút không có truy cập (request đầu mất ~30-50s). `KEEP_ALIVE=true` giúp giữ thức; gói free có 750 giờ/tháng.
