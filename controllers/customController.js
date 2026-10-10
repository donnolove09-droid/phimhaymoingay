const CustomMovie = require('../models/CustomMovie');
const { detectVideo } = require('../utils/video');

function slugify(text) {
    return String(text).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Chuẩn hoá 1 tập: admin chỉ cần dán 1 link bất kỳ (m3u8 / mp4 / embed / YouTube / Drive)
 * -> tự nhận diện và đưa vào đúng ô. Hỗ trợ cả dữ liệu cũ có sẵn m3u8/embed.
 */
function prepareEpisode(ep, idx) {
    const out = { name: String(ep.name || `Tập ${idx + 1}`).trim(), embed: '', m3u8: '', mp4: '' };
    out.slug = ep.slug || slugify(out.name) || String(idx + 1);

    for (const raw of [ep.url, ep.m3u8, ep.mp4, ep.embed]) {
        if (!raw || !String(raw).trim()) continue;
        const v = detectVideo(raw);
        const slot = v.type === 'iframe' ? 'embed' : v.type;
        if (!out[slot]) out[slot] = v.url;
    }
    return out;
}

function prepareBody(body) {
    const doc = {};
    const copy = ['title', 'slug', 'description', 'poster', 'backdrop', 'country', 'quality', 'language', 'featured'];
    for (const k of copy) if (body[k] !== undefined) doc[k] = body[k];

    if (body.year !== undefined) doc.year = Number(body.year) || undefined;
    if (body.genres !== undefined) doc.genres = Array.isArray(body.genres) ? body.genres : [];
    if (body.isSeries !== undefined) doc.isSeries = body.isSeries === true || body.isSeries === 'true';

    if (body.videoUrl !== undefined || body.videoType !== undefined) {
        const v = detectVideo(body.videoUrl, body.videoType);
        doc.videoUrl = v.url;
        doc.videoType = v.type;
    }

    if (Array.isArray(body.episodes)) {
        doc.episodes = body.episodes.map(prepareEpisode).filter(e => e.embed || e.m3u8 || e.mp4);
    }
    return doc;
}

exports.list = async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;
    const [items, total] = await Promise.all([
        CustomMovie.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        CustomMovie.countDocuments()
    ]);
    res.json({
        source: 'custom',
        results: items.map(toCard),
        total_pages: Math.max(1, Math.ceil(total / limit)),
        page
    });
};

exports.detail = async (req, res) => {
    const movie = await CustomMovie.findOneAndUpdate(
        { slug: req.params.slug },
        { $inc: { views: 1 } },
        { new: true }
    );
    if (!movie) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json({ source: 'custom', movie });
};

exports.search = async (req, res) => {
    const keyword = String(req.query.keyword || '').trim();
    if (!keyword) return res.json({ source: 'custom', results: [], total_pages: 1 });
    const page = Math.max(1, Number(req.query.page) || 1);
    const regex = new RegExp(escapeRegex(keyword), 'i');   // chống ReDoS / regex injection
    const limit = 20;
    const filter = { $or: [{ title: regex }, { description: regex }] };
    const [items, total] = await Promise.all([
        CustomMovie.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        CustomMovie.countDocuments(filter)
    ]);
    res.json({ source: 'custom', results: items.map(toCard), total_pages: Math.max(1, Math.ceil(total / limit)) });
};

exports.create = async (req, res) => {
    const doc = prepareBody(req.body || {});
    if (!doc.title) return res.status(400).json({ error: 'Thiếu tiêu đề' });
    if (!doc.videoUrl && !(doc.episodes && doc.episodes.length)) {
        return res.status(400).json({ error: 'Cần URL video hoặc ít nhất 1 tập có link' });
    }

    let slug = slugify(doc.slug || doc.title) || `phim-${Date.now()}`;
    if (await CustomMovie.exists({ slug })) slug = `${slug}-${Date.now().toString().slice(-5)}`;

    const movie = await CustomMovie.create({ ...doc, slug });
    res.status(201).json(movie);
};

exports.update = async (req, res) => {
    const doc = prepareBody(req.body || {});
    if (doc.slug) doc.slug = slugify(doc.slug);
    if (!doc.slug) delete doc.slug;
    const movie = await CustomMovie.findByIdAndUpdate(req.params.id, { $set: doc }, { new: true, runValidators: true });
    if (!movie) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(movie);
};

exports.remove = async (req, res) => {
    await CustomMovie.findByIdAndDelete(req.params.id);
    res.json({ success: true });
};

exports.adminList = async (req, res) => {
    res.json(await CustomMovie.find().sort({ createdAt: -1 }));
};

function toCard(m) {
    return {
        id: m.slug,
        _id: m._id,
        title: m.title,
        poster_path: m.poster,
        backdrop_path: m.backdrop,
        release_date: m.year?.toString(),
        vote_average: 0,
        overview: m.description?.slice(0, 200),
        source: 'custom',
        source_name: 'Kho phim',
        quality: m.quality,
        episode_current: m.isSeries ? `${m.episodes?.length || 0} tập` : 'Full'
    };
}
exports._prepareBody = prepareBody;
