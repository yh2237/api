const https = require('https');
const fs = require('fs');
const log = require('../logger');

const PVE_HOST = process.env.PVE_HOST;
const PVE_PORT = process.env.PVE_PORT;
const PVE_NODE = process.env.PVE_NODE;
const PVE_TOKEN_ID = process.env.PVE_TOKEN_ID;
const PVE_TOKEN_SECRET = process.env.PVE_TOKEN_SECRET;
const PVE_CA_PATH = process.env.PVE_CA_PATH;
const PVE_SKIP_TLS_VERIFY = process.env.PVE_SKIP_TLS_VERIFY !== 'false';
const PVE_TIMEOUT = parseInt(process.env.PVE_TIMEOUT || '15000', 10);
const authHeader = `PVEAPIToken=${PVE_TOKEN_ID}=${PVE_TOKEN_SECRET}`;

function getHttpsOptions(apiPath, method, postData) {
    const opts = {
        hostname: PVE_HOST,
        port: parseInt(PVE_PORT),
        path: `/api2/json${apiPath}`,
        method: method || 'GET',
        headers: { 'Authorization': authHeader },
        rejectUnauthorized: !PVE_SKIP_TLS_VERIFY,
        family: 4,
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

module.exports = { pveRequest, pveAgentExec, PVE_NODE, PVE_TIMEOUT };
