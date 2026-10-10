const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { requireUser } = require('../middleware/userAuth');

const limiter = (windowMin, max, message) => rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message }
});

// Chống spam gửi mail & dò mật khẩu / OTP
const registerLimit = limiter(15, 10, 'Đăng ký quá nhiều lần, thử lại sau ít phút');
const otpLimit = limiter(15, 20, 'Thử OTP quá nhiều lần, thử lại sau ít phút');
const loginLimit = limiter(15, 30, 'Đăng nhập sai quá nhiều lần, thử lại sau ít phút');

router.post('/register', registerLimit, ctrl.register);
router.post('/verify-otp', otpLimit, ctrl.verifyOtp);
router.post('/resend-otp', otpLimit, ctrl.resendOtp);
router.post('/login', loginLimit, ctrl.login);
router.get('/me', requireUser, ctrl.me);

module.exports = router;
