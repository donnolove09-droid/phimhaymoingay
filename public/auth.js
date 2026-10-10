const API = '/api';
const $ = id => document.getElementById(id);

let mode = 'login';
let pendingEmail = '';
let resendTimer = null;

// Gọi API an toàn: Render free "ngủ" nên request đầu có thể trả trang HTML 502/503 hoặc rất chậm
async function post(path, body) {
    let res;
    try {
        res = await fetch(`${API}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch {
        throw Object.assign(new Error('Không kết nối được máy chủ, thử lại sau ít giây'), {});
    }
    let data = {};
    try { data = await res.json(); } catch { /* không phải JSON */ }
    if (!res.ok) {
        const msg = data.error || (res.status >= 500 ? 'Máy chủ đang khởi động hoặc bận, thử lại sau ít giây' : 'Có lỗi xảy ra');
        throw Object.assign(new Error(msg), { code: data.code, email: data.email, wait: data.wait, status: res.status });
    }
    return data;
}

function startResendCooldown(sec) {
    clearInterval(resendTimer);
    const btn = $('btnResend');
    let left = sec;
    btn.disabled = true;
    const tick = () => {
        if (left <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = 'Gửi lại mã'; return; }
        btn.textContent = `Gửi lại mã (${left}s)`;
        left--;
    };
    tick();
    resendTimer = setInterval(tick, 1000);
}

function goOtp(email, wait) {
    pendingEmail = email;
    showState('Otp');
    startResendCooldown(wait || 60);
    const first = document.querySelector('.otp-input');
    if (first) first.focus();
}

function showState(name) {
    ['Form', 'Otp', 'Done'].forEach(s => {
        const el = $(`state${s}`);
        if (el) el.classList.add('hidden');
    });
    $(`state${name}`).classList.remove('hidden');
}

function setMode(m) {
    mode = m;
    $('tabLogin').classList.toggle('active', m === 'login');
    $('tabRegister').classList.toggle('active', m === 'register');
    $('pageTitle').textContent = m === 'login' ? 'Đăng nhập' : 'Đăng ký';
    $('pageDesc').textContent = m === 'login' ? 'Chào mừng trở lại PhimHay' : 'Tạo tài khoản mới';
    $('btnSubmit').textContent = m === 'login' ? 'Đăng nhập' : 'Đăng ký';
    $('emailGroup').style.display = m === 'register' ? 'block' : 'none';
    $('labelUser').textContent = m === 'login' ? 'Email hoặc username' : 'Username';
    $('inputUsername').placeholder = m === 'login' ? 'Nhập email hoặc username' : 'Tên đăng nhập';
    $('inputEmail').value = '';
    $('inputUsername').value = '';
    $('inputPassword').value = '';
    $('errorMsg').textContent = '';
    $('errorMsg').style.color = '#ff4757';
    showState('Form');
}

$('tabLogin').onclick = () => setMode('login');
$('tabRegister').onclick = () => setMode('register');

$('btnSubmit').onclick = async () => {
    $('errorMsg').textContent = '';
    $('errorMsg').style.color = '#ff4757';
    $('btnSubmit').disabled = true;
    $('btnSubmit').textContent = 'Đang xử lý...';

    try {
        if (mode === 'login') {
            const data = await post('/auth/login', {
                emailOrUsername: $('inputUsername').value.trim(),
                password: $('inputPassword').value
            });
            localStorage.setItem('phimhay_user_token', data.token);
            localStorage.setItem('phimhay_user', JSON.stringify(data.user));
            showState('Done');
            setTimeout(() => location.href = '/', 1200);
        } else {
            const data = await post('/auth/register', {
                email: $('inputEmail').value.trim(),
                username: $('inputUsername').value.trim(),
                password: $('inputPassword').value
            });
            goOtp(data.email, data.resendIn);
        }
    } catch (e) {
        if (e.code === 'NOT_VERIFIED' && e.email) {
            // Đăng ký dở dang: tự gửi lại OTP và chuyển sang bước nhập mã
            pendingEmail = e.email;
            try { const r = await post('/auth/resend-otp', { email: e.email }); goOtp(e.email, r.resendIn); }
            catch (e2) { if (e2.code === 'COOLDOWN') goOtp(e.email, e2.wait); else $('errorMsg').textContent = e2.message; }
        } else {
            $('errorMsg').textContent = e.message;
        }
    } finally {
        $('btnSubmit').disabled = false;
        $('btnSubmit').textContent = mode === 'login' ? 'Đăng nhập' : 'Đăng ký';
    }
};

document.querySelectorAll('.otp-input').forEach((input, idx, arr) => {
    input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 1);
        if (e.target.value && idx < arr.length - 1) arr[idx + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) arr[idx - 1].focus();
    });
    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        text.split('').forEach((c, i) => { if (arr[i]) arr[i].value = c; });
        if (text.length) arr[Math.min(text.length, 5)].focus();
    });
});

$('btnVerifyOtp').onclick = async () => {
    $('otpError').textContent = '';
    $('otpError').style.color = '#ff4757';
    const code = Array.from(document.querySelectorAll('.otp-input')).map(i => i.value).join('');
    if (code.length !== 6) { $('otpError').textContent = 'Nhập đủ 6 số'; return; }

    $('btnVerifyOtp').disabled = true;
    $('btnVerifyOtp').textContent = 'Đang xác thực...';
    try {
        const data = await post('/auth/verify-otp', { email: pendingEmail, code });
        localStorage.setItem('phimhay_user_token', data.token);
        localStorage.setItem('phimhay_user', JSON.stringify(data.user));
        showState('Done');
        setTimeout(() => location.href = '/', 1200);
    } catch (e) {
        $('otpError').textContent = e.message;
    } finally {
        $('btnVerifyOtp').disabled = false;
        $('btnVerifyOtp').textContent = 'Xác thực';
    }
};

$('btnResend').onclick = async () => {
    $('otpError').style.color = '#9a9aa3';
    $('otpError').textContent = 'Đang gửi lại...';
    try {
        const data = await post('/auth/resend-otp', { email: pendingEmail });
        $('otpError').style.color = '#22c55e';
        $('otpError').textContent = 'Đã gửi lại mã mới, kiểm tra cả mục Spam';
        startResendCooldown(data.resendIn || 60);
        document.querySelectorAll('.otp-input').forEach(i => { i.value = ''; });
    } catch (e) {
        $('otpError').style.color = '#ff4757';
        $('otpError').textContent = e.message;
        if (e.code === 'COOLDOWN') startResendCooldown(e.wait || 60);
    }
};

$('inputPassword').addEventListener('keypress', e => {
    if (e.key === 'Enter') $('btnSubmit').click();
});

(async () => {
    const tk = localStorage.getItem('phimhay_user_token');
    if (!tk) return;
    try {
        const r = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${tk}` } });
        if (r.ok) return void (location.href = '/');
    } catch { return; }
    // Token hết hạn/không hợp lệ: xoá để người dùng đăng nhập lại (bản cũ bị kẹt không vào được form)
    localStorage.removeItem('phimhay_user_token');
    localStorage.removeItem('phimhay_user');
})();

