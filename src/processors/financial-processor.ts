/**
 * Financial Data Processor
 * 
 * Transform raw DART data into usable format and calculate QoQ changes.
 */

import type {
  QuarterPeriod,
  FinancialStatement,
  ProcessedFinancialData,
  QoQChangeData,
  MetricWithChange
} from '../types';

type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

/**
 * Get the last 6 quarters based on current date
 */
export function getLast6Quarters(currentDate: Date = new Date()): QuarterPeriod[] {
  const quarters: QuarterPeriod[] = [];
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1; // 1-12
  
  // Determine the most recent completed quarter
  let currentQuarter: number;
  if (month <= 3) {
    currentQuarter = 4; // Q4 of previous year
  } else if (month <= 6) {
    currentQuarter = 1;
  } else if (month <= 9) {
    currentQuarter = 2;
  } else {
    currentQuarter = 3;
  }
  
  let currentYear = month <= 3 ? year - 1 : year;
  
  // Generate 6 quarters going backwards
  for (let i = 0; i < 6; i++) {
    const quarterNum = ((currentQuarter - i - 1 + 4) % 4) + 1;
    const quarterYear = currentYear - Math.floor((i + (4 - currentQuarter)) / 4);
    
    quarters.unshift(createQuarterPeriod(quarterYear, quarterNum as 1|2|3|4));
  }
  
  return quarters;
}

/**
 * Create a quarter period object
 */
function createQuarterPeriod(year: number, quarter: 1|2|3|4): QuarterPeriod {
  const quarterNames: Record<number, Quarter> = {
    1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4'
  };
  
  const startDates: Record<number, string> = {
    1: `${year}-01-01`,
    2: `${year}-04-01`,
    3: `${year}-07-01`,
    4: `${year}-10-01`
  };
  
  const endDates: Record<number, string> = {
    1: `${year}-03-31`,
    2: `${year}-06-30`,
    3: `${year}-09-30`,
    4: `${year}-12-31`
  };
  
  return {
    year: String(year),
    quarter: quarterNames[quarter],
    startDate: startDates[quarter],
    endDate: endDates[quarter]
  };
}

/**
 * Process raw financial data into structured format
 * 
 * DART API 요약재무정보(fnlttSinglAcnt) 반환값 구조:
 * - 11013 (1분기): Q1 단독 (1~3월) - thstrm_amount
 * - 11012 (반기): 1~6월 누적 - thstrm_add_amount
 * - 11014 (3분기): 1~9월 누적 - thstrm_add_amount
 * - 11011 (사업): 1~12월 연간 - thstrm_amount
 * 
 * 분기별 단독 값 계산:
 * - Q1 = 1분기 보고서 값
 * - Q2 = 반기 누적 - Q1 (Q1 데이터 필요)
 * - Q3 = 3분기 누적 - 반기 누적 (Q2 누적 데이터 필요)
 * - Q4 = 연간 - 3분기 누적 (Q3 누적 데이터 필요)
 */
