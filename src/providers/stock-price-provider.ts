/**
 * Stock Price Provider
 * 
 * Retrieve current stock price for a company.
 */

const NAVER_FINANCE_URL = 'https://finance.naver.com/item/main.naver';

/**
 * Get current stock price from Naver Finance
 */
export async function getCurrentPrice(stockCode: string): Promise<number> {
  try {
    const url = new URL(NAVER_FINANCE_URL);
    url.searchParams.set('code', stockCode);
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CompanyPerformanceBot/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    
    if (!response.ok) {
      return 0;
    }
    
    const html = await response.text();
    return parseStockPrice(html);
  } catch (error) {
    return 0;
  }
}

/**
 * Parse stock price from Naver Finance HTML
 */
function parseStockPrice(html: string): number {
  // Look for current price in the HTML
  // Pattern: <p class="no_today"><em class="no_up"><span class="blind">현재가</span>75,000</em>
  const pricePattern = /<p[^>]*class="[^"]*no_today[^"]*"[^>]*>[\s\S]*?(\d{1,3}(?:,\d{3})*)/;
  const match = html.match(pricePattern);

  if (match) {
    // Remove commas and parse as number
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  
  // Alternative pattern
  const altPattern = /현재가[^>]*>[\s\S]*?(\d{1,3}(?:,\d{3})*)/;
  const altMatch = html.match(altPattern);
  
  if (altMatch) {
    return parseInt(altMatch[1].replace(/,/g, ''), 10);
  }
  
  return 0;
}

/**
 * Format stock price with thousand separators
 */
export function formatStockPrice(price: number): string {
  if (price === 0) return '-';
  return price.toLocaleString('ko-KR') + '원';
}

/**
 * Get stock price change info
 */
export interface StockPriceInfo {
  price: number;
  formattedPrice: string;
  change?: number;
  changePercent?: number;
}

export async function getStockPriceInfo(stockCode: string): Promise<StockPriceInfo> {
  const price = await getCurrentPrice(stockCode);
  
  return {
    price,
    formattedPrice: formatStockPrice(price)
  };
}
