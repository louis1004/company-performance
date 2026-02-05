/**
 * API Routes
 * 
 * All API endpoints for the company performance service.
 * Includes Cache-Control headers and ETag support for optimal caching.
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { createDARTClient } from '../clients/dart-client';
import { createCacheManager, CACHE_TTL, CACHE_KEYS, SWR_CONFIG } from '../cache/cache-manager';
import { getSearchService } from '../services/search-service';
import { getLast6Quarters, calculateQoQChanges, processFinancialData } from '../processors/financial-processor';
import { calculateAllRatios } from '../processors/ratio-calculator';
import { scrapeNews } from '../scrapers/news-scraper';
import { getCurrentPrice, formatStockPrice, getStockData } from '../providers/stock-price-provider';
import { handleError, ERROR_MESSAGES } from '../utils/error-handler';

const api = new Hono<{ Bindings: Env }>();

/**
 * ETag 생성 함수
 */
function generateETag(data: any): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `"${Math.abs(hash).toString(16)}"`;
}

/**
 * Cache-Control 헤더 설정 함수
 */
function setCacheHeaders(c: Context, maxAge: number, staleWhileRevalidate?: number): void {
  let cacheControl = `public, max-age=${maxAge}`;
  if (staleWhileRevalidate) {
    cacheControl += `, stale-while-revalidate=${staleWhileRevalidate}`;
  }
  c.header('Cache-Control', cacheControl);
}

/**
 * 조건부 요청 처리 (If-None-Match)
 */
function handleConditionalRequest(c: Context, etag: string): boolean {
  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return true; // 304 반환 필요
  }
  return false;
}

/**
 * Search endpoint - GET /api/companies/search?q={query}
 */
api.get('/companies/search', async (c) => {
  const query = c.req.query('q');
  
  if (!query || query.length < 2) {
    return c.json({
      companies: [],
      total: 0,
      message: ERROR_MESSAGES.INVALID_QUERY
    });
  }
  
  const searchService = getSearchService();
  
  if (!searchService.isInitialized()) {
    const cache = createCacheManager(c.env.COMPANY_CACHE);
    const cachedList = await cache.get<any[]>(CACHE_KEYS.COMPANY_LIST);
    
    if (cachedList) {
      searchService.initializeIndex(cachedList);
    }
  }
  
  const companies = searchService.search(query, 10);
  
  const response = {
    companies,
    total: companies.length
  };
  
  // Cache-Control 및 ETag 설정
  const etag = generateETag(response);
  if (handleConditionalRequest(c, etag)) {
    return c.body(null, 304);
  }
  
  setCacheHeaders(c, 60, 120); // 1분 캐시, 2분 stale-while-revalidate
  c.header('ETag', etag);
  
  return c.json(response);
});

/**
 * Company details endpoint - GET /api/companies/{corpCode}
 */
api.get('/companies/:corpCode', async (c) => {
  const corpCode = c.req.param('corpCode');
  const cache = createCacheManager(c.env.COMPANY_CACHE);
  const dartClient = createDARTClient(c.env.DART_API_KEY);
  
  try {
    const cacheKey = CACHE_KEYS.COMPANY_INFO(corpCode);
    const cached = await cache.get<any>(cacheKey);
    
    if (cached) {
      const etag = generateETag(cached);
      if (handleConditionalRequest(c, etag)) {
        return c.body(null, 304);
      }
      setCacheHeaders(c, SWR_CONFIG.COMPANY_INFO.staleTime, SWR_CONFIG.COMPANY_INFO.maxAge);
      c.header('ETag', etag);
      return c.json(cached);
    }
    
    const companyInfo = await dartClient.getCompanyInfo(corpCode);
    const stockPrice = await getCurrentPrice(companyInfo.stockCode);
    
    const response = {
      company: companyInfo,
      stockPrice,
      formattedPrice: formatStockPrice(stockPrice),
      lastUpdated: new Date().toISOString()
    };
    
    await cache.set(cacheKey, response, CACHE_TTL.COMPANY_INFO);
    
    const etag = generateETag(response);
    setCacheHeaders(c, SWR_CONFIG.COMPANY_INFO.staleTime, SWR_CONFIG.COMPANY_INFO.maxAge);
    c.header('ETag', etag);
    
    return c.json(response);
  } catch (error) {
    const errorResponse = handleError(error);
    return c.json(errorResponse, 500);
  }
});

/**
 * Financial performance endpoint - GET /api/companies/{corpCode}/financial
 */
