const crypto = require('crypto');
const log = require('../logger');

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

function bufferBody(req, res, next) {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        req.rawBody = Buffer.concat(chunks);
        if (req.rawBody.length) {
            try {
                req.body = JSON.parse(req.rawBody.toString());
            } catch (e) {
                return res.status(400).json({ error: 'Invalid JSON' });
            }
        }
        next();
    });
}

function verifyGitHubSignature(req, res, next) {
    if (!GITHUB_WEBHOOK_SECRET) return next();

    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
        log.warn('GitHub署名なしでリクエストを受信');
        return res.status(401).json({ error: 'No signature provided' });
    }

    if (!Buffer.isBuffer(req.rawBody) || !req.rawBody.length) {
        log.warn('verifyGitHubSignature: req.rawBody is empty or missing');
        return res.status(400).json({ error: 'Empty request body' });
    }

    const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(req.rawBody).digest('hex');

    if (signature.length !== digest.length) {
        log.warn('GitHub署名の長さが不一致');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
        next();
    } else {
        log.warn('GitHub署名が無効');
        res.status(401).json({ error: 'Invalid signature' });
    }
}

module.exports = { bufferBody, verifyGitHubSignature };
