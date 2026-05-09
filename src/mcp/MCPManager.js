/**
 * MCPManager.js — 多 MCP Server 生命週期管理器
 *
 * 持久化配置到 data/mcp-servers.json
 * 提供 addServer / removeServer / callTool / listTools 等方法
 * 每次 callTool 呼叫都會 emit 'mcpLog' 事件
 */

const fs    = require('fs');
const path  = require('path');
const { EventEmitter } = require('events');
const MCPClient = require('./MCPClient');
const MCPToolCatalog = require('./MCPToolCatalog');

const CONFIG_PATH = path.resolve(process.cwd(), 'data', 'mcp-servers.json');
const MAX_LOG     = 500;
const DEFAULT_TIMEOUT_MS = 30000;
const CHROME_PROFILE_LOCK_RE = /(browser is already running|user.?data.?dir(?:ectory)?.*in use|processsingleton|singletonlock|profile.*in use|opening in existing browser session)/i;

function normalizeTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.max(Math.round(parsed), 1000), 600000);
}

function extractUserDataDirArg(args = []) {
    const list = Array.isArray(args) ? args : [];
    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '');
        const lower = cur.toLowerCase();
        if (lower.startsWith('--userdatadir=')) return cur.slice(cur.indexOf('=') + 1);
        if (lower.startsWith('--user-data-dir=')) return cur.slice(cur.indexOf('=') + 1);
        if (lower === '--userdatadir' || lower === '--user-data-dir') {
            return String(list[i + 1] || '').trim();
        }
    }
    return '';
}

function replaceUserDataDirArg(args = [], nextDir = '') {
    const list = Array.isArray(args) ? [...args] : [];
    const output = [];
    let replaced = false;

    for (let i = 0; i < list.length; i += 1) {
        const cur = String(list[i] || '');
        const lower = cur.toLowerCase();
        if (lower.startsWith('--userdatadir=')) {
            output.push(`--userDataDir=${nextDir}`);
            replaced = true;
            continue;
        }
        if (lower.startsWith('--user-data-dir=')) {
            output.push(`--user-data-dir=${nextDir}`);
            replaced = true;
            continue;
        }
        if (lower === '--userdatadir' || lower === '--user-data-dir') {
            output.push(cur);
            output.push(nextDir);
            replaced = true;
            i += 1;
            continue;
        }
        output.push(cur);
    }

    if (!replaced) {
        output.push(`--userDataDir=${nextDir}`);
    }
    return output;
}

function shouldRetryWithFallbackProfile(cfg, error) {
    const hasUserDataDir = Boolean(extractUserDataDirArg(cfg && cfg.args));
    if (!hasUserDataDir) return false;
    const text = String((error && error.message) || '');
    return CHROME_PROFILE_LOCK_RE.test(text);
}

function buildFallbackProfileDir(baseDir) {
    const stamp = Date.now().toString(36);
    return `${baseDir}-fallback-${stamp}`;
}

class MCPManager extends EventEmitter {
    constructor() {
        super();
        this._clients = new Map();  // name -> MCPClient
        this._configs = [];         // persisted server configs
        this._logs    = [];         // recent call logs
        this._loaded  = false;
    }

    // ─── Singleton ─────────────────────────────────────────────────
    static getInstance() {
        if (!MCPManager._instance) {
            MCPManager._instance = new MCPManager();
        }
        return MCPManager._instance;
    }

    // ─── Init ──────────────────────────────────────────────────────
    /** 載入配置並啟動所有啟用的 server */
    async load() {
        if (this._loaded) return;
        this._configs = this._readConfig();
        this._loaded  = true;

        // Auto-connect enabled servers
        const enabledServers = this._configs.filter(c => c.enabled !== false);
        for (const cfg of enabledServers) {
            try {
                await this._startClient(cfg);
            } catch (e) {
                console.warn(`[MCPManager] Auto-connect failed for "${cfg.name}": ${e.message}`);
            }
        }
        console.log(`[MCPManager] Loaded ${this._configs.length} servers, ${this._clients.size} connected.`);
    }

