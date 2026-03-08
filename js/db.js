/**
 * db.js - IndexedDB abstraction layer
 * Stores: fields, trips, tracks, costs, config
 */
const DB_NAME = 'TreckerDB';
const DB_VERSION = 1;

const STORES = {
    fields: { keyPath: 'id', indexes: [] },
    trips: { keyPath: 'id', indexes: ['fieldId', 'date'] },
    tracks: { keyPath: 'id', indexes: ['tripId'] },
    costs: { keyPath: 'id', indexes: ['tripId'] },
    config: { keyPath: 'key', indexes: [] },
};

class TreckerDB {
    constructor() {
        this.db = null;
    }

    async open() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                for (const [name, opts] of Object.entries(STORES)) {
                    if (!db.objectStoreNames.contains(name)) {
                        const store = db.createObjectStore(name, { keyPath: opts.keyPath });
                        opts.indexes.forEach(idx => store.createIndex(idx, idx, { unique: false }));
                    }
                }
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async _tx(storeName, mode, fn) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const req = fn(store);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    // Generate a unique ID
    uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // PUT (create or update)
    async put(storeName, data) {
        if (!data.id) data.id = this.uid();
        if (!data.createdAt) data.createdAt = new Date().toISOString();
        data.updatedAt = new Date().toISOString();
        await this._tx(storeName, 'readwrite', (s) => s.put(data));
        return data;
    }

    // GET one by key
    async get(storeName, key) {
        return this._tx(storeName, 'readonly', (s) => s.get(key));
    }

    // GET all
    async getAll(storeName) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    // DELETE by key
    async delete(storeName, key) {
        return this._tx(storeName, 'readwrite', (s) => s.delete(key));
    }

    // GET by index value
    async getByIndex(storeName, indexName, value) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const req = index.getAll(value);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    // CONFIG helpers
    async getConfig(key, defaultValue = null) {
        const rec = await this.get('config', key);
        return rec ? rec.value : defaultValue;
    }

    async setConfig(key, value) {
        await this._tx('config', 'readwrite', (s) => s.put({ key, value, updatedAt: new Date().toISOString() }));
    }
}

window.DB = new TreckerDB();