export function processFinancialData(
  statements: FinancialStatement[]
): ProcessedFinancialData {
  // Sort by year and quarter
  const sorted = [...statements].sort((a, b) => {
    const yearDiff = parseInt(a.year) - parseInt(b.year);
    if (yearDiff !== 0) return yearDiff;
    
    const quarterOrder: Record<Quarter, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };
    return quarterOrder[a.quarter] - quarterOrder[b.quarter];
  });
  
  // Group by year
  const byYear: Record<string, FinancialStatement[]> = {};
  sorted.forEach(s => {
    if (!byYear[s.year]) byYear[s.year] = [];
    byYear[s.year].push(s);
  });
  
  // Calculate quarterly standalone values from cumulative
  const quarterlyData: FinancialStatement[] = [];
  
  Object.keys(byYear).sort().forEach(year => {
    const yearData = byYear[year];
    
    // Find each quarter's cumulative data
    const q1 = yearData.find(d => d.quarter === 'Q1'); // Q1 단독
    const q2Cum = yearData.find(d => d.quarter === 'Q2'); // 반기 누적 (Q1+Q2)
    const q3Cum = yearData.find(d => d.quarter === 'Q3'); // 3분기 누적 (Q1+Q2+Q3)
    const q4Annual = yearData.find(d => d.quarter === 'Q4'); // 연간 (Q1+Q2+Q3+Q4)
    
    // Q1: 단독 값 그대로 사용
    if (q1 && q1.revenue > 0) {
      quarterlyData.push({
        year,
        quarter: 'Q1',
        revenue: q1.revenue,
        operatingProfit: q1.operatingProfit,
        netIncome: q1.netIncome
      });
    }
    
    // Q2: 반기 누적 - Q1 (Q1 데이터가 있어야만 계산 가능)
    if (q2Cum && q2Cum.revenue > 0 && q1) {
      const q2Revenue = q2Cum.revenue - q1.revenue;
      const q2Op = q2Cum.operatingProfit - q1.operatingProfit;
      const q2Net = q2Cum.netIncome - q1.netIncome;
      
      if (q2Revenue > 0) {
        quarterlyData.push({
          year,
          quarter: 'Q2',
          revenue: q2Revenue,
          operatingProfit: q2Op,
          netIncome: q2Net
        });
      }
    }
    
    // Q3: 3분기 누적 - 반기 누적 (Q2 누적 데이터가 있어야만 계산 가능)
    if (q3Cum && q3Cum.revenue > 0 && q2Cum) {
      const q3Revenue = q3Cum.revenue - q2Cum.revenue;
      const q3Op = q3Cum.operatingProfit - q2Cum.operatingProfit;
      const q3Net = q3Cum.netIncome - q2Cum.netIncome;
      
      if (q3Revenue > 0) {
        quarterlyData.push({
          year,
          quarter: 'Q3',
          revenue: q3Revenue,
          operatingProfit: q3Op,
          netIncome: q3Net
        });
      }
    }
    
    // Q4: 연간 - 3분기 누적 (Q3 누적 데이터가 있어야만 계산 가능)
    if (q4Annual && q4Annual.revenue > 0 && q3Cum) {
      const q4Revenue = q4Annual.revenue - q3Cum.revenue;
      const q4Op = q4Annual.operatingProfit - q3Cum.operatingProfit;
      const q4Net = q4Annual.netIncome - q3Cum.netIncome;
      
      if (q4Revenue > 0) {
        quarterlyData.push({
          year,
          quarter: 'Q4',
          revenue: q4Revenue,
          operatingProfit: q4Op,
          netIncome: q4Net
        });
      }
    }
  });
  
  const quarters: QuarterPeriod[] = quarterlyData.map(s => 
    createQuarterPeriod(parseInt(s.year), 
      ({ Q1: 1, Q2: 2, Q3: 3, Q4: 4 } as const)[s.quarter])
  );

  return {
    quarters,
    revenue: quarterlyData.map(s => s.revenue),
    operatingProfit: quarterlyData.map(s => s.operatingProfit),
    netIncome: quarterlyData.map(s => s.netIncome)
  };
}

/**
 * Calculate QoQ (Quarter-over-Quarter) change rates
 * Formula: ((Current - Previous) / Previous) × 100
 */
export function calculateQoQChanges(
  data: ProcessedFinancialData
): QoQChangeData {
  return {
    quarters: data.quarters,
    revenue: calculateMetricChanges(data.revenue),
    operatingProfit: calculateMetricChanges(data.operatingProfit),
    netIncome: calculateMetricChanges(data.netIncome)
  };
}

/**
 * Calculate QoQ changes for a single metric array
 */
function calculateMetricChanges(values: number[]): MetricWithChange[] {
  return values.map((value, index) => {
    let qoqChange: number | null = null;
    
    if (index > 0) {
      const previous = values[index - 1];
      if (previous !== 0) {
        qoqChange = ((value - previous) / Math.abs(previous)) * 100;
        // Round to 2 decimal places
        qoqChange = Math.round(qoqChange * 100) / 100;
      }
    }
    
    return {
      value,
      qoqChange,
      formattedValue: formatKoreanCurrency(value)
    };
  });
}

/**
 * Format numbers in Korean currency units (조, 억)
 * - If value >= 1 trillion (1조): Display in 조 (e.g., "1.2조")
 * - If value < 1 trillion: Display in 억 (e.g., "500억")
 * - Round to 1 decimal place
 */
export function formatKoreanCurrency(amount: number): string {
  const absAmount = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  
  const TRILLION = 1_000_000_000_000; // 1조
  const HUNDRED_MILLION = 100_000_000; // 1억
  
  if (absAmount >= TRILLION) {
    const value = absAmount / TRILLION;
    const rounded = Math.round(value * 10) / 10;
    return `${sign}${rounded}조`;
  } else if (absAmount >= HUNDRED_MILLION) {
    const value = absAmount / HUNDRED_MILLION;
    const rounded = Math.round(value * 10) / 10;
    return `${sign}${rounded}억`;
  } else if (absAmount >= 10000) {
    // Display in 만 for smaller values
    const value = absAmount / 10000;
    const rounded = Math.round(value * 10) / 10;
    return `${sign}${rounded}만`;
  } else {
    return `${sign}${absAmount}`;
  }
}

/**
 * Format percentage with sign
 */
export function formatPercentage(value: number | null): string {
  if (value === null) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
