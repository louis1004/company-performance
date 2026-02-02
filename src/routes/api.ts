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

    const quarters = getLast6Quarters();
    const statements = [];
    
    const reportCodes: Record<string, string> = {
      'Q1': '11013', 'Q2': '11012', 'Q3': '11014', 'Q4': '11011'
    };
    
    for (const quarter of quarters) {
      try {
        const data = await dartClient.getFinancialStatements(
          corpCode,
          quarter.year,
          reportCodes[quarter.quarter]
        );
        if (data.length > 0) {
          statements.push(...data);
        }
      } catch (e) {
        // Skip failed quarters
      }
    }
    
    const processed = processFinancialData(statements);
    const qoqData = calculateQoQChanges(processed);
    
    const chartData = qoqData.quarters.map((q, i) => ({
      quarter: `${q.year}-${q.quarter}`,
      revenue: qoqData.revenue[i]?.value || 0,
      operatingProfit: qoqData.operatingProfit[i]?.value || 0,
      netIncome: qoqData.netIncome[i]?.value || 0
    }));
    
    const response = {
      quarters: qoqData.quarters,
      metrics: {
        revenue: qoqData.revenue,
        operatingProfit: qoqData.operatingProfit,
        netIncome: qoqData.netIncome
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
 */
api.get('/companies/:corpCode/ratios', async (c) => {
  const corpCode = c.req.param('corpCode');
  const dartClient = createDARTClient(c.env.DART_API_KEY);
  
  try {
    const currentYear = new Date().getFullYear().toString();
    const financialDetails = await dartClient.getFinancialDetails(corpCode, currentYear);
    
    const companyInfo = await dartClient.getCompanyInfo(corpCode);
    const stockPrice = await getCurrentPrice(companyInfo.stockCode);
    
    const statements = await dartClient.getFinancialStatements(corpCode, currentYear, '11011');
    const netIncome = statements[0]?.netIncome || 0;
    
    const ratios = calculateAllRatios(financialDetails, stockPrice, netIncome);
    
    // EPS 소수점 제거
    if (ratios.eps !== null) {
      ratios.eps = Math.round(ratios.eps);
    }
    
    return c.json({
      ratios,
      calculatedAt: new Date().toISOString()
    });
  } catch (error) {
    const errorResponse = handleError(error);
    return c.json(errorResponse, 500);
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
    const articles = await scrapeNews(companyInfo.corpName, 10);
    
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
