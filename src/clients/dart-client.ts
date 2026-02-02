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
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

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
  maxRetries: 1,
  baseDelay: 500
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

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'manual'
    });
    
    // 리다이렉트 감지
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      throw new DARTAPIError(
        `DART API redirected to: ${location}`,
        response.status
      );
    }
    
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
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // ZIP 압축 해제 (fflate 사용)
    let unzipped;
    try {
      unzipped = unzipSync(uint8Array);
    } catch (unzipError) {
      throw new DARTAPIError(`Failed to unzip company list: ${unzipError}`, 500);
    }
    
    const xmlData = new TextDecoder().decode(unzipped['CORPCODE.xml']);
    
    // XML 파싱 (fast-xml-parser 사용)
    const parser = new XMLParser();
    const result = parser.parse(xmlData);
    const list = result.result?.list || [];
    
    // 배열이 아닌 경우 배열로 변환
    const items = Array.isArray(list) ? list : [list];
    
    // 상장 기업만 필터링 (stock_code가 있는 기업)
    const companies: Company[] = items
      .filter((item: any) => item.stock_code && String(item.stock_code).trim() !== '')
      .map((item: any): Company => ({
        corpCode: String(item.corp_code),
        corpName: String(item.corp_name),
        stockCode: String(item.stock_code).trim(),
        market: item.corp_cls === 'Y' ? 'KOSPI' : 
                (item.corp_cls === 'K' ? 'KOSDAQ' : 'KONEX')
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
      // 요약 재무정보 API 사용 (fnlttSinglAcnt) - 누적값 제공
      const response = await this.request<DARTResponse<any>>(
        '/fnlttSinglAcnt.json',
        {
          corp_code: corpCode,
          bsns_year: year,
          reprt_code: reportCode
        }
      );
      
      if (!response.list || response.list.length === 0) return [];

      // 연결재무제표(CFS)만 필터링
      const cfsList = response.list.filter((item: any) => item.fs_div === 'CFS');
      if (cfsList.length === 0) return [];

      // 응답 데이터의 실제 연도 확인
      const firstItem = cfsList[0];
      if (firstItem.bsns_year && firstItem.bsns_year !== year) {
        return [];
      }

      const quarterMap: Record<string, 'Q1' | 'Q2' | 'Q3' | 'Q4'> = {
        '11013': 'Q1', '11012': 'Q2', '11014': 'Q3', '11011': 'Q4'
      };
      
      // 손익계산서 항목 찾기
      const revenueItem = cfsList.find(
        (item: any) => item.sj_div === 'IS' && item.account_nm === '매출액'
      );
      const operatingProfitItem = cfsList.find(
        (item: any) => item.sj_div === 'IS' && item.account_nm === '영업이익'
      );
      const netIncomeItem = cfsList.find(
        (item: any) => item.sj_div === 'IS' && 
          (item.account_nm === '당기순이익(손실)' || item.account_nm === '당기순이익')
      );
      
      // Q1은 thstrm_amount 사용, Q2/Q3/Q4는 thstrm_add_amount(누적) 사용
      const isQ1 = reportCode === '11013';
      
      const getAmount = (item: any) => {
        if (!item) return 0;
        if (isQ1) {
          return this.parseAmount(item.thstrm_amount);
        }
        // Q2, Q3, Q4는 누적값(thstrm_add_amount) 사용
        return this.parseAmount(item.thstrm_add_amount || item.thstrm_amount);
      };
      
      return [{
        year,
        quarter: quarterMap[reportCode] || 'Q4',
        revenue: getAmount(revenueItem),
        operatingProfit: getAmount(operatingProfitItem),
        netIncome: getAmount(netIncomeItem)
      }];
    });
  }

  async getDisclosures(corpCode: string, limit: number = 5): Promise<Disclosure[]> {
    // 정기 공시만 필터링 (pblntf_ty=A), 최근 2년간
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const bgn_de = twoYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');
    
    const url = new URL(`${this.baseUrl}/list.json`);
    url.searchParams.set('crtfc_key', this.apiKey);
    url.searchParams.set('corp_code', corpCode);
    url.searchParams.set('pblntf_ty', 'A');
    url.searchParams.set('bgn_de', bgn_de);
    url.searchParams.set('page_count', String(limit));
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) return [];
    
    const data = await response.json() as any;
    
    // status가 000이 아니면 빈 배열 반환 (013: 조회된 데이터 없음)
    if (data.status !== '000' || !data.list) return [];

    return data.list.slice(0, limit).map((item: any) => ({
      reportNm: item.report_nm,
      rcept_no: item.rcept_no,
      rcept_dt: item.rcept_dt,
      flr_nm: item.flr_nm
    }));
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

  /**
   * 재무비율 계산을 위한 원시 데이터 추출
   * DART API에서 직접 EPS, 당기순이익, 자산총계, 자본총계, 발행주식수 추출
   */
  async getRawFinancialData(
    corpCode: string,
    year: string,
    reportCode: string = '11011'
  ): Promise<{
    netIncome: number;
    totalAssets: number;
    totalEquity: number;
    eps: number | null;
    totalShares: number;
  }> {
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
      
      if (!response.list || response.list.length === 0) {
        throw new DARTAPIError('재무제표 데이터가 없습니다.', 404);
      }
      
      // 당기순이익 찾기 (여러 가지 이름으로 존재할 수 있음)
      const netIncomeItem = response.list.find((item: any) => 
        item.account_nm === '당기순이익' || 
        item.account_nm === '당기순이익(손실)' ||
        item.account_nm.includes('지배기업의 소유주에게 귀속되는 당기순이익') ||
        item.sj_nm === '손익계산서' && item.account_nm.includes('당기순이익')
      );
      
      // 자산총계 찾기
      const totalAssetsItem = response.list.find((item: any) => 
        item.account_nm === '자산총계'
      );
      
      // 자본총계 찾기
      const totalEquityItem = response.list.find((item: any) => 
        item.account_nm === '자본총계' || 
        item.account_nm === '지배기업 소유주지분'
      );
      
      // 기본주당이익(EPS) 찾기 - DART에서 직접 제공
      const epsItem = response.list.find((item: any) => 
        item.account_nm === '기본주당이익' || 
        item.account_nm === '기본주당이익(손실)' ||
        item.account_nm.includes('기본주당순이익')
      );
      
      // 발행주식수 찾기 - 재무제표에서 추출 시도
      // 발행주식수는 보통 주석이나 별도 API에서 가져와야 함
      // EPS = 당기순이익 / 발행주식수 이므로, 역산 가능
      const netIncome = this.parseAmount(netIncomeItem?.thstrm_amount);
      const eps = epsItem ? this.parseAmount(epsItem?.thstrm_amount) : null;
      
      // 발행주식수 역산: 당기순이익 / EPS
      let totalShares = 0;
      if (eps && eps > 0 && netIncome > 0) {
        totalShares = Math.round(netIncome / eps);
      }
      
      return {
        netIncome,
        totalAssets: this.parseAmount(totalAssetsItem?.thstrm_amount),
        totalEquity: this.parseAmount(totalEquityItem?.thstrm_amount),
        eps,
        totalShares
      };
    });
  }

  /**
   * TTM(Trailing Twelve Months) 재무 데이터 가져오기
   * 최근 4개 분기의 원시 데이터만 반환 (비율 계산은 호출측에서)
   */
  async getTTMFinancialData(corpCode: string): Promise<{
    revenue: number;
    operatingProfit: number;
    netIncome: number;
    totalAssets: number;
    totalEquity: number;
    totalShares: number;
    quarters: string[];
  } | null> {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    // 분기별 보고서 코드: Q1=11013, Q2=11012, Q3=11014, Q4=11011
    const allQuarters: { year: number; quarter: string; code: string }[] = [];
    
    // 최근 3년간의 모든 분기 생성 (역순)
    for (let year = currentYear; year >= currentYear - 2; year--) {
      allQuarters.push({ year, quarter: 'Q4', code: '11011' });
      allQuarters.push({ year, quarter: 'Q3', code: '11014' });
      allQuarters.push({ year, quarter: 'Q2', code: '11012' });
      allQuarters.push({ year, quarter: 'Q1', code: '11013' });
    }
    
    // 현재 시점에서 공시 가능한 분기만 필터링
    const availableQuarters = allQuarters.filter(q => {
      if (q.year > currentYear) return false;
      if (q.year === currentYear) {
        if (q.quarter === 'Q4') return currentMonth >= 3;
        if (q.quarter === 'Q3') return currentMonth >= 11;
        if (q.quarter === 'Q2') return currentMonth >= 8;
        if (q.quarter === 'Q1') return currentMonth >= 5;
        return false;
      }
      return true;
    });
    
    // 분기별 원시 데이터 수집
    const quarterlyData: {
      year: number;
      quarter: string;
      revenue: number;
      operatingProfit: number;
      netIncome: number;
      totalAssets: number;
      totalEquity: number;
    }[] = [];
    
    let totalShares = 0;
    
    for (const q of availableQuarters) {
      if (quarterlyData.length >= 6) break; // 4개 + 누적 계산용
      
      try {
        const response = await this.request<DARTResponse<any>>(
          '/fnlttSinglAcntAll.json',
          {
            corp_code: corpCode,
            bsns_year: q.year.toString(),
            reprt_code: q.code,
            fs_div: 'CFS'
          }
        );
        
        if (!response.list || response.list.length === 0) continue;
        
        // 매출액
        const revenueItem = response.list.find((item: any) => 
          item.account_nm === '매출액' || item.account_nm === '수익(매출액)'
        );
        
        // 영업이익
        const operatingProfitItem = response.list.find((item: any) => 
          item.account_nm === '영업이익' || item.account_nm === '영업이익(손실)'
        );
        
        // 당기순이익
        const netIncomeItem = response.list.find((item: any) => 
          item.account_nm === '당기순이익' && item.sj_nm === '손익계산서'
        ) || response.list.find((item: any) => 
          item.account_nm === '당기순이익'
        );
        
        // 자산총계, 자본총계
        const totalAssetsItem = response.list.find((item: any) => 
          item.account_nm === '자산총계'
        );
        const totalEquityItem = response.list.find((item: any) => 
          item.account_nm === '자본총계'
        );
        
        const revenue = this.parseAmount(revenueItem?.thstrm_amount);
        const operatingProfit = this.parseAmount(operatingProfitItem?.thstrm_amount);
        const netIncome = this.parseAmount(netIncomeItem?.thstrm_amount);
        
        // Q4(연간 보고서)에서 발행주식수 계산 (EPS 역산)
        if (q.quarter === 'Q4' && totalShares === 0) {
          const epsItem = response.list.find((item: any) => 
            item.account_nm === '기본주당이익' || item.account_nm === '기본주당이익(손실)'
          );
          const eps = this.parseAmount(epsItem?.thstrm_amount);
          if (eps > 0 && netIncome > 0) {
            totalShares = Math.round(netIncome / eps);
          }
        }
        
        if (netIncome !== 0 || revenue !== 0) {
          quarterlyData.push({
            year: q.year,
            quarter: q.quarter,
            revenue,
            operatingProfit,
            netIncome,
            totalAssets: this.parseAmount(totalAssetsItem?.thstrm_amount),
            totalEquity: this.parseAmount(totalEquityItem?.thstrm_amount)
          });
        }
      } catch (e) {
        continue;
      }
    }
    
    if (quarterlyData.length === 0) return null;
    
    // 분기별 값 계산 (누적값에서 해당 분기만 추출)
    const quarterOnlyData: (typeof quarterlyData[0] & { 
      qRevenue: number; 
      qOperatingProfit: number; 
      qNetIncome: number; 
    })[] = [];
    
    for (let i = 0; i < Math.min(quarterlyData.length, 4); i++) {
      const current = quarterlyData[i];
      let qRevenue = current.revenue;
      let qOperatingProfit = current.operatingProfit;
      let qNetIncome = current.netIncome;
      
      const prevQuarterMap: Record<string, string> = { 'Q4': 'Q3', 'Q3': 'Q2', 'Q2': 'Q1' };
      const prevQuarter = prevQuarterMap[current.quarter];
      
      if (prevQuarter) {
        const prevData = quarterlyData.find(q => q.year === current.year && q.quarter === prevQuarter);
        if (prevData) {
          qRevenue = current.revenue - prevData.revenue;
          qOperatingProfit = current.operatingProfit - prevData.operatingProfit;
          qNetIncome = current.netIncome - prevData.netIncome;
        }
      }
      
      quarterOnlyData.push({ ...current, qRevenue, qOperatingProfit, qNetIncome });
    }
    
    // TTM 합산
    const latestQuarter = quarterOnlyData[0];
    
    return {
      revenue: quarterOnlyData.reduce((sum, q) => sum + q.qRevenue, 0),
      operatingProfit: quarterOnlyData.reduce((sum, q) => sum + q.qOperatingProfit, 0),
      netIncome: quarterOnlyData.reduce((sum, q) => sum + q.qNetIncome, 0),
      totalAssets: latestQuarter.totalAssets,
      totalEquity: latestQuarter.totalEquity,
      totalShares,
      quarters: quarterOnlyData.map(q => `${q.year}-${q.quarter}`)
    };
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
