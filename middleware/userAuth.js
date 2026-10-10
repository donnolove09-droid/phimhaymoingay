const jwt = require('jsonwebtoken');

exports.requireUser = (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Cần đăng nhập' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token không hợp lệ' });
    }
};

exports.optionalUser = (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) {
        try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch {}
    }
    next();
};
