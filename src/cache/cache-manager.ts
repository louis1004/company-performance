/**
 * Cache Manager for Cloudflare KV with SWR (Stale-While-Revalidate) support
 */

export const CACHE_TTL = {
  COMPANY_LIST: 86400,
  COMPANY_INFO: 3600,
  FINANCIAL_DATA: 3600,
  DISCLOSURES: 1800,
  NEWS: 900
} as const;

// SWR 설정: stale 시간은 TTL의 절반
export const SWR_CONFIG = {
  COMPANY_INFO: { maxAge: 3600, staleTime: 1800 },
  FINANCIAL_DATA: { maxAge: 3600, staleTime: 1800 },
  DISCLOSURES: { maxAge: 1800, staleTime: 900 },
  NEWS: { maxAge: 900, staleTime: 450 }
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
  staleTime?: number;
}

export interface SWROptions {
  maxAge: number;      // 캐시 유효 시간 (초)
  staleTime: number;   // stale 상태 시간 (초)
}

export interface SWRResult<T> {
  data: T | null;
  isStale: boolean;
  isValidating: boolean;
  error: Error | null;
}

export type CacheStatus = 'fresh' | 'stale' | 'expired' | 'missing';

export interface ICacheManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  getWithSWR<T>(key: string, fetcher: () => Promise<T>, options: SWROptions): Promise<SWRResult<T>>;
  getCacheStatus(key: string): Promise<CacheStatus>;
}

export class KVCacheManager implements ICacheManager {
  private kv: KVNamespace | null;
  private memoryCache: Map<string, CacheEntry<any>>;
  private revalidatingKeys: Set<string>;

  constructor(kv?: KVNamespace) {
    this.kv = kv || null;
    this.memoryCache = new Map();
    this.revalidatingKeys = new Set();
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

  async set<T>(key: string, value: T, ttlSeconds: number, staleTime?: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000,
      staleTime: staleTime ? staleTime * 1000 : undefined
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

  /**
   * SWR 패턴으로 데이터 가져오기
   * - 캐시된 데이터가 있으면 즉시 반환
   * - stale 상태면 백그라운드에서 갱신
   * - 갱신 실패 시 기존 데이터 유지
   */
  async getWithSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: SWROptions
  ): Promise<SWRResult<T>> {
    const entry = await this.getEntry<T>(key);
    const now = Date.now();

    if (entry) {
      const age = now - entry.timestamp;
      const staleTime = (entry.staleTime || options.staleTime * 1000);
      const maxAge = entry.ttl || options.maxAge * 1000;
      
      const isStale = age > staleTime;
      const isExpired = age > maxAge;

      if (!isExpired) {
        // 캐시된 데이터 즉시 반환
        const result: SWRResult<T> = {
          data: entry.data,
          isStale,
          isValidating: isStale && !this.revalidatingKeys.has(key),
          error: null
        };

        // stale이면 백그라운드에서 갱신
        if (isStale && !this.revalidatingKeys.has(key)) {
          this.revalidateInBackground(key, fetcher, options);
        }

        return result;
      }
    }

    // 캐시 없거나 만료됨 - 새로 가져오기
    try {
      const data = await fetcher();
      await this.set(key, data, options.maxAge, options.staleTime);
      return { data, isStale: false, isValidating: false, error: null };
    } catch (error) {
      // 갱신 실패 시 기존 캐시 데이터 반환 (있으면)
      if (entry) {
        return { data: entry.data, isStale: true, isValidating: false, error: error as Error };
      }
      return { data: null, isStale: false, isValidating: false, error: error as Error };
    }
  }

  /**
   * 캐시 상태 확인
   */
  async getCacheStatus(key: string): Promise<CacheStatus> {
    const entry = await this.getEntry(key);
    if (!entry) return 'missing';

    const now = Date.now();
    const age = now - entry.timestamp;
    const staleTime = entry.staleTime || entry.ttl / 2;

    if (age > entry.ttl) return 'expired';
    if (age > staleTime) return 'stale';
    return 'fresh';
  }

  private async getEntry<T>(key: string): Promise<CacheEntry<T> | null> {
    const memEntry = this.memoryCache.get(key);
    if (memEntry) {
      return memEntry as CacheEntry<T>;
    }

    if (this.kv) {
      try {
        const kvData = await this.kv.get(key, 'json');
        if (kvData) {
          const entry = kvData as CacheEntry<T>;
          this.memoryCache.set(key, entry);
          return entry;
        }
      } catch {}
    }

    return null;
  }

  private async revalidateInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: SWROptions
  ): Promise<void> {
    if (this.revalidatingKeys.has(key)) return;
    
    this.revalidatingKeys.add(key);
    
    try {
      const data = await fetcher();
      await this.set(key, data, options.maxAge, options.staleTime);
    } catch (error) {
      // 갱신 실패 시 기존 데이터 유지 (아무것도 하지 않음)
      console.error(`Background revalidation failed for key: ${key}`, error);
    } finally {
      this.revalidatingKeys.delete(key);
    }
  }

  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }
}

export function createCacheManager(kv?: KVNamespace): ICacheManager {
  return new KVCacheManager(kv);
}
