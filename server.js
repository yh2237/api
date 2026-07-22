require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const log = require('./logger');
const { bufferBody } = require('./lib/middleware');
const statusRouter = require('./routes/status');
const deployRouter = require('./routes/deploy');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256', 'X-GitHub-Event'],
}));
app.use(bufferBody);

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}

app.use('/api/status', statusRouter);
app.use('/api/webhook/deploy', deployRouter);

log.info('PVE config', {
    host: process.env.PVE_HOST,
    port: process.env.PVE_PORT,
    node: process.env.PVE_NODE,
    skipTLS: process.env.PVE_SKIP_TLS_VERIFY !== 'false',
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