setMode('login');
$('tabRegister').onclick = () => setMode('register');

$('btnSubmit').onclick = async () => {
    $('errorMsg').textContent = '';
    $('errorMsg').style.color = '#ff4757';
    $('btnSubmit').disabled = true;
    $('btnSubmit').textContent = 'Đang xử lý...';

    try {
        if (mode === 'login') {
            const data = await post('/auth/login', {
                emailOrUsername: $('inputUsername').value.trim(),
                password: $('inputPassword').value
            });
            localStorage.setItem('phimhay_user_token', data.token);
            localStorage.setItem('phimhay_user', JSON.stringify(data.user));
            showState('Done');
            setTimeout(() => location.href = '/', 1200);
        } else {
            const data = await post('/auth/register', {
                email: $('inputEmail').value.trim(),
                username: $('inputUsername').value.trim(),
                password: $('inputPassword').value
            });
            goOtp(data.email, data.resendIn);
        }
    } catch (e) {
        if (e.code === 'NOT_VERIFIED' && e.email) {
            // Đăng ký dở dang: tự gửi lại OTP và chuyển sang bước nhập mã
            pendingEmail = e.email;
            try { const r = await post('/auth/resend-otp', { email: e.email }); goOtp(e.email, r.resendIn); }
            catch (e2) { if (e2.code === 'COOLDOWN') goOtp(e.email, e2.wait); else $('errorMsg').textContent = e2.message; }
        } else {
            $('errorMsg').textContent = e.message;
        }
    } finally {
        $('btnSubmit').disabled = false;
        $('btnSubmit').textContent = mode === 'login' ? 'Đăng nhập' : 'Đăng ký';
    }
};

document.querySelectorAll('.otp-input').forEach((input, idx, arr) => {
    input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 1);
        if (e.target.value && idx < arr.length - 1) arr[idx + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) arr[idx - 1].focus();
    });
    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        text.split('').forEach((c, i) => { if (arr[i]) arr[i].value = c; });
        if (text.length) arr[Math.min(text.length, 5)].focus();
    });
});

$('btnVerifyOtp').onclick = async () => {
    $('otpError').textContent = '';
    $('otpError').style.color = '#ff4757';
    const code = Array.from(document.querySelectorAll('.otp-input')).map(i => i.value).join('');
    if (code.length !== 6) { $('otpError').textContent = 'Nhập đủ 6 số'; return; }

    $('btnVerifyOtp').disabled = true;
    $('btnVerifyOtp').textContent = 'Đang xác thực...';
    try {
        const data = await post('/auth/verify-otp', { email: pendingEmail, code });
        localStorage.setItem('phimhay_user_token', data.token);
        localStorage.setItem('phimhay_user', JSON.stringify(data.user));
        showState('Done');
        setTimeout(() => location.href = '/', 1200);
    } catch (e) {
        $('otpError').textContent = e.message;
    } finally {
        $('btnVerifyOtp').disabled = false;
        $('btnVerifyOtp').textContent = 'Xác thực';
    }
};

$('btnResend').onclick = async () => {
    $('otpError').style.color = '#9a9aa3';
    $('otpError').textContent = 'Đang gửi lại...';
    try {
        const data = await post('/auth/resend-otp', { email: pendingEmail });
        $('otpError').style.color = '#22c55e';
        $('otpError').textContent = 'Đã gửi lại mã mới, kiểm tra cả mục Spam';
        startResendCooldown(data.resendIn || 60);
        document.querySelectorAll('.otp-input').forEach(i => { i.value = ''; });
    } catch (e) {
        $('otpError').style.color = '#ff4757';
        $('otpError').textContent = e.message;
        if (e.code === 'COOLDOWN') startResendCooldown(e.wait || 60);
    }
};

$('inputPassword').addEventListener('keypress', e => {
    if (e.key === 'Enter') $('btnSubmit').click();
});

if (localStorage.getItem('phimhay_user_token')) {
    location.href = '/';
}

setMode('login');
