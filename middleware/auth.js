const jwt = require('jsonwebtoken');

exports.requireAdmin = (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.role !== 'admin') return res.status(403).json({ error: 'Không có quyền' });
        req.admin = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Token không hợp lệ' });
    }
};
