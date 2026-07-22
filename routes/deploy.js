const { Router } = require('express');
const { appsConfig } = require('../lib/config');
const { pveAgentExec } = require('../lib/pve');
const { verifyGitHubSignature } = require('../lib/middleware');
const log = require('../logger');

const router = Router();

function isValidVmid(vmid) {
    return /^\d+$/.test(vmid);
}

router.post('/:vmid', verifyGitHubSignature, async (req, res) => {
    const vmid = req.params.vmid;
    const appConfig = appsConfig[vmid];

    if (!appConfig) {
        return res.status(404).json({ error: `ID ${vmid} is not configured` });
    }

    if (!isValidVmid(vmid)) {
        return res.status(400).json({ error: `Invalid VMID: ${vmid}` });
    }

    const githubEvent = req.headers['x-github-event'];
    if (githubEvent === 'ping') return res.json({ message: 'pong' });
    if (githubEvent !== 'push') return res.status(400).json({ error: 'Only push events supported' });

    if (appConfig.branch && req.body.ref !== appConfig.branch) {
        log.info('ブランチ不一致によりスキップ', { name: appConfig.name, branch: req.body.ref, expected: appConfig.branch });
        return res.json({ message: 'Skipped: branch mismatch' });
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

module.exports = router;
