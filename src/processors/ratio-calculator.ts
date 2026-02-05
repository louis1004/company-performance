/**
 * Financial Ratio Calculator
 * 
 * Calculate key financial ratios from raw financial data.
 * Extended with Operating Margin, Debt Ratio, and Current Ratio.
 */

import type { FinancialDetails, FinancialRatios } from '../types';

/**
 * Extended Financial Details with additional fields for new ratios
 */
export interface ExtendedFinancialDetails extends FinancialDetails {
  totalDebt?: number;           // 총부채
  currentAssets?: number;       // 유동자산
  currentLiabilities?: number;  // 유동부채
  operatingProfit?: number;     // 영업이익
  revenue?: number;             // 매출액
}

/**
 * Extended Financial Ratios with new metrics
 */
export interface ExtendedFinancialRatios extends FinancialRatios {
  operatingMargin: number | null;  // 영업이익률
  debtRatio: number | null;        // 부채비율
  currentRatio: number | null;     // 유동비율
}

/**
 * Calculate EPS (Earnings Per Share)
 * Formula: Net Income / Total Outstanding Shares
 */
export function calculateEPS(
  netIncome: number,
  totalShares: number
): number | null {
  if (totalShares === 0 || isNaN(totalShares)) {
    return null;
  }
  return netIncome / totalShares;
}

/**
 * Calculate PBR (Price to Book Ratio)
 * Formula: Stock Price / Book Value Per Share
 */
export function calculatePBR(
  stockPrice: number,
  bookValuePerShare: number
): number | null {
  if (bookValuePerShare === 0 || isNaN(bookValuePerShare)) {
    return null;
  }
  return stockPrice / bookValuePerShare;
}

/**
 * Calculate ROA (Return on Assets)
 * Formula: (Net Income / Total Assets) × 100
 */
export function calculateROA(
  netIncome: number,
  totalAssets: number
): number | null {
  if (totalAssets === 0 || isNaN(totalAssets)) {
    return null;
  }
  return (netIncome / totalAssets) * 100;
}

/**
 * Calculate ROE (Return on Equity)
 * Formula: (Net Income / Shareholders' Equity) × 100
 */
export function calculateROE(
  netIncome: number,
  totalEquity: number
): number | null {
  if (totalEquity === 0 || isNaN(totalEquity)) {
    return null;
  }
  return (netIncome / totalEquity) * 100;
}

/**
 * Calculate EV/EBITDA
 * Formula: Enterprise Value / EBITDA
 */
export function calculateEVEBITDA(
  enterpriseValue: number,
  ebitda: number
): number | null {
  if (ebitda === 0 || isNaN(ebitda)) {
    return null;
  }
  return enterpriseValue / ebitda;
}

/**
 * Calculate Operating Margin (영업이익률)
 * Formula: (Operating Profit / Revenue) × 100
 * 
 * @param operatingProfit - 영업이익
 * @param revenue - 매출액
 * @returns Operating margin as percentage, or null if calculation not possible
 */
export function calculateOperatingMargin(
  operatingProfit: number,
  revenue: number
): number | null {
  if (revenue === 0 || isNaN(revenue) || isNaN(operatingProfit)) {
    return null;
  }
  return (operatingProfit / revenue) * 100;
}

/**
 * Calculate Debt Ratio (부채비율)
 * Formula: (Total Debt / Total Equity) × 100
 * 
 * @param totalDebt - 총부채
 * @param totalEquity - 자기자본
 * @returns Debt ratio as percentage, or null if calculation not possible
 */
export function calculateDebtRatio(
  totalDebt: number,
  totalEquity: number
): number | null {
  if (totalEquity === 0 || isNaN(totalEquity) || isNaN(totalDebt)) {
    return null;
  }
  return (totalDebt / totalEquity) * 100;
}

