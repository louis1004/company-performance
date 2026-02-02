/**
 * Cache Manager for Cloudflare KV
 */

export const CACHE_TTL = {
  COMPANY_LIST: 86400,
  COMPANY_INFO: 3600,
  FINANCIAL_DATA: 3600,
  DISCLOSURES: 1800,
  NEWS: 900
} as const;

export const CACHE_KEYS = {
  COMPANY_LIST: 'company-list',
  COMPANY_INFO: (corpCode: string) => `company-info:${corpCode}`,
  FINANCIAL: (corpCode: string, date: string) => `financial:${corpCode}:${date}`,
  DISCLOSURES: (corpCode: string) => `disclosures:${corpCode}`,
  NEWS: (corpCode: string) => `news:${corpCode}`
} as const;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface ICacheManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class KVCacheManager implements ICacheManager {
  private kv: KVNamespace | null;
  private memoryCache: Map<string, CacheEntry<any>>;

  constructor(kv?: KVNamespace) {
    this.kv = kv || null;
    this.memoryCache = new Map();
  }

  async get<T>(key: string): Promise<T | null> {
    const memEntry = this.memoryCache.get(key);
    if (memEntry && !this.isExpired(memEntry)) {
      return memEntry.data as T;
    }

    if (this.kv) {
      try {
        const kvData = await this.kv.get(key, 'json');
        if (kvData) {
          const entry = kvData as CacheEntry<T>;
          if (!this.isExpired(entry)) {
            this.memoryCache.set(key, entry);
            return entry.data;
          }
        }
      } catch {}
    }

    return null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000
    };

    this.memoryCache.set(key, entry);

    if (this.kv) {
      try {
        await this.kv.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds });
      } catch {}
    }
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    if (this.kv) {
      try {
        await this.kv.delete(key);
      } catch {}
    }
  }

  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }
}

export function createCacheManager(kv?: KVNamespace): ICacheManager {
  return new KVCacheManager(kv);
}
