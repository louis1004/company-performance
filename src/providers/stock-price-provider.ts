/**
 * Stock Price Provider
 * 
 * Retrieve current stock price and shares outstanding for a company.
 */

const NAVER_FINANCE_URL = 'https://finance.naver.com/item/main.naver';

/**
 * Stock data from Naver Finance
 */
export interface StockData {
  price: number;
  sharesOutstanding: number;
  dividendYield: number;
  per: number;
  pbr: number;
  roe: number;
  eps: number;
  high52w: number;
  low52w: number;
  // 새로운 재무비율
  operatingMargin: number;  // 영업이익률
  debtRatio: number;        // 부채비율
  currentRatio: number;     // 유동비율
}

/**
 * Get current stock price and shares outstanding from Naver Finance
 */
export async function getStockData(stockCode: string): Promise<StockData> {
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
      return { price: 0, sharesOutstanding: 0, dividendYield: 0, per: 0, pbr: 0, roe: 0, eps: 0, high52w: 0, low52w: 0, operatingMargin: 0, debtRatio: 0, currentRatio: 0 };
    }
    
    const html = await response.text();
    return {
      price: parseStockPrice(html),
      sharesOutstanding: parseSharesOutstanding(html),
      dividendYield: parseDividendYield(html),
      per: parsePER(html),
      pbr: parsePBR(html),
      roe: parseROE(html),
      eps: parseEPS(html),
      high52w: parse52wHigh(html),
      low52w: parse52wLow(html),
      operatingMargin: parseOperatingMargin(html),
      debtRatio: parseDebtRatio(html),
      currentRatio: parseCurrentRatio(html)
    };
  } catch (error) {
    return { price: 0, sharesOutstanding: 0, dividendYield: 0, per: 0, pbr: 0, roe: 0, eps: 0, high52w: 0, low52w: 0, operatingMargin: 0, debtRatio: 0, currentRatio: 0 };
  }
}

/**
 * Get current stock price from Naver Finance (legacy function)
 */
export async function getCurrentPrice(stockCode: string): Promise<number> {
  const data = await getStockData(stockCode);
  return data.price;
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
 * Parse shares outstanding from Naver Finance HTML
 */
function parseSharesOutstanding(html: string): number {
  // Pattern: <th scope="row">상장주식수</th> ... <td><em>5,919,637,922</em></td>
  const pattern = /상장주식수[\s\S]*?<td><em>([\d,]+)<\/em>/;
  const match = html.match(pattern);
  
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  
  return 0;
}

/**
 * Parse dividend yield from Naver Finance HTML
 */
function parseDividendYield(html: string): number {
  // Pattern: id="_dvr">1.00</em>%
  const pattern = /id="_dvr">([0-9.]+)/;
  const match = html.match(pattern);
  
  if (match) {
    return parseFloat(match[1]);
  }
  
  return 0;
}

/**
 * Parse PER from Naver Finance HTML
 */
function parsePER(html: string): number {
  const pattern = /id="_per">([0-9.]+)/;
  const match = html.match(pattern);
  
  if (match) {
    return parseFloat(match[1]);
  }
  
  return 0;
}

/**
 * Parse PBR from Naver Finance HTML
 */
function parsePBR(html: string): number {
  const pattern = /id="_pbr">([0-9.]+)/;
  const match = html.match(pattern);
  
  if (match) {
    return parseFloat(match[1]);
  }
  
  return 0;
}

/**
 * Parse ROE from Naver Finance HTML
 */
function parseROE(html: string): number {
  // ROE is in table with class th_cop_anal13
  const noNewlines = html.replace(/\n/g, '');
  const pattern = /th_cop_anal13[^<]*<[^>]*>[^<]*<\/[^>]*>[\s\S]*?<td[^>]*>\s*([-0-9.]+)/;
  const match = noNewlines.match(pattern);
  
  if (match) {
    return parseFloat(match[1]);
  }
  
  return 0;
}

/**
 * Parse EPS from Naver Finance HTML
 */
function parseEPS(html: string): number {
  const pattern = /id="_eps">([0-9,]+)/;
  const match = html.match(pattern);
  
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  
  return 0;
}

/**
 * Parse 52-week high from Naver Finance HTML
 */
function parse52wHigh(html: string): number {
  // Pattern: 52주최고 ... <em>169,400</em>
  const noNewlines = html.replace(/\n/g, '');
  const pattern = /52주최고[\s\S]*?<td>[\s\S]*?<em>([0-9,]+)<\/em>/;
  const match = noNewlines.match(pattern);
  
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  
  return 0;
}

/**
 * Parse 52-week low from Naver Finance HTML
 */
function parse52wLow(html: string): number {
  // Pattern: 52주최고 ... <em>169,400</em> ... <em>52,500</em>
  const noNewlines = html.replace(/\n/g, '');
  const pattern = /52주최고[\s\S]*?<td>[\s\S]*?<em>[0-9,]+<\/em>[\s\S]*?<em>([0-9,]+)<\/em>/;
  const match = noNewlines.match(pattern);
  
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
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
  sharesOutstanding: number;
  change?: number;
  changePercent?: number;
}

export async function getStockPriceInfo(stockCode: string): Promise<StockPriceInfo> {
  const data = await getStockData(stockCode);
  
  return {
    price: data.price,
    formattedPrice: formatStockPrice(data.price),
    sharesOutstanding: data.sharesOutstanding
  };
}


/**
 * Parse Operating Margin (영업이익률) from Naver Finance HTML
 * 네이버 증권 투자지표 테이블에서 영업이익률 파싱
 * th_cop_anal11 클래스 사용
 */
function parseOperatingMargin(html: string): number {
  // th_cop_anal11 = 영업이익률
  // 구조: <th class="...th_cop_anal11">영업이익률</th> ... <td>14.35</td>
  const pattern = /th_cop_anal11[\s\S]*?<\/th>[\s\S]*?<td[^>]*>[\s\S]*?([-0-9.]+)[\s\S]*?<\/td>/;
  const match = html.match(pattern);
  if (match) {
    return parseFloat(match[1].trim());
  }
  
  return 0;
}

/**
 * Parse Debt Ratio (부채비율) from Naver Finance HTML
 * 네이버 증권 투자지표 테이블에서 부채비율 파싱
 * th_cop_anal14 클래스 사용
 */
function parseDebtRatio(html: string): number {
  // th_cop_anal14 = 부채비율
  // 구조: <th class="...th_cop_anal14">부채비율</th> ... <td>26.41</td>
  const pattern = /th_cop_anal14[\s\S]*?<\/th>[\s\S]*?<td[^>]*>[\s\S]*?([-0-9.]+)[\s\S]*?<\/td>/;
  const match = html.match(pattern);
  if (match) {
    return parseFloat(match[1].trim());
  }
  
  return 0;
}

/**
 * Parse Current Ratio (유동비율) from Naver Finance HTML
 * 네이버 증권에는 유동비율이 없어서 당좌비율(th_cop_anal15)을 사용
 * 당좌비율 = (당좌자산 / 유동부채) × 100
 */
function parseCurrentRatio(html: string): number {
  // th_cop_anal15 = 당좌비율 (유동비율 대신 사용)
  // 구조: <th class="...th_cop_anal15">당좌비율</th> ... <td>211.68</td>
  const pattern = /th_cop_anal15[\s\S]*?<\/th>[\s\S]*?<td[^>]*>[\s\S]*?([-0-9.]+)[\s\S]*?<\/td>/;
  const match = html.match(pattern);
  if (match) {
    return parseFloat(match[1].trim());
  }
  
  return 0;
}
