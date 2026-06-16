const { spawn } = require('child_process');
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');
const log = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'apps.config.json');
const PVE_TIMEOUT = parseInt(process.env.PVE_TIMEOUT || '15000', 10);
let appsConfig = {};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
            appsConfig = JSON.parse(rawData);
            log.info('アプリケーションの設定を読み込みました', { count: Object.keys(appsConfig).length });
        } else {
            log.warn('apps.config.json が見つかりません');
        }
    } catch (err) {
        log.error('apps.config.json の解析に失敗しました', { error: err.message });
    }
}

loadConfig();

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

app.use(bufferBody);

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}

const PVE_HOST = process.env.PVE_HOST;
const PVE_PORT = process.env.PVE_PORT;
const PVE_NODE = process.env.PVE_NODE;
const PVE_TOKEN_ID = process.env.PVE_TOKEN_ID;
const PVE_TOKEN_SECRET = process.env.PVE_TOKEN_SECRET;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const PVE_CA_PATH = process.env.PVE_CA_PATH;
const PVE_SKIP_TLS_VERIFY = process.env.PVE_SKIP_TLS_VERIFY !== 'false';

const authHeader = `PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}`;

function getHttpsOptions(apiPath, method, postData) {
    const opts = {
        hostname: PVE_HOST,
        port: parseInt(PVE_PORT),
        path: `/api2/json${apiPath}`,
        method: method || 'GET',
        headers: { 'Authorization': authHeader },
        rejectUnauthorized: !PVE_SKIP_TLS_VERIFY,
        lookup: (host, _, cb) => cb(null, host, 4),
    };
    if (PVE_CA_PATH && fs.existsSync(PVE_CA_PATH)) {
        opts.ca = fs.readFileSync(PVE_CA_PATH);
    }
    if (postData) {
        const stringData = JSON.stringify(postData);
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(stringData);
    }
    return opts;
}

function pveRequest(apiPath, options = {}) {
    const method = options.method || 'GET';
    const postData = options.body;
    const opts = getHttpsOptions(apiPath, method, postData);

    return new Promise((resolve, reject) => {
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`PVE API error: ${res.statusCode} ${res.statusMessage}`));
                }
                try { resolve(JSON.parse(data).data); }
                catch { reject(new Error('PVE API response parse error')); }
            });
        });

        req.setTimeout(PVE_TIMEOUT, () => {
            req.destroy(new Error(`PVE API timeout (${PVE_TIMEOUT}ms)`));
        });

        req.on('error', (err) => {
            reject(err);
        });

        if (postData) req.write(JSON.stringify(postData));
        req.end();
    });
}

function pveAgentExec(vmid, shellCommand) {
    const payload = { command: ['/bin/sh', '-c', shellCommand] };
    return pveRequest(`/nodes/${PVE_NODE}/qemu/${vmid}/agent/exec`, {
        method: 'POST',
        body: payload,
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

function isValidVmid(vmid) {
    return /^\d+$/.test(vmid);
}

app.get('/api/status', async (req, res) => {
    try {
        const [nodeStatus, rrdData] = await Promise.all([
            pveRequest(`/nodes/${PVE_NODE}/status`),
            pveRequest(`/nodes/${PVE_NODE}/rrddata?timeframe=hour&cf=AVERAGE`)
        ]);

        const cpuPercent = (nodeStatus.cpu * 100).toFixed(2);
        const ramPercent = (nodeStatus.memory.used / nodeStatus.memory.total * 100).toFixed(2);

        const latest = rrdData?.filter(d => d.netin != null).at(-1) || {};
        const netRx = ((latest.netin || 0) / 1024).toFixed(2);
        const netTx = ((latest.netout || 0) / 1024).toFixed(2);
        const diskRead = ((latest.diskread || 0) / 1024).toFixed(2);
        const diskWrite = ((latest.diskwrite || 0) / 1024).toFixed(2);

        res.json({ cpu: cpuPercent, ram: ramPercent, netRx, netTx, diskRead, diskWrite });
    } catch (err) {
        log.error('/api/status エラー', {
            error: err?.message || String(err),
            code: err?.code,
            stack: err?.stack?.split('\n').slice(0, 2).join(' '),
        });
        res.status(500).json({ error: err?.message || 'Unknown error' });
    }
});

app.post('/api/webhook/deploy/:vmid', verifyGitHubSignature, async (req, res) => {
    const vmid = req.params.vmid;

    const appConfig = appsConfig[vmid];

    if (!appConfig) {
        return res.status(404).json({ error: `ID ${vmid} is not configured` });
    }

    if (!isValidVmid(vmid) && !appConfig.isSelf) {
        return res.status(400).json({ error: `Invalid VMID: ${vmid}` });
    }

    const githubEvent = req.headers['x-github-event'];
    if (githubEvent === 'ping') return res.json({ message: 'pong' });
    if (githubEvent !== 'push') return res.status(400).json({ error: 'Only push events supported' });

    if (appConfig.branch && req.body.ref !== appConfig.branch) {
        log.info('ブランチ不一致によりスキップ', { name: appConfig.name, branch: req.body.ref, expected: appConfig.branch });
        return res.json({ message: `Skipped: branch mismatch` });
    }

    if (appConfig.isSelf) {
        log.info('Self-update をトリガー', { name: appConfig.name });

        res.json({ message: 'Self-update triggered. LXC will restart shortly.' });

        const runUpdate = () => {
            const child = spawn('sh', ['-c', appConfig.script], {
                cwd: appConfig.cwd,
                timeout: 300000,
                stdio: 'pipe',
            });
            let stdout = '', stderr = '';
            child.stdout.on('data', d => stdout += d.toString());
            child.stderr.on('data', d => stderr += d.toString());
            child.on('error', err => log.error('Self-Update 実行エラー', { error: err.message }));
            child.on('exit', code => {
                if (code === 0) log.info('Self-Update 成功', { stdout });
                else log.error('Self-Update 失敗', { code, stderr });
            });
        };

        if (res.writableFinished) {
            setTimeout(runUpdate, 1000);
        } else {
            res.on('finish', () => setTimeout(runUpdate, 1000));
        }
        return;
    }

    log.info('VM deploy をトリガー', { name: appConfig.name, vmid });

    res.status(202).json({ message: 'Deploy accepted. Running asynchronously.', vmid });

    const shellCommand = `cd ${appConfig.cwd} && ${appConfig.script}`;

    pveAgentExec(vmid, shellCommand).then(result => {
        log.info('VM deploy 成功', { vmid, name: appConfig.name, pid: result.pid });
    }).catch(err => {
        log.error('VM deploy エラー', {
            vmid,
            name: appConfig.name,
            error: err?.message || String(err),
            code: err?.code,
            stack: err?.stack?.split('\n').slice(0, 2).join(' '),
        });
    });
});

app.post('/api/config/reload', (req, res) => {
    loadConfig();
    res.json({ message: 'Config reloaded', current: appsConfig });
});

const server = app.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);
});

function shutdown(signal) {
    log.info(`${signal} received, shutting down gracefully...`);
    server.close(() => {
        log.info('Server closed');
        process.exit(0);
    });
    setTimeout(() => {
        log.error('Graceful shutdown timeout, forcing exit');
        process.exit(1);
    }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
