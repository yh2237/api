const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.INFO;
const NAMES = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

function log(level, msg, meta) {
    if (level > LEVEL) return;
    const ts = new Date().toISOString();
    const line = meta
        ? `[${ts}] [${NAMES[level]}] ${msg} ${JSON.stringify(meta)}`
        : `[${ts}] [${NAMES[level]}] ${msg}`;
    if (level <= LEVELS.WARN) console.error(line);
    else console.log(line);
}

module.exports = {
    error: (msg, meta) => log(LEVELS.ERROR, msg, meta),
    warn: (msg, meta) => log(LEVELS.WARN, msg, meta),
    info: (msg, meta) => log(LEVELS.INFO, msg, meta),
    debug: (msg, meta) => log(LEVELS.DEBUG, msg, meta),
};
