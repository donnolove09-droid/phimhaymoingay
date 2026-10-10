/**
 * Lớp adapter cho nhiều API phim (KKPhim, OPhim, NguonC, ...).
 *
 * Các API này trả JSON KHÁC NHAU:
 *   - KKPhim : { items, pagination }  /  { movie, episodes:[{server_name, server_data:[{link_embed, link_m3u8}]}] }
 *   - OPhim  : bản cũ giống KKPhim, bản v1 bọc trong { data:{ items | item } }, ảnh là đường dẫn tương đối
 *   - NguonC : { items, paginate }    /  { movie:{ ..., episodes:[{server_name, items:[{embed, m3u8}]}] } }
 * => Mọi thứ được chuẩn hoá về 1 định dạng duy nhất để frontend không phải quan tâm nguồn nào.
 *
 * Thêm nguồn mới KHÔNG cần sửa code: đặt biến môi trường EXTRA_SOURCES (JSON), ví dụ
 *   EXTRA_SOURCES=[{"id":"abc","name":"ABC Phim","base":"https://abc.example/api","preset":"ophim"}]
 * preset: "ophim" | "kkphim" | "nguonc"  (chọn preset đúng với kiểu API của web đó)
 */
const axios = require('axios');

const http = axios.create({
    timeout: 9000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PhimHay/1.0)',
        Accept: 'application/json'
    }
});

/* ------------------------------------------------------------------ */
/* Presets: đường dẫn endpoint cho từng "họ" API                       */
/* ------------------------------------------------------------------ */
const PRESETS = {
    kkphim: {
        list: ['/danh-sach/phim-moi-cap-nhat', '/v1/api/danh-sach/phim-moi-cap-nhat'],
        detail: ['/phim/{slug}'],
        search: ['/v1/api/tim-kiem', '/tim-kiem']
    },
    ophim: {
        list: ['/danh-sach/phim-moi-cap-nhat', '/v1/api/danh-sach/phim-moi'],
        detail: ['/phim/{slug}', '/v1/api/phim/{slug}'],
        search: ['/v1/api/tim-kiem', '/tim-kiem']
    },
    nguonc: {
        list: ['/films/phim-moi-cap-nhat'],
        detail: ['/film/{slug}'],
        search: ['/films/search']
    }
};

function buildSources() {
    const list = [
        {
            id: 'kkphim', name: 'KKPhim', preset: 'kkphim',
            base: trimSlash(process.env.PHIMAPI_BASE_URL || 'https://phimapi.com'),
            cdn: 'https://phimimg.com', imagePath: '/'
        },
        {
            id: 'ophim', name: 'OPhim', preset: 'ophim',
            // Biến cũ OPHIM_BASE_URL có dạng .../v1/api -> lấy phần host
            base: trimSlash((process.env.OPHIM_BASE_URL || 'https://ophim1.com').replace(/\/v1\/api\/?$/, '')),
            cdn: 'https://img.ophim.live', imagePath: '/uploads/movies/'
        },
        {
            id: 'nguonc', name: 'NguonC', preset: 'nguonc',
            base: trimSlash(process.env.NGUONC_BASE_URL || 'https://phim.nguonc.com/api')
        },
        {
            // Gateway tương thích OPhim. Nếu chết thì tự bị bỏ qua (circuit breaker).
            id: 'vsphim', name: 'VSPhim', preset: 'ophim',
            base: trimSlash(process.env.VSPHIM_BASE_URL || 'https://nguon.vsphim.com/api'),
            experimental: true
        }
    ];

    if (process.env.EXTRA_SOURCES) {
        try {
            const extra = JSON.parse(process.env.EXTRA_SOURCES);
            for (const s of Array.isArray(extra) ? extra : [extra]) {
                if (!s || !s.id || !s.base) continue;
                if (!PRESETS[s.preset]) s.preset = 'ophim';
                list.push({ ...s, id: String(s.id).toLowerCase(), name: s.name || s.id, base: trimSlash(s.base) });
            }
        } catch (e) {
            console.error('[sources] EXTRA_SOURCES không phải JSON hợp lệ:', e.message);
        }
    }

    const disabled = (process.env.DISABLED_SOURCES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return list.filter(s => !disabled.includes(s.id));
}

function trimSlash(s) { return String(s || '').replace(/\/+$/, ''); }

const SOURCES = buildSources();
const byId = id => SOURCES.find(s => s.id === String(id).toLowerCase());

/* ------------------------------------------------------------------ */
/* Cache + circuit breaker                                             */
/* ------------------------------------------------------------------ */
const cache = new Map();
function cacheGet(k) {
    const e = cache.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) { cache.delete(k); return undefined; }
    return e.val;
}
function cacheSet(k, val, ttlMs) {
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    cache.set(k, { val, exp: Date.now() + ttlMs });
}

