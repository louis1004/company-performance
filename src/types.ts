/**
 * Type definitions for the Company Performance Service
 */

// Environment bindings for Cloudflare Workers
export interface Env {
  DART_API_KEY: string;
  COMPANY_CACHE?: KVNamespace;
}

// Company data models
export interface Company {
  corpCode: string;      // DART corporation code
  corpName: string;      // Korean company name
  stockCode: string;     // Stock ticker code
  market: 'KOSPI' | 'KOSDAQ' | 'KONEX';
}

export interface CompanyInfo {
  corpCode: string;
  corpName: string;
  stockCode: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KONEX';
  ceoName?: string;
  industry?: string;
  address?: string;
}

// Financial data models
export interface FinancialStatement {
  year: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  revenue: number;           // 매출액
  operatingProfit: number;   // 영업이익
  netIncome: number;         // 당기순이익
}

export interface QuarterPeriod {
  year: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  startDate: string;
  endDate: string;
}

export interface MetricWithChange {
  value: number;
  qoqChange: number | null;  // null for first quarter
  formattedValue: string;     // e.g., "1.2조" or "500억"
}

export interface ProcessedFinancialData {
  quarters: QuarterPeriod[];
  revenue: number[];
  operatingProfit: number[];
  netIncome: number[];
}

export interface QoQChangeData {
  quarters: QuarterPeriod[];
  revenue: MetricWithChange[];
  operatingProfit: MetricWithChange[];
  netIncome: MetricWithChange[];
}

// Disclosure models
export interface Disclosure {
  reportNm: string;      // Disclosure title
  rcept_no: string;      // Receipt number (for linking)
  rcept_dt: string;      // Disclosure date (YYYYMMDD)
  flr_nm: string;        // Filer name
}

// Financial ratio models
export interface FinancialDetails {
  totalAssets: number;
  totalEquity: number;
  totalShares: number;
  ebitda: number;
  bookValue: number;
}

export interface FinancialRatios {
  eps: number | null;           // Earnings Per Share
  pbr: number | null;           // Price to Book Ratio
  roa: number | null;           // Return on Assets (%)
  roe: number | null;           // Return on Equity (%)
  evEbitda: number | null;      // EV/EBITDA
}

// Extended financial ratio models (새로운 재무비율)
export interface ExtendedFinancialDetails extends FinancialDetails {
  totalDebt?: number;           // 총부채
  currentAssets?: number;       // 유동자산
  currentLiabilities?: number;  // 유동부채
  operatingProfit?: number;     // 영업이익
  revenue?: number;             // 매출액
}

export interface ExtendedFinancialRatios extends FinancialRatios {
  operatingMargin: number | null;  // 영업이익률 = (영업이익 / 매출액) × 100
  debtRatio: number | null;        // 부채비율 = (총부채 / 자기자본) × 100
  currentRatio: number | null;     // 유동비율 = (유동자산 / 유동부채) × 100
}

// News models
export interface NewsArticle {
  title: string;
  url: string;
  publishedDate: string;
  source: string;
  summary?: string;
}

// API Response models
export interface SearchResponse {
  companies: Company[];
  total: number;
}

export interface CompanyDetailsResponse {
  company: CompanyInfo;
  stockPrice: number;
  lastUpdated: string;
}

export interface ChartDataPoint {
  quarter: string;  // e.g., "2023-Q4"
  revenue: number;
  operatingProfit: number;
  netIncome: number;
}

export interface FinancialPerformanceResponse {
  quarters: QuarterPeriod[];
  metrics: {
    revenue: MetricWithChange[];
    operatingProfit: MetricWithChange[];
    netIncome: MetricWithChange[];
  };
  chartData: ChartDataPoint[];
}

export interface RatiosResponse {
  ratios: FinancialRatios;
  calculatedAt: string;
}

export interface DisclosuresResponse {
  disclosures: Disclosure[];
  total: number;
}

export interface NewsResponse {
  articles: NewsArticle[];
  total: number;
}

export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
}

// Configuration
export interface AppConfig {
  dartApiKey: string;
  dartBaseUrl: string;
  cacheEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