api.get('/companies/:corpCode/financial', async (c) => {
  const corpCode = c.req.param('corpCode');
  const cache = createCacheManager(c.env.COMPANY_CACHE);
  const dartClient = createDARTClient(c.env.DART_API_KEY);
  
  try {
    const cacheKey = CACHE_KEYS.FINANCIAL(corpCode, new Date().toISOString().split('T')[0]);
    const cached = await cache.get<any>(cacheKey);
    
    if (cached) {
      const etag = generateETag(cached);
      if (handleConditionalRequest(c, etag)) {
        return c.body(null, 304);
      }
      setCacheHeaders(c, SWR_CONFIG.FINANCIAL_DATA.staleTime, SWR_CONFIG.FINANCIAL_DATA.maxAge);
      c.header('ETag', etag);
      return c.json(cached);
    }

    // 최근 6개 분기 + 누적값 계산을 위한 추가 분기 데이터 필요
    // 예: 2024-Q3 단독값 = 2024-Q3 누적 - 2024-Q2 누적
    // 따라서 2024-Q1, Q2 데이터도 필요
    const currentYear = new Date().getFullYear();
    const statements = [];
    
    const reportCodes: Record<string, string> = {
      'Q1': '11013', 'Q2': '11012', 'Q3': '11014', 'Q4': '11011'
    };
    
    // 최근 4년간 모든 분기 데이터 가져오기 (3개년 연간 실적 + 누적값 계산용)
    const yearsToFetch = [currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
    const quartersToFetch = ['Q1', 'Q2', 'Q3', 'Q4'];
    
    for (const year of yearsToFetch) {
      for (const quarter of quartersToFetch) {
        try {
          const data = await dartClient.getFinancialStatements(
            corpCode,
            year.toString(),
            reportCodes[quarter]
          );
          if (data.length > 0) {
            statements.push(...data);
          }
        } catch (e) {
          // Skip failed quarters
        }
      }
    }
    
    const processed = processFinancialData(statements);
    const qoqData = calculateQoQChanges(processed);
    
    // 최근 12개 분기 (3년치) 반환
    const maxQuarters = 12;
    const startIdx = Math.max(0, qoqData.quarters.length - maxQuarters);
    
    const chartData = qoqData.quarters.slice(startIdx).map((q, i) => ({
      quarter: `${q.year}-${q.quarter}`,
      revenue: qoqData.revenue[startIdx + i]?.value || 0,
      operatingProfit: qoqData.operatingProfit[startIdx + i]?.value || 0,
      netIncome: qoqData.netIncome[startIdx + i]?.value || 0
    }));
    
    const response = {
      quarters: qoqData.quarters.slice(startIdx),
      metrics: {
        revenue: qoqData.revenue.slice(startIdx),
        operatingProfit: qoqData.operatingProfit.slice(startIdx),
        netIncome: qoqData.netIncome.slice(startIdx)
      },
      chartData
    };
    
    await cache.set(cacheKey, response, CACHE_TTL.FINANCIAL_DATA);
    
    const etag = generateETag(response);
    setCacheHeaders(c, SWR_CONFIG.FINANCIAL_DATA.staleTime, SWR_CONFIG.FINANCIAL_DATA.maxAge);
    c.header('ETag', etag);
    
    return c.json(response);
  } catch (error) {
    const errorResponse = handleError(error);
    return c.json(errorResponse, 500);
  }
});

/**
 * Financial ratios endpoint - GET /api/companies/{corpCode}/ratios
 * 네이버 증권에서 투자 지표 가져오기 (PER, PBR, ROE, 배당수익률)
 */
api.get('/companies/:corpCode/ratios', async (c) => {
  const corpCode = c.req.param('corpCode');
  const dartClient = createDARTClient(c.env.DART_API_KEY);
  
  try {
    const companyInfo = await dartClient.getCompanyInfo(corpCode);
    
    // 네이버 증권에서 모든 투자 지표 가져오기
    const stockData = await getStockData(companyInfo.stockCode);
    const { 
      price: stockPrice, 
      sharesOutstanding, 
      dividendYield, 
      per, 
      pbr, 
      roe, 
      eps, 
      high52w, 
      low52w,
      operatingMargin,
      debtRatio,
      currentRatio
    } = stockData;
    
    // 시가총액 계산
    const marketCap = sharesOutstanding > 0 && stockPrice > 0 ? stockPrice * sharesOutstanding : null;
    
    const response = {
      ratios: { 
        per: per > 0 ? per : null, 
        pbr: pbr > 0 ? pbr : null, 
        roe: roe > 0 ? roe : null, 
        dividendYield: dividendYield > 0 ? dividendYield : null,
        eps: eps > 0 ? eps : null,
        high52w: high52w > 0 ? high52w : null,
        low52w: low52w > 0 ? low52w : null,
        // 새로운 재무비율
        operatingMargin: operatingMargin > 0 ? operatingMargin : null,
        debtRatio: debtRatio > 0 ? debtRatio : null,
        currentRatio: currentRatio > 0 ? currentRatio : null
      },
      stockPrice,
      marketCap,
      totalShares: sharesOutstanding,
      calculatedAt: new Date().toISOString()
    };
    
    const etag = generateETag(response);
    if (handleConditionalRequest(c, etag)) {
      return c.body(null, 304);
    }
    setCacheHeaders(c, 300, 600); // 5분 캐시, 10분 stale-while-revalidate
    c.header('ETag', etag);
    
    return c.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      ratios: { per: null, pbr: null, roe: null, dividendYield: null, eps: null, high52w: null, low52w: null, operatingMargin: null, debtRatio: null, currentRatio: null },
      calculatedAt: new Date().toISOString(),
      message: '재무비율 데이터를 계산할 수 없습니다.',
      error: errorMessage
    });
  }
});

