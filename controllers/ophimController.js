const sources = require('../services/movieSources');

const send = (res, e) => res.status(e.status || 502).json({ error: e.message });

exports.getNewMovies = async (req, res) => {
    try { res.json(await sources.list('ophim', Number(req.query.page) || 1)); } catch (e) { send(res, e); }
};
exports.getMovieDetail = async (req, res) => {
    try { res.json(await sources.detail('ophim', req.params.slug)); } catch (e) { send(res, e); }
};
exports.searchMovies = async (req, res) => {
    try { res.json(await sources.search('ophim', String(req.query.keyword || ''), Number(req.query.page) || 1)); } catch (e) { send(res, e); }
};
