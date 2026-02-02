/**
 * DART OpenAPI Client
 * 
 * Interface with DART OpenAPI for financial data retrieval.
 * Base URL: https://opendart.fss.or.kr/api/
 */

import type { 
  Company, 
  CompanyInfo, 
  FinancialStatement, 
  Disclosure, 
  FinancialDetails 
} from '../types';
import AdmZip from 'adm-zip';
import { parseStringPromise } from 'xml2js';

const DART_BASE_URL = 'https://opendart.fss.or.kr/api';

interface DARTResponse<T> {
  status: string;
  message: string;
  list?: T[];
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000
};

const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (error instanceof DARTAPIError && error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }
      if (attempt < config.maxRetries) {
        const delay = config.baseDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

export class DARTAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public dartStatus?: string
  ) {
    super(message);
    this.name = 'DARTAPIError';
  }
}

export class DARTClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = DART_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('crtfc_key', this.apiKey);
    
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new DARTAPIError(
        `DART API request failed: ${response.statusText}`,
        response.status
      );
    }
    
    const data = await response.json() as DARTResponse<T>;
    
    if (data.status !== '000') {
      throw new DARTAPIError(
        data.message || 'DART API error',
        400,
        data.status
      );
    }
    
    return data as T;
  }

  async getCompanyList(): Promise<Company[]> {
    const url = `${this.baseUrl}/corpCode.xml?crtfc_key=${this.apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new DARTAPIError(
        `Failed to fetch company list: ${response.statusText}`,
        response.status
      );
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // ZIP 압축 해제
    const zip = new AdmZip(buffer);
    const xmlData = zip.readAsText('CORPCODE.xml');
    
    // XML 파싱
    const result = await parseStringPromise(xmlData);
    const list = result.result.list || [];
    
    // 상장 기업만 필터링 (stock_code가 있는 기업)
    const companies: Company[] = list
      .filter((item: any) => item.stock_code && item.stock_code[0].trim() !== '')
      .map((item: any): Company => ({
        corpCode: item.corp_code[0],
        corpName: item.corp_name[0],
        stockCode: item.stock_code[0].trim(),
        market: item.corp_cls[0] === 'Y' ? 'KOSPI' : 
                (item.corp_cls[0] === 'K' ? 'KOSDAQ' : 'KONEX')
      }));
    
    return companies;
  }


  async getCompanyInfo(corpCode: string): Promise<CompanyInfo> {
    return withRetry(async () => {
      const response = await this.request<any>('/company.json', {
        corp_code: corpCode
      });
      
      return {
        corpCode: response.corp_code,
        corpName: response.corp_name,
        stockCode: response.stock_code || '',
        market: response.corp_cls === 'Y' ? 'KOSPI' : 'KOSDAQ',
        ceoName: response.ceo_nm,
        industry: response.induty_code,
        address: response.adres
      };
    });
  }

  async getFinancialStatements(
    corpCode: string,
    year: string,
    reportCode: string = '11013'
  ): Promise<FinancialStatement[]> {
    return withRetry(async () => {
      const response = await this.request<DARTResponse<any>>(
        '/fnlttSinglAcntAll.json',
        {
          corp_code: corpCode,
          bsns_year: year,
          reprt_code: reportCode,
          fs_div: 'CFS'
        }
      );
      
      if (!response.list) return [];

      const quarterMap: Record<string, 'Q1' | 'Q2' | 'Q3' | 'Q4'> = {
        '11013': 'Q1', '11012': 'Q2', '11014': 'Q3', '11011': 'Q4'
      };
      
      const revenue = response.list.find(
        (item: any) => item.account_nm === '매출액' || item.account_nm === '수익(매출액)'
      );
      const operatingProfit = response.list.find(
        (item: any) => item.account_nm === '영업이익' || item.account_nm === '영업이익(손실)'
      );
      const netIncome = response.list.find(
        (item: any) => item.account_nm === '당기순이익' || 
                       item.account_nm === '당기순이익(손실)' ||
                       item.account_nm.includes('지배기업')
      );
      
      return [{
        year,
        quarter: quarterMap[reportCode] || 'Q4',
        revenue: this.parseAmount(revenue?.thstrm_amount),
        operatingProfit: this.parseAmount(operatingProfit?.thstrm_amount),
        netIncome: this.parseAmount(netIncome?.thstrm_amount)
      }];
    });
  }

  async getDisclosures(corpCode: string, limit: number = 5): Promise<Disclosure[]> {
    return withRetry(async () => {
      const response = await this.request<DARTResponse<any>>('/list.json', {
        corp_code: corpCode,
        page_count: String(limit)
      });
      
      if (!response.list) return [];

      return response.list.slice(0, limit).map((item: any) => ({
        reportNm: item.report_nm,
        rcept_no: item.rcept_no,
        rcept_dt: item.rcept_dt,
        flr_nm: item.flr_nm
      }));
    });
  }

  async getFinancialDetails(
    corpCode: string,
    year: string,
    reportCode: string = '11011'
  ): Promise<FinancialDetails> {
    return withRetry(async () => {
      const response = await this.request<DARTResponse<any>>(
        '/fnlttSinglAcntAll.json',
        {
          corp_code: corpCode,
          bsns_year: year,
          reprt_code: reportCode,
          fs_div: 'CFS'
        }
      );
      
      if (!response.list) {
        return { totalAssets: 0, totalEquity: 0, totalShares: 0, ebitda: 0, bookValue: 0 };
      }
      
      const totalAssets = response.list.find((item: any) => item.account_nm === '자산총계');
      const totalEquity = response.list.find(
        (item: any) => item.account_nm === '자본총계' || item.account_nm.includes('지배기업 소유주지분')
      );

      const stockInfo = await this.request<any>('/company.json', { corp_code: corpCode });
      
      const totalShares = parseInt(stockInfo.stock_total || '0', 10);
      const totalAssetsValue = this.parseAmount(totalAssets?.thstrm_amount);
      const totalEquityValue = this.parseAmount(totalEquity?.thstrm_amount);
      
      return {
        totalAssets: totalAssetsValue,
        totalEquity: totalEquityValue,
        totalShares,
        ebitda: 0,
        bookValue: totalShares > 0 ? totalEquityValue / totalShares : 0
      };
    });
  }

  private parseAmount(amount: string | undefined): number {
    if (!amount) return 0;
    const cleaned = amount.replace(/,/g, '').replace(/\s/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
}

export function createDARTClient(apiKey: string): DARTClient {
  return new DARTClient(apiKey);
}
