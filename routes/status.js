const { Router } = require('express');
const { pveRequest, PVE_NODE, PVE_TIMEOUT } = require('../lib/pve');
const log = require('../logger');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PVE request timed out')), PVE_TIMEOUT)
        );
        const [nodeStatus, rrdData] = await Promise.race([
            Promise.all([
                pveRequest(`/nodes/${PVE_NODE}/status`),
                pveRequest(`/nodes/${PVE_NODE}/rrddata?timeframe=hour&cf=AVERAGE`)
            ]),
            timeout,
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

module.exports = router;
