const sources = require('../services/movieSources');

const page = req => Math.max(1, Number(req.query.page) || 1);

function fail(res, e) {
    res.status(e.status || 502).json({ error: e.message || 'Nguồn phim lỗi' });
}

exports.listSources = (req, res) => res.json({ sources: sources.sourcesInfo() });

exports.health = async (req, res) => res.json({ sources: await sources.checkHealth() });

exports.aggregate = async (req, res) => {
    const only = req.query.sources ? String(req.query.sources).split(',') : undefined;
    const data = await sources.aggregateList(page(req), only);
    if (!data.results.length && data.failed.length) {
        return res.status(502).json({ error: 'Tất cả nguồn phim đều đang lỗi, thử lại sau', failed: data.failed });
    }
    res.json({ source: 'aggregate', ...data });
};

exports.searchAll = async (req, res) => {
    const keyword = String(req.query.keyword || req.query.query || '').trim();
    if (!keyword) return res.status(400).json({ error: 'Thiếu từ khoá' });
    const data = await sources.aggregateSearch(keyword, page(req));
    res.json({ source: 'aggregate', ...data });
};

exports.newBySource = async (req, res) => {
    try { res.json(await sources.list(req.params.source, page(req))); }
    catch (e) { fail(res, e); }
};

exports.searchBySource = async (req, res) => {
    const keyword = String(req.query.keyword || req.query.query || '').trim();
    if (!keyword) return res.status(400).json({ error: 'Thiếu từ khoá' });
    try { res.json(await sources.search(req.params.source, keyword, page(req))); }
    catch (e) { fail(res, e); }
};

exports.detailBySource = async (req, res) => {
    try { res.json(await sources.detail(req.params.source, req.params.slug)); }
    catch (e) { fail(res, e); }
};
