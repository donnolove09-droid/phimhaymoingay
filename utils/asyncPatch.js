/**
 * Express 4 không bắt lỗi của handler async -> Promise reject không ai xử lý
 * -> Node 20 tự crash cả process (Render sẽ restart liên tục).
 * Patch này tự chuyển lỗi của handler async sang next(err).
 * Phải require TRƯỚC khi khai báo route.
 */
const Layer = require('express/lib/router/layer');

if (!Layer.prototype.__asyncPatched) {
    const original = Layer.prototype.handle_request;
    Layer.prototype.handle_request = function handle(req, res, next) {
        const fn = this.handle;
        if (fn.length > 3) return next();           // error middleware: bỏ qua
        try {
            const result = fn(req, res, next);
            if (result && typeof result.catch === 'function') result.catch(next);
        } catch (err) {
            next(err);
        }
    };
    Layer.prototype.__asyncPatched = true;
    Layer.prototype.__originalHandleRequest = original;
}
