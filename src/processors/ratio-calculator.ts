/**
 * Financial Ratio Calculator
 * 
 * Calculate key financial ratios from raw financial data.
 */

import type { FinancialDetails, FinancialRatios } from '../types';

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
