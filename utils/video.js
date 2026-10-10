/**
 * Nhận diện loại video từ URL do admin dán vào.
 * Trả về { type: 'm3u8' | 'mp4' | 'iframe', url } (url đã được chuẩn hoá).
 */
const MP4_EXT = /\.(mp4|m4v|webm|mov|ogv|ogg|mkv)$/i;

function stripQuery(u) {
    return String(u).split('#')[0].split('?')[0];
}

function toHttps(u) {
    // Trang chạy https -> media http bị trình duyệt chặn (mixed content)
    return String(u).replace(/^http:\/\//i, 'https://');
}

function youtubeId(u) {
    const m = String(u).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
    return m ? m[1] : null;
}

function driveId(u) {
    const m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)/i);
    return m ? m[1] : null;
}

function detectVideo(rawUrl, hintType) {
    let url = String(rawUrl || '').trim();
    if (!url) return { type: hintType || 'iframe', url: '' };
    if (url.startsWith('//')) url = 'https:' + url;

    const yt = youtubeId(url);
    if (yt) return { type: 'iframe', url: `https://www.youtube.com/embed/${yt}` };

    const drive = driveId(url);
    if (drive) return { type: 'iframe', url: `https://drive.google.com/file/d/${drive}/preview` };

    const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeo && !/player\.vimeo\.com/i.test(url)) {
        return { type: 'iframe', url: `https://player.vimeo.com/video/${vimeo[1]}` };
    }

    const bare = stripQuery(url);
    if (/\.m3u8$/i.test(bare)) return { type: 'm3u8', url: toHttps(url) };
    if (MP4_EXT.test(bare)) return { type: 'mp4', url: toHttps(url) };

    // URL không có đuôi rõ ràng: tin vào lựa chọn của admin
    if (hintType === 'm3u8' || hintType === 'mp4') return { type: hintType, url: toHttps(url) };
    return { type: 'iframe', url: toHttps(url) };
}

module.exports = { detectVideo };