/**
 * Disclosures endpoint - GET /api/companies/{corpCode}/disclosures
 */
api.get('/companies/:corpCode/disclosures', async (c) => {
  const corpCode = c.req.param('corpCode');
  const cache = createCacheManager(c.env.COMPANY_CACHE);
  const dartClient = createDARTClient(c.env.DART_API_KEY);
  
  try {
    const cacheKey = CACHE_KEYS.DISCLOSURES(corpCode);
    const cached = await cache.get<any>(cacheKey);
    
    if (cached) {
      const etag = generateETag(cached);
      if (handleConditionalRequest(c, etag)) {
        return c.body(null, 304);
      }
      setCacheHeaders(c, SWR_CONFIG.DISCLOSURES.staleTime, SWR_CONFIG.DISCLOSURES.maxAge);
      c.header('ETag', etag);
      return c.json(cached);
    }
    
    const disclosures = await dartClient.getDisclosures(corpCode, 5);
    const sorted = disclosures.sort((a, b) => b.rcept_dt.localeCompare(a.rcept_dt));
    
    const withUrls = sorted.map(d => ({
      ...d,
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`
    }));
    
    const response = {
      disclosures: withUrls,
      total: withUrls.length
    };
    
    await cache.set(cacheKey, response, CACHE_TTL.DISCLOSURES);
    
    const etag = generateETag(response);
    setCacheHeaders(c, SWR_CONFIG.DISCLOSURES.staleTime, SWR_CONFIG.DISCLOSURES.maxAge);
    c.header('ETag', etag);
    
    return c.json(response);
  } catch (error) {
    const errorResponse = handleError(error);
    return c.json(errorResponse, 500);
  }
});

/**
 * News endpoint - GET /api/companies/{corpCode}/news
 */
api.get('/companies/:corpCode/news', async (c) => {
  const corpCode = c.req.param('corpCode');
  const cache = createCacheManager(c.env.COMPANY_CACHE);
  const dartClient = createDARTClient(c.env.DART_API_KEY);
  
  try {
    const cacheKey = CACHE_KEYS.NEWS(corpCode);
    const cached = await cache.get<any>(cacheKey);
    
    if (cached) {
      const etag = generateETag(cached);
      if (handleConditionalRequest(c, etag)) {
        return c.body(null, 304);
      }
      setCacheHeaders(c, SWR_CONFIG.NEWS.staleTime, SWR_CONFIG.NEWS.maxAge);
      c.header('ETag', etag);
      return c.json(cached);
    }
    
    const companyInfo = await dartClient.getCompanyInfo(corpCode);
    // stockCode를 전달하여 네이버 증권 API 사용
    const articles = await scrapeNews(companyInfo.corpName, 10, companyInfo.stockCode);
    
    const response = {
      articles,
      total: articles.length
    };
    
    await cache.set(cacheKey, response, CACHE_TTL.NEWS);
    
    const etag = generateETag(response);
    setCacheHeaders(c, SWR_CONFIG.NEWS.staleTime, SWR_CONFIG.NEWS.maxAge);
    c.header('ETag', etag);
    
    return c.json(response);
  } catch (error) {
    const errorResponse = handleError(error);
    return c.json(errorResponse, 500);
  }
});

export default api;
