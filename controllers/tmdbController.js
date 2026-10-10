const axios = require('axios');
const api = axios.create({
    baseURL: process.env.TMDB_BASE_URL,
    params: { api_key: process.env.TMDB_API_KEY, language: 'vi-VN' }
});

exports.getPopular = async (req, res) => {
    try {
        const { data } = await api.get('/movie/popular', { params: { page: req.query.page || 1 } });
        res.json({ source: 'tmdb', ...data });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getTopRated = async (req, res) => {
    try {
        const { data } = await api.get('/movie/top_rated', { params: { page: req.query.page || 1 } });
        res.json({ source: 'tmdb', ...data });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getNowPlaying = async (req, res) => {
    try {
        const { data } = await api.get('/movie/now_playing', { params: { page: req.query.page || 1 } });
        res.json({ source: 'tmdb', ...data });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getMovieDetail = async (req, res) => {
    try {
        const { data } = await api.get(`/movie/${req.params.id}`, {
            params: { append_to_response: 'videos,credits' }
        });
        res.json({ source: 'tmdb', ...data });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.searchMovies = async (req, res) => {
    try {
        const { query, page = 1 } = req.query;
        if (!query) return res.status(400).json({ error: 'Query required' });
        const { data } = await api.get('/search/movie', { params: { query, page } });
        res.json({ source: 'tmdb', ...data });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
