const API = '/api';
const $ = id => document.getElementById(id);

let token = null;

function showState(name) {
    ['Loading', 'Ready', 'Processing', 'Success', 'Error'].forEach(s => {
        $(`state${s}`).classList.add('hidden');
    });
    $(`state${name}`).classList.remove('hidden');
}

function showError(title, message, showAltLink = true) {
    $('errorTitle').textContent = title;
    $('errorMessage').textContent = message;
    showState('Error');
    if (!showAltLink) {
        const alt = document.querySelector('a[href="/getkey"]');
        if (alt) alt.style.display = 'none';
    }
}

async function verifyToken() {
    const params = new URLSearchParams(window.location.search);
    token = params.get('token');

    if (!token) {
        showError(
            'Link không hợp lệ',
            'Link này không có token. Vui lòng mở lại link từ Telegram bot bằng cách gõ /getkeyfree.'
        );
        return;
    }

    try {
        const res = await fetch(`${API}/trial/token/verify?token=${token}`);
        const data = await res.json();

        if (!res.ok || !data.valid) {
            if (data.reason === 'used') {
                showError(
                    'Link đã được sử dụng',
                    data.keyIssued
                        ? `Key đã cấp cho link này: ${data.keyIssued}`
                        : 'Link này đã được dùng rồi.'
                );
            } else if (data.reason === 'expired') {
                showError(
                    'Link đã hết hạn',
                    'Link chỉ có hiệu lực 15 phút. Vào Telegram gõ lại /getkeyfree để lấy link mới.'
                );
            } else {
                showError(
                    'Link không hợp lệ',
                    data.message || 'Vui lòng gõ lại /getkeyfree trên Telegram.'
                );
            }
            return;
        }

        $('durationText').textContent = `${data.durationHours} giờ`;

        const expiresInMs = new Date(data.expiresAt) - Date.now();
        const expiresInMin = Math.max(1, Math.floor(expiresInMs / 60000));
        $('expireText').textContent = `${expiresInMin} phút`;

        if (data.telegramUsername) {
            $('userRow').style.display = 'flex';
            $('userText').textContent = '@' + data.telegramUsername;
        }

        showState('Ready');
    } catch (e) {
        showError('Lỗi kết nối', 'Không thể kiểm tra link. Vui lòng thử lại sau.');
    }
}

async function claim() {
    if (!token) return;

    $('claimBtn').disabled = true;
    showState('Processing');

    try {
        const res = await fetch(`${API}/trial/token/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();

        if (!res.ok) {
            if (data.keyIssued) {
                $('keyValue').textContent = data.keyIssued;
                $('successDuration').textContent = '—';
                showState('Success');
                return;
            }
            showError('Không thể lấy key', data.error || 'Vui lòng thử lại.');
            return;
        }

        $('keyValue').textContent = data.key;
        $('successDuration').textContent = `${data.durationHours} giờ`;
        showState('Success');

        window.history.replaceState({}, '', '/getkeyfree');
    } catch (e) {
        showError('Lỗi kết nối', 'Không thể kết nối máy chủ.');
    } finally {
        $('claimBtn').disabled = false;
    }
}

function copyKey() {
    const key = $('keyValue').textContent;
    navigator.clipboard.writeText(key).then(() => {
        const btn = $('copyBtn');
        btn.textContent = 'Đã sao chép';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = 'Sao chép';
            btn.classList.remove('copied');
        }, 2000);
    });
}

$('claimBtn').addEventListener('click', claim);
$('copyBtn').addEventListener('click', copyKey);

verifyToken();