const health = new Map(); // id -> { fails, until, lastError, lastOk }
function hs(id) {
    if (!health.has(id)) health.set(id, { fails: 0, until: 0, lastError: null, lastOk: null });
    return health.get(id);
}
function isOpen(id) { return hs(id).until > Date.now(); }
function markOk(id) { const h = hs(id); h.fails = 0; h.until = 0; h.lastOk = new Date(); h.lastError = null; }
function markFail(id, err) {
    const h = hs(id);
    h.fails += 1;
    h.lastError = err.message;
    if (h.fails >= 3) h.until = Date.now() + 5 * 60 * 1000; // nghỉ 5 phút
}

/* ------------------------------------------------------------------ */
/* Chuẩn hoá dữ liệu                                                   */
/* ------------------------------------------------------------------ */
const stripHtml = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

function absImage(url, src, cdnFromResponse) {
    if (!url) return '';
    url = String(url).trim();
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    const cdn = trimSlash(cdnFromResponse || src.cdn || '');
    if (!cdn) return '';
    const clean = url.replace(/^\/+/, '');
    if (/^uploads?\//i.test(clean)) return `${cdn}/${clean}`;
    return `${cdn}${src.imagePath || '/'}${clean}`;
}

function pickItems(raw) {
    return raw?.items || raw?.data?.items || raw?.data?.data?.items || raw?.movies || [];
}

function pickTotalPages(raw) {
    const p = raw?.pagination || raw?.paginate || raw?.data?.params?.pagination || raw?.data?.pagination;
    if (!p) return 1;
    const direct = p.totalPages ?? p.total_page ?? p.total_pages;
    if (direct) return Number(direct) || 1;
    const total = p.totalItems ?? p.total_items;
    const per = p.totalItemsPerPage ?? p.items_per_page ?? p.limit;
    if (total && per) return Math.max(1, Math.ceil(total / per));
    return 1;
}

function names(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
}

function toCard(item, src, cdn) {
    const year = item.year || item.publish_year || '';
    return {
        id: item.slug,
        title: item.name || item.title || '',
        origin_name: item.origin_name || item.original_name || '',
        poster_path: absImage(item.poster_url || item.poster || item.thumb_url, src, cdn),
        backdrop_path: absImage(item.thumb_url || item.poster_url, src, cdn),
        release_date: year ? String(year) : '',
        vote_average: Number(item.tmdb?.vote_average || item.vote_average || 0) || 0,
        overview: stripHtml(item.content || item.description).slice(0, 300),
        source: src.id,
        source_name: src.name,
        episode_current: item.episode_current || item.current_episode || '',
        quality: item.quality || '',
        lang: item.lang || item.language || ''
    };
}

function normalizeList(raw, src) {
    const cdn = raw?.data?.APP_DOMAIN_CDN_IMAGE || raw?.APP_DOMAIN_CDN_IMAGE || raw?.pathImage || null;
    // pathImage đôi khi là ".../upload/vod/" -> chỉ lấy origin
    let cdnOrigin = cdn;
    try { if (cdn) cdnOrigin = new URL(cdn).origin; } catch { /* giữ nguyên */ }
    const results = pickItems(raw).filter(i => i && i.slug).map(i => toCard(i, src, cdnOrigin));
    return { results, total_pages: pickTotalPages(raw), cdn: cdnOrigin };
}

function normalizeEpisodes(rawEpisodes) {
    if (!Array.isArray(rawEpisodes)) return [];
    return rawEpisodes.map((srv, i) => {
        const data = srv.server_data || srv.items || srv.list || [];
        return {
            server_name: srv.server_name || srv.name || `Server ${i + 1}`,
            server_data: (Array.isArray(data) ? data : []).map((ep, j) => ({
                name: ep.name || ep.filename || `Tập ${j + 1}`,
                slug: ep.slug || String(j + 1),
                link_embed: ep.link_embed || ep.embed || '',
                link_m3u8: ep.link_m3u8 || ep.m3u8 || '',
                link_mp4: ep.link_mp4 || ep.mp4 || ''
            })).filter(ep => ep.link_embed || ep.link_m3u8 || ep.link_mp4)
        };
    }).filter(s => s.server_data.length);
}

function normalizeDetail(raw, src) {
    const m = raw?.movie || raw?.data?.item || raw?.item || raw?.data?.movie || raw?.data || null;
    if (!m || (!m.name && !m.slug)) return null;
    const cdn = raw?.data?.APP_DOMAIN_CDN_IMAGE || raw?.APP_DOMAIN_CDN_IMAGE || null;
    const eps = raw?.episodes || m.episodes || raw?.data?.item?.episodes || [];

    return {
        source: src.id,
        source_name: src.name,
        movie: {
            name: m.name || m.title,
            slug: m.slug,
            origin_name: m.origin_name || m.original_name || '',
            content: stripHtml(m.content || m.description),
            poster_url: absImage(m.poster_url || m.poster || m.thumb_url, src, cdn),
            thumb_url: absImage(m.thumb_url || m.poster_url, src, cdn),
            year: m.year || '',
            quality: m.quality || '',
            lang: m.lang || m.language || '',
            episode_current: m.episode_current || m.current_episode || '',
            time: m.time || '',
            genres: names(m.category || m.categories),
            countries: names(m.country),
            actors: Array.isArray(m.actor) ? m.actor : (typeof m.casts === 'string' ? m.casts.split(',').map(s => s.trim()) : []),
            tmdb: m.tmdb || null
        },
        episodes: normalizeEpisodes(eps)
    };
}

/* ------------------------------------------------------------------ */
/* Gọi API (thử lần lượt các đường dẫn của preset)                     */
/* ------------------------------------------------------------------ */
async function request(src, kind, { slug, params } = {}) {
    const paths = PRESETS[src.preset][kind];
    const start = src._okIdx?.[kind] ?? 0;
    const order = paths.map((_, i) => (i + start) % paths.length);
    let lastErr;

    for (const i of order) {
        const path = paths[i].replace('{slug}', encodeURIComponent(slug || ''));
        try {
            const { data } = await http.get(src.base + path, { params });
            if (data && typeof data === 'object') {
                (src._okIdx ||= {})[kind] = i;   // nhớ đường dẫn chạy được
                return data;
            }
            lastErr = new Error('Phản hồi không phải JSON');
        } catch (e) {
            lastErr = new Error(`${e.response?.status || e.code || 'ERR'} ${src.base + path}`);
        }
    }
    throw lastErr;
}

async function guarded(src, fn) {
    if (isOpen(src.id)) throw new Error(`${src.name} tạm nghỉ do lỗi liên tiếp`);
    try {
        const out = await fn();
        markOk(src.id);
        return out;
    } catch (e) {
        markFail(src.id, e);
        throw e;
    }
}

async function list(id, page = 1) {
    const src = byId(id);
    if (!src) throw Object.assign(new Error('Nguồn không tồn tại'), { status: 404 });
    const key = `list:${src.id}:${page}`;
    const hit = cacheGet(key);
    if (hit) return hit;
    const out = await guarded(src, async () => {
        const raw = await request(src, 'list', { params: { page } });
        const n = normalizeList(raw, src);
        if (n.cdn && !src.cdn) src.cdn = n.cdn;
        return { source: src.id, results: n.results, total_pages: n.total_pages };
    });
    cacheSet(key, out, 3 * 60 * 1000);
    return out;
}

async function detail(id, slug) {
    const src = byId(id);
    if (!src) throw Object.assign(new Error('Nguồn không tồn tại'), { status: 404 });
    const key = `detail:${src.id}:${slug}`;
    const hit = cacheGet(key);
    if (hit) return hit;
    const out = await guarded(src, async () => {
        const raw = await request(src, 'detail', { slug });
        const n = normalizeDetail(raw, src);
        if (!n) throw Object.assign(new Error('Không tìm thấy phim'), { status: 404 });
        return n;
    });
    cacheSet(key, out, 10 * 60 * 1000);
    return out;
}

async function search(id, keyword, page = 1) {
    const src = byId(id);
    if (!src) throw Object.assign(new Error('Nguồn không tồn tại'), { status: 404 });
    const key = `search:${src.id}:${keyword}:${page}`;
    const hit = cacheGet(key);
    if (hit) return hit;
    const out = await guarded(src, async () => {
        const raw = await request(src, 'search', { params: { keyword, page } });
        const n = normalizeList(raw, src);
        return { source: src.id, results: n.results, total_pages: n.total_pages };
    });
    cacheSet(key, out, 2 * 60 * 1000);
    return out;
}

/* ------------------------------------------------------------------ */
/* Gộp nhiều nguồn                                                     */
/* ------------------------------------------------------------------ */
function interleave(groups) {
    // Xen kẽ lần lượt từng nguồn (ổn định giữa các trang, không random như bản cũ)
    // và gộp phim trùng slug, ghi lại các nguồn khác cũng có phim đó (also).
    const seen = new Map();
    const out = [];
    const max = Math.max(0, ...groups.map(g => g.length));
    for (let i = 0; i < max; i++) {
        for (const g of groups) {
            const m = g[i];
            if (!m) continue;
            const k = m.id;
            if (seen.has(k)) {
                const first = seen.get(k);
                (first.also ||= []).push(m.source);
            } else {
                seen.set(k, m);
                out.push(m);
            }
        }
    }
    return out;
}

async function aggregate(fn, onlyIds) {
    const targets = SOURCES.filter(s => !onlyIds || onlyIds.includes(s.id));
    const settled = await Promise.allSettled(targets.map(s => fn(s.id)));
    const ok = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = settled
        .map((r, i) => (r.status === 'rejected' ? { source: targets[i].id, error: r.reason.message } : null))
        .filter(Boolean);
    return {
        results: interleave(ok.map(o => o.results)),
        total_pages: Math.max(1, ...ok.map(o => o.total_pages || 1)),
        failed
    };
}

const aggregateList = (page, only) => aggregate(id => list(id, page), only);
const aggregateSearch = (kw, page, only) => aggregate(id => search(id, kw, page), only);

function sourcesInfo() {
    return SOURCES.map(s => ({ id: s.id, name: s.name, experimental: !!s.experimental }));
}

/** Kiểm tra sống/chết của từng nguồn (dùng cho trang admin / debug). */
async function checkHealth() {
    return Promise.all(SOURCES.map(async s => {
        const t = Date.now();
        try {
            // bỏ qua cache & breaker để kiểm tra thật
            const raw = await request(s, 'list', { params: { page: 1 } });
            const n = normalizeList(raw, s);
            markOk(s.id);
            return { id: s.id, name: s.name, ok: n.results.length > 0, items: n.results.length, ms: Date.now() - t, sample: n.results[0]?.title || null };
        } catch (e) {
            markFail(s.id, e);
            return { id: s.id, name: s.name, ok: false, error: e.message, ms: Date.now() - t };
        }
    }));
}

module.exports = {
    sourcesInfo, byId, list, detail, search,
    aggregateList, aggregateSearch, checkHealth,
    // export để test
    _normalizeList: normalizeList, _normalizeDetail: normalizeDetail, _interleave: interleave
};