/**
 * Calculate Current Ratio (유동비율)
 * Formula: (Current Assets / Current Liabilities) × 100
 * 
 * @param currentAssets - 유동자산
 * @param currentLiabilities - 유동부채
 * @returns Current ratio as percentage, or null if calculation not possible
 */
export function calculateCurrentRatio(
  currentAssets: number,
  currentLiabilities: number
): number | null {
  if (currentLiabilities === 0 || isNaN(currentLiabilities) || isNaN(currentAssets)) {
    return null;
  }
  return (currentAssets / currentLiabilities) * 100;
}

/**
 * Calculate all financial ratios at once
 */
export function calculateAllRatios(
  financialData: FinancialDetails,
  stockPrice: number,
  netIncome: number,
  marketCap?: number,
  totalDebt?: number,
  cash?: number
): FinancialRatios {
  const { totalAssets, totalEquity, totalShares, ebitda, bookValue } = financialData;
  
  // Calculate Book Value Per Share
  const bookValuePerShare = totalShares > 0 ? totalEquity / totalShares : 0;
  
  // Calculate Enterprise Value if components are provided
  let enterpriseValue = 0;
  if (marketCap !== undefined && totalDebt !== undefined && cash !== undefined) {
    enterpriseValue = marketCap + totalDebt - cash;
  }

  return {
    eps: calculateEPS(netIncome, totalShares),
    pbr: calculatePBR(stockPrice, bookValuePerShare),
    roa: calculateROA(netIncome, totalAssets),
    roe: calculateROE(netIncome, totalEquity),
    evEbitda: ebitda > 0 ? calculateEVEBITDA(enterpriseValue, ebitda) : null
  };
}

/**
 * Calculate all extended financial ratios including new metrics
 * 
 * @param financialData - Extended financial data with additional fields
 * @param stockPrice - Current stock price
 * @param netIncome - Net income for the period
 * @param marketCap - Market capitalization (optional)
 * @param cash - Cash and cash equivalents (optional)
 * @returns Extended financial ratios including operating margin, debt ratio, and current ratio
 */
export function calculateAllExtendedRatios(
  financialData: ExtendedFinancialDetails,
  stockPrice: number,
  netIncome: number,
  marketCap?: number,
  cash?: number
): ExtendedFinancialRatios {
  // Calculate base ratios
  const baseRatios = calculateAllRatios(
    financialData,
    stockPrice,
    netIncome,
    marketCap,
    financialData.totalDebt,
    cash
  );

  // Calculate new extended ratios
  const operatingMargin = financialData.operatingProfit !== undefined && financialData.revenue !== undefined
    ? calculateOperatingMargin(financialData.operatingProfit, financialData.revenue)
    : null;

  const debtRatio = financialData.totalDebt !== undefined
    ? calculateDebtRatio(financialData.totalDebt, financialData.totalEquity)
    : null;

  const currentRatio = financialData.currentAssets !== undefined && financialData.currentLiabilities !== undefined
    ? calculateCurrentRatio(financialData.currentAssets, financialData.currentLiabilities)
    : null;

  return {
    ...baseRatios,
    operatingMargin,
    debtRatio,
    currentRatio
  };
}

/**
 * Format ratio value for display
 */
export function formatRatio(value: number | null, decimals: number = 2): string {
  if (value === null) return '-';
  return value.toFixed(decimals);
}

/**
 * Format ratio as percentage
 */
export function formatRatioAsPercent(value: number | null): string {
  if (value === null) return '-';
  return `${value.toFixed(2)}%`;
}

/**
 * Format extended ratio with appropriate suffix
 * 
 * @param value - Ratio value
 * @param type - Type of ratio for formatting
 * @returns Formatted string with appropriate suffix
 */
export function formatExtendedRatio(
  value: number | null,
  type: 'percent' | 'times' | 'currency' = 'percent'
): string {
  if (value === null) return '-';
  
  switch (type) {
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'times':
      return `${value.toFixed(2)}배`;
    case 'currency':
      return value.toLocaleString();
    default:
      return value.toFixed(2);
  }
}
