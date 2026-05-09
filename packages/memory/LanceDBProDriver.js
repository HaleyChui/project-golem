const fs = require('fs');
const path = require('path');
const KeyChain = require('../../src/services/KeyChain');
const OllamaClient = require('../../src/services/OllamaClient');
const { CONFIG, KNOWLEDGE_BASE_DIR } = require('../../src/config');

// ✨ 快取 Jiti 實例，避免重複初始化開銷
let cachedJiti = null;

/**
 * 🚀 LanceDB Pro Memory Driver
 * Wraps memory-lancedb-pro for project-golem
 */
class LanceDBProDriver {
    constructor() {
        this.baseDir = KNOWLEDGE_BASE_DIR;
        this.dbPath = path.join(this.baseDir, 'lancedb-pro');
        this.keyChain = new KeyChain();
        
        this.store = null;
        this.retriever = null;
        this.embedder = null;
        this.ollamaClient = null;
    }

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit().catch(e => {
            this._initPromise = null;
            throw e;
        });
        return this._initPromise;
    }

    async _doInit() {
        if (!fs.existsSync(this.baseDir)) fs.mkdirSync(this.baseDir, { recursive: true });

        // Use jiti to load memory-lancedb-pro components from sub-modules
        if (!cachedJiti) {
            const { createJiti } = require('jiti');
            cachedJiti = createJiti(__filename);
        }
        
        const { MemoryStore } = await cachedJiti.import('memory-lancedb-pro/src/store.js');
        const { createRetriever, DEFAULT_RETRIEVAL_CONFIG } = await cachedJiti.import('memory-lancedb-pro/src/retriever.js');
        
        // 1. Setup Embedder Wrapper
        const projectEmbedder = await this._getProjectEmbedder();
        this.embedder = {
            embedQuery: async (text) => projectEmbedder.getEmbedding(text),
            embedPassage: async (text) => projectEmbedder.getEmbedding(text),
            dimensions: projectEmbedder.dimensions || 768
        };

        // Determine dimensions dynamically
        const testEmbedding = await this.embedder.embedQuery("test");
        this.embedder.dimensions = testEmbedding.length;
        
        // 🚀 Set isolated DB Path based on dimensions to avoid mismatch errors
        this.dbPath = path.join(this.baseDir, 'lancedb-pro', `dim_${this.embedder.dimensions}`);
        if (!fs.existsSync(this.dbPath)) fs.mkdirSync(this.dbPath, { recursive: true });
        
        console.log(`🧠 [Memory:Pro] Using embedding dimensions: ${this.embedder.dimensions}`);
        console.log(`📂 [Memory:Pro] Database isolated at: ${this.dbPath}`);

        // 2. Initialize Store
        this.store = new MemoryStore({
            dbPath: this.dbPath,
            vectorDim: this.embedder.dimensions
        });

        // 3. Initialize Retriever
        this.retriever = createRetriever(this.store, this.embedder, {
            ...DEFAULT_RETRIEVAL_CONFIG,
            mode: "hybrid",
        });

        console.log(`✅ [Memory:Pro] LanceDB Pro Driver 就緒`);
    }

    async _getProjectEmbedder() {
        const { EmbeddingFactory } = require('./embeddings');
        return EmbeddingFactory.create(this.keyChain);
    }

    async recall(query, limit = 5) {
        if (!this.retriever) await this.init();
        try {
            const results = await this.retriever.retrieve({
                query,
                limit,
                source: "manual"
            });

            const normalized = results.map(r => ({
                text: r.entry.text,
                score: r.score,
                metadata: this._safeParseMetadata(r.entry.metadata),
                timestamp: r.entry.timestamp
            }));

            return await this._maybeRerank(query, normalized, limit);
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Recall error:", e.message);
            return [];
        }
    }

    async memorize(text, metadata = {}) {
        if (!this.store) await this.init();
        try {
            const vector = await this.embedder.embedPassage(text);
            await this.store.store({
                text,
                vector,
                category: metadata.category || "other",
                scope: metadata.scope || "global",
                importance: metadata.importance || 0.5,
                metadata: JSON.stringify(metadata)
            });
            console.log(`🧠 [Memory:Pro] 已紀錄記憶 (${text.substring(0, 20)}...)`);
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Memorize error:", e.message);
        }
    }

    async clearMemory() {
        const rootDir = path.join(this.baseDir, 'lancedb-pro');
        let removedEntries = 0;
        let removedBytes = 0;

        try {
            if (fs.existsSync(rootDir)) {
                const stack = [rootDir];
                while (stack.length > 0) {
                    const current = stack.pop();
                    const stat = fs.statSync(current);
                    if (stat.isDirectory()) {
                        const children = fs.readdirSync(current).map((name) => path.join(current, name));
                        stack.push(...children);
                    } else {
                        removedEntries += 1;
                        removedBytes += Number(stat.size || 0);
                    }
                }
                fs.rmSync(rootDir, { recursive: true, force: true });
                removedEntries += 1; // root dir itself
            }

            this.store = null;
            this.retriever = null;
            this.embedder = null;
            this._initPromise = null;

            console.log(`🗑️ [Memory:Pro] Memory cleared at ${rootDir} (entries=${removedEntries}, bytes=${removedBytes})`);
            return { cleared: removedEntries, bytes: removedBytes };
        } catch (e) {
            console.warn("⚠️ [Memory:Pro] Clear memory error:", e.message);
            return { cleared: removedEntries, bytes: removedBytes, error: e.message };
        }
    }

    async exportMemory() {
        if (!this.store) return JSON.stringify([]);
        const all = await this.store.list([], undefined, 1000);
        return JSON.stringify(all, null, 2);
    }

    async importMemory(jsonData) {
        try {
            const list = JSON.parse(jsonData);
            if (!Array.isArray(list)) return { success: false, error: "Must be an array" };
            for (const item of list) {
                await this.memorize(item.text, item.metadata || item);
            }
            return { success: true, count: list.length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    _safeParseMetadata(raw) {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return {};
        }
    }

    _getOllamaClient() {
        if (!this.ollamaClient) {
            this.ollamaClient = new OllamaClient({
                baseUrl: CONFIG.OLLAMA_BASE_URL,
                timeoutMs: CONFIG.OLLAMA_TIMEOUT_MS
            });
        }
        return this.ollamaClient;
    }

    async _maybeRerank(query, results, limit) {
        const rerankModel = String(CONFIG.OLLAMA_RERANK_MODEL || '').trim();
        if (!rerankModel || results.length === 0) return results.slice(0, limit);

        try {
            const reranked = await this._getOllamaClient().rerank(query, results.map(item => item.text), {
                model: rerankModel,
                embeddingFallbackModel: CONFIG.OLLAMA_EMBEDDING_MODEL
            });

            if (!Array.isArray(reranked) || reranked.length === 0) {
                return results.slice(0, limit);
            }

            const ordered = [];
            const seen = new Set();

            for (const item of reranked) {
                if (!Number.isInteger(item.index)) continue;
                if (item.index < 0 || item.index >= results.length) continue;
                if (seen.has(item.index)) continue;
                seen.add(item.index);
                ordered.push({
                    ...results[item.index],
                    score: Number(item.score) || results[item.index].score
                });
            }

            for (let i = 0; i < results.length; i += 1) {
                if (!seen.has(i)) ordered.push(results[i]);
            }

            return ordered.slice(0, limit);
        } catch (e) {
            console.warn(`⚠️ [Memory:Pro] Ollama rerank failed, fallback to original ranking: ${e.message}`);
            return results.slice(0, limit);
        }
    }
}

module.exports = LanceDBProDriver;
