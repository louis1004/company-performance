/**
 * API Routes
 * 
 * All API endpoints for the company performance service.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { createDARTClient } from '../clients/dart-client';
import { createCacheManager, CACHE_TTL, CACHE_KEYS } from '../cache/cache-manager';
import { getSearchService } from '../services/search-service';
import { getLast6Quarters, calculateQoQChanges, processFinancialData } from '../processors/financial-processor';
import { calculateAllRatios } from '../processors/ratio-calculator';
import { scrapeNews } from '../scrapers/news-scraper';
import { getCurrentPrice, formatStockPrice } from '../providers/stock-price-provider';
import { handleError, ERROR_MESSAGES } from '../utils/error-handler';

const api = new Hono<{ Bindings: Env }>();

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
  
  return c.json({
    companies,
    total: companies.length
  });
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
    
    // 최근 3년간 모든 분기 데이터 가져오기 (누적값 계산용)
    const yearsToFetch = [currentYear - 2, currentYear - 1, currentYear];
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
    
    // 최근 6개 분기만 반환
    const maxQuarters = 6;
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
    return c.json(response);
  } catch (error) {
    const errorResponse = handleError(error);
    return c.json(errorResponse, 500);
  }
});

/**
 * Financial ratios endpoint - GET /api/companies/{corpCode}/ratios
 * 최근 4개 분기 데이터를 합산하여 TTM(Trailing Twelve Months) 기준으로 계산
 */
api.get('/companies/:corpCode/ratios', async (c) => {
  const corpCode = c.req.param('corpCode');
  const dartClient = createDARTClient(c.env.DART_API_KEY);
  
  try {
    const companyInfo = await dartClient.getCompanyInfo(corpCode);
    const stockPrice = await getCurrentPrice(companyInfo.stockCode);
    
    // 최근 4개 분기 원시 데이터 가져오기
    const ttmData = await dartClient.getTTMFinancialData(corpCode);
    
    if (!ttmData || ttmData.quarters.length === 0) {
      return c.json({
        ratios: { eps: null, per: null, pbr: null, roa: null, roe: null },
        calculatedAt: new Date().toISOString(),
        message: '재무비율 데이터를 찾을 수 없습니다.'
      });
    }
    
    const { revenue, operatingProfit, netIncome, totalAssets, totalEquity, totalShares } = ttmData;
    
    // 비율 직접 계산
    const eps = totalShares > 0 ? Math.round(netIncome / totalShares) : null;
    const bps = totalShares > 0 ? Math.round(totalEquity / totalShares) : null;
    const per = eps && eps > 0 ? parseFloat((stockPrice / eps).toFixed(2)) : null;
    const pbr = bps && bps > 0 ? parseFloat((stockPrice / bps).toFixed(2)) : null;
    const roa = totalAssets > 0 ? parseFloat(((netIncome / totalAssets) * 100).toFixed(2)) : null;
    const roe = totalEquity > 0 ? parseFloat(((netIncome / totalEquity) * 100).toFixed(2)) : null;
    const operatingMargin = revenue > 0 ? parseFloat(((operatingProfit / revenue) * 100).toFixed(2)) : null;
    const netMargin = revenue > 0 ? parseFloat(((netIncome / revenue) * 100).toFixed(2)) : null;
    const marketCap = totalShares > 0 ? stockPrice * totalShares : null;
    
    return c.json({
      ratios: { eps, per, pbr, roa, roe, operatingMargin, netMargin },
      financials: {
        revenue,
        operatingProfit,
        netIncome,
        totalAssets,
        totalEquity
      },
      period: 'TTM',
      quarters: ttmData.quarters,
      stockPrice,
      marketCap,
      bps,
      totalShares,
      calculatedAt: new Date().toISOString()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      ratios: { eps: null, per: null, pbr: null, roa: null, roe: null },
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
    return c.json(response);
  } catch (error) {
    const errorResponse = handleError(error);
    return c.json(errorResponse, 500);
  }
});

export default api;
