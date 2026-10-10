const AccessKey = require('../models/AccessKey');

/** Key còn trong kho = chưa dùng VÀ chưa được cấp cho ai. */
const AVAILABLE = { isUsed: false, issuedTo: null };

function countAvailable() {
    return AccessKey.countDocuments(AVAILABLE);
}

/**
 * Cấp 1 key cho `owner` một cách atomic.
 * Bản cũ chỉ findOneAndUpdate mà không đánh dấu "đã cấp" nên 2 đơn cùng lúc
 * có thể nhận CÙNG MỘT key. Giờ key được gắn issuedTo ngay khi cấp.
 */
function allocateKey(owner, fields = {}) {
    return AccessKey.findOneAndUpdate(
        AVAILABLE,
        { $set: { ...fields, issuedTo: String(owner) } },
        { sort: { createdAt: 1 }, new: true }
    );
}

module.exports = { AVAILABLE, countAvailable, allocateKey };