    // ─── Server CRUD ───────────────────────────────────────────────
    async addServer(cfg) {
        if (this._configs.find(c => c.name === cfg.name)) {
            throw new Error(`MCP server "${cfg.name}" already exists`);
        }
        const entry = {
            name:    cfg.name,
            command: cfg.command,
            args:    cfg.args    || [],
            env:     cfg.env     || {},
            timeout: normalizeTimeout(cfg.timeout),
            enabled: cfg.enabled !== false,
            description: cfg.description || ''
        };
        this._configs.push(entry);
        this._saveConfig();

        if (entry.enabled) {
            await this._startClient(entry);
        }
        return entry;
    }

    async updateServer(name, updates) {
        const idx = this._configs.findIndex(c => c.name === name);
        if (idx === -1) throw new Error(`MCP server "${name}" not found`);

        const entry = { ...this._configs[idx], ...updates, name };
        this._configs[idx] = entry;
        this._saveConfig();

        // Restart client if running
        await this._stopClient(name);
        if (entry.enabled) {
            await this._startClient(entry);
        }
        return entry;
    }

    async removeServer(name) {
        await this._stopClient(name);
        this._configs = this._configs.filter(c => c.name !== name);
        this._saveConfig();
    }

    async toggleServer(name, enabled) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);

        cfg.enabled = enabled;
        this._saveConfig();

        if (enabled) {
            await this._startClient(cfg);
        } else {
            await this._stopClient(name);
        }
        return cfg;
    }

    // ─── Tool Operations ───────────────────────────────────────────
    async listTools(serverName) {
        const client = this._clients.get(serverName);
        if (!client) throw new Error(`MCP server "${serverName}" not connected`);
        const tools = await client.listTools();
        this._cacheTools(serverName, tools);
        return this.getCachedTools(serverName);
    }

    /**
     * 呼叫 MCP 工具，自動記錄 Log
     * @param {string} serverName
     * @param {string} toolName
     * @param {Object} params
     * @returns {Promise<Object>}
     */
    async callTool(serverName, toolName, params = {}) {
        const startTime = Date.now();
        const client = this._clients.get(serverName);
        if (!client) throw new Error(`MCP server "${serverName}" not connected`);

        let success = true;
        let result  = null;
        let error   = null;

        try {
            result = await client.callTool(toolName, params);
        } catch (e) {
            success = false;
            error   = e.message;
            throw e;
        } finally {
            const duration = Date.now() - startTime;
            const logEntry = {
                time:       new Date().toISOString(),
                server:     serverName,
                tool:       toolName,
                params:     params,
                success,
                result:     success ? result : null,
                error:      success ? null : error,
                durationMs: duration
            };
            this._appendLog(logEntry);
            this.emit('mcpLog', logEntry);
        }
        return result;
    }

    /** 列出所有 server 配置（含連線狀態） */
    getServers() {
        return this._configs.map(cfg => ({
            ...cfg,
            connected: this._clients.has(cfg.name) && this._clients.get(cfg.name).isConnected
        }));
    }

    getServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) return null;
        return {
            ...cfg,
            connected: this._clients.has(name) && this._clients.get(name).isConnected
        };
    }

    getLogs(limit = 100) {
        return this._logs.slice(-limit);
    }

    getCachedTools(serverName = null) {
        const servers = serverName
            ? this._configs.filter(cfg => cfg.name === serverName)
            : this._configs;
        const tools = [];
        for (const server of servers.filter(cfg => cfg.enabled !== false)) {
            for (const tool of server.cachedTools || []) {
                tools.push(MCPToolCatalog.findTool(server.name, tool.name, this._configs));
            }
        }
        return tools.filter(Boolean);
    }

    getToolCatalog() {
        return MCPToolCatalog.buildCatalog(this._configs);
    }

    /** 測試連線（嘗試 listTools，成功後斷線） */
    async testServer(name) {
        const cfg = this._configs.find(c => c.name === name);
        if (!cfg) throw new Error(`MCP server "${name}" not found`);

        const testClient = new MCPClient({ ...cfg, timeout: normalizeTimeout(cfg.timeout, 10000) });
        try {
            await testClient.connect();
            const tools = await testClient.listTools();
            const normalizedTools = tools
                .map(tool => MCPToolCatalog.findTool(name, tool.name, [{ ...cfg, enabled: true, cachedTools: tools }]))
                .filter(Boolean);
            return { success: true, toolCount: normalizedTools.length, tools: normalizedTools };
        } finally {
            await testClient.disconnect();
        }
    }

    _cacheTools(serverName, tools) {
        const cfgEntry = this._configs.find(c => c.name === serverName);
        if (!cfgEntry) return;
        cfgEntry.cachedTools = (tools || []).map(t => ({
            name:        t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || t.schema || null,
            example:     MCPToolCatalog.buildActionExample(serverName, t.name, t.inputSchema || t.schema || {}),
        }));
        this._saveConfig();
        MCPToolCatalog.writeCatalog(this._configs);
    }

    // ─── Private ───────────────────────────────────────────────────
    async _startClient(cfg) {
        // Stop existing client if any
        await this._stopClient(cfg.name);
        try {
            return await this._startClientWithConfig(cfg, { mode: 'primary' });
        } catch (err) {
            if (!shouldRetryWithFallbackProfile(cfg, err)) throw err;

            const originalDir = extractUserDataDirArg(cfg.args);
            const fallbackDir = buildFallbackProfileDir(originalDir);
            fs.mkdirSync(fallbackDir, { recursive: true });
            const fallbackCfg = {
                ...cfg,
                args: replaceUserDataDirArg(cfg.args || [], fallbackDir)
            };

            console.warn(
                `[MCPManager] "${cfg.name}" profile in use (${originalDir}). ` +
                `Retrying with fallback profile: ${fallbackDir}`
            );

            return this._startClientWithConfig(fallbackCfg, {
                mode: 'fallback_profile',
                originalDir,
                fallbackDir
            });
        }
    }

    async _startClientWithConfig(launchCfg, meta = {}) {
        const client = new MCPClient(launchCfg);

        client.on('disconnected', () => {
            console.log(`[MCPManager] Server "${launchCfg.name}" disconnected.`);
            this._clients.delete(launchCfg.name);
        });

        client.on('error', (err) => {
            console.error(`[MCPManager] Server "${launchCfg.name}" error: ${err.message}`);
            this._clients.delete(launchCfg.name);
        });

        await client.connect();
        client.effectiveLaunch = {
            command: launchCfg.command,
            args: launchCfg.args,
            mode: meta.mode || 'primary',
            originalDir: meta.originalDir || null,
            fallbackDir: meta.fallbackDir || null
        };

        try {
            const tools = await client.listTools();
            this._cacheTools(launchCfg.name, tools);
        } catch (_) { /* optional */ }

        this._clients.set(launchCfg.name, client);
        if (meta.mode === 'fallback_profile') {
            console.log(`[MCPManager] ✅ Connected (fallback profile): "${launchCfg.name}" (${client.tools.length} tools)`);
        } else {
            console.log(`[MCPManager] ✅ Connected: "${launchCfg.name}" (${client.tools.length} tools)`);
        }
        return client;
    }

    async _stopClient(name) {
        const client = this._clients.get(name);
        if (client) {
            await client.disconnect().catch(() => {});
            this._clients.delete(name);
        }
    }

    _appendLog(entry) {
        this._logs.push(entry);
        if (this._logs.length > MAX_LOG) this._logs.shift();
    }

    _readConfig() {
        try {
            if (!fs.existsSync(CONFIG_PATH)) return [];
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch {
            return [];
        }
    }

    _saveConfig() {
        try {
            const dir = path.dirname(CONFIG_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this._configs, null, 2), 'utf8');
        } catch (e) {
            console.error('[MCPManager] Failed to save config:', e.message);
        }
    }
}

MCPManager._instance = null;

module.exports = MCPManager;
