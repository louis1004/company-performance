/**
 * News Scraper
 * 
 * Retrieve company-related news from Naver News.
 */

import type { NewsArticle } from '../types';

const NAVER_NEWS_SEARCH_URL = 'https://search.naver.com/search.naver';

/**
 * Scrape news articles for a company from Naver News
 */
export async function scrapeNews(
  companyName: string,
  limit: number = 10
): Promise<NewsArticle[]> {
  try {
    const url = new URL(NAVER_NEWS_SEARCH_URL);
    url.searchParams.set('where', 'news');
    url.searchParams.set('query', companyName);
    url.searchParams.set('sort', '1'); // Sort by date (newest first)
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CompanyPerformanceBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    
    if (!response.ok) {
      return [];
    }
    
    const html = await response.text();
    return parseNewsHTML(html, limit);
  } catch (error) {
    return [];
  }
}

/**
 * Parse HTML response from Naver News to extract articles
 */
export function parseNewsHTML(html: string, limit: number = 10): NewsArticle[] {
  const articles: NewsArticle[] = [];
  
  // Simple regex-based parsing for news articles
  // Look for news item patterns in Naver search results
  const newsItemPattern = /<a[^>]*class="[^"]*news_tit[^"]*"[^>]*href="([^"]+)"[^>]*title="([^"]+)"/g;
  const datePattern = /<span[^>]*class="[^"]*info[^"]*"[^>]*>([^<]*\d{4}\.\d{2}\.\d{2}[^<]*)<\/span>/g;
  const sourcePattern = /<a[^>]*class="[^"]*info press[^"]*"[^>]*>([^<]+)<\/a>/g;
  
  let match;
  const urls: string[] = [];
  const titles: string[] = [];
  
  // Extract titles and URLs
  while ((match = newsItemPattern.exec(html)) !== null) {
    urls.push(match[1]);
    titles.push(decodeHTMLEntities(match[2]));
  }
  
  // Extract dates
  const dates: string[] = [];
  while ((match = datePattern.exec(html)) !== null) {
    dates.push(parseDate(match[1]));
  }
  
  // Extract sources
  const sources: string[] = [];
  while ((match = sourcePattern.exec(html)) !== null) {
    sources.push(match[1].trim());
  }
  
  // Combine into articles
  for (let i = 0; i < Math.min(titles.length, limit); i++) {
    articles.push({
      title: titles[i],
      url: urls[i] || '',
      publishedDate: dates[i] || new Date().toISOString().split('T')[0],
      source: sources[i] || '네이버 뉴스'
    });
  }

  // Sort by date (most recent first)
  return articles.sort((a, b) => 
    new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime()
  );
}

/**
 * Parse date string to ISO format
 */
function parseDate(dateStr: string): string {
  // Handle various date formats
  const cleanDate = dateStr.trim();
  
  // Format: 2024.01.15
  const dotFormat = cleanDate.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (dotFormat) {
    return `${dotFormat[1]}-${dotFormat[2]}-${dotFormat[3]}`;
  }
  
  // Format: 1일 전, 2시간 전, etc.
  const relativeMatch = cleanDate.match(/(\d+)(일|시간|분)\s*전/);
  if (relativeMatch) {
    const now = new Date();
    const value = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2];
    
    if (unit === '일') {
      now.setDate(now.getDate() - value);
    } else if (unit === '시간') {
      now.setHours(now.getHours() - value);
    } else if (unit === '분') {
      now.setMinutes(now.getMinutes() - value);
    }
    
    return now.toISOString().split('T')[0];
  }
  
  return new Date().toISOString().split('T')[0];
}

/**
 * Decode HTML entities
 */
function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  };
  
  return text.replace(/&[^;]+;/g, (match) => entities[match] || match);
}
