const Comment = require('../models/Comment');

exports.list = async (req, res) => {
    try {
        const { source, slug } = req.params;
        const page = Number(req.query.page) || 1;
        const limit = 20;
        const comments = await Comment.find({ movieSlug: slug, movieSource: source })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);
        res.json(comments);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.create = async (req, res) => {
    try {
        const { movieSlug, movieSource, content } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'Nội dung trống' });
        if (content.length > 1000) return res.status(400).json({ error: 'Nội dung quá dài (tối đa 1000 ký tự)' });

        const comment = await Comment.create({
            movieSlug,
            movieSource,
            userId: req.user.userId,
            username: req.user.username,
            content: content.trim()
        });
        res.status(201).json(comment);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.remove = async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.id);
        if (!comment) return res.status(404).json({ error: 'Không tìm thấy' });
        const isOwner = comment.userId.toString() === req.user.userId;
        if (!isOwner && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Không có quyền xóa' });
        }
        await comment.deleteOne();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.like = async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.id);
        if (!comment) return res.status(404).json({ error: 'Không tìm thấy' });

        const uid = req.user.userId;
        const liked = comment.likedBy.some(id => id.toString() === uid);
        if (liked) {
            comment.likedBy = comment.likedBy.filter(id => id.toString() !== uid);
            comment.likes = Math.max(0, comment.likes - 1);
        } else {
            comment.likedBy.push(uid);
            comment.likes += 1;
        }
        await comment.save();
        res.json({ likes: comment.likes, liked: !liked });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
