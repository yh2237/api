const fs = require('fs');
const path = require('path');
const log = require('../logger');

const CONFIG_PATH = path.join(__dirname, '..', 'apps.config.json');
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

module.exports = { appsConfig, loadConfig };
