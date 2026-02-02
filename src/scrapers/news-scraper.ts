/**
 * News Scraper
 * 
 * Retrieve company-related news from Naver Stock API.
 */

import type { NewsArticle } from '../types';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
  'Accept': 'application/json'
};

/**
 * Scrape news articles for a company from Naver Stock API
 */
export async function scrapeNews(
  companyName: string,
  limit: number = 10,
  stockCode?: string
): Promise<NewsArticle[]> {
  try {
    // stockCode가 없으면 빈 배열 반환
    if (!stockCode) {
      console.log('No stock code provided for news');
      return [];
    }
    
    console.log(`Fetching news for stock: ${stockCode}`);
    
    // 네이버 증권 모바일 API
    const apiUrl = `https://m.stock.naver.com/api/news/stock/${stockCode}?pageSize=${limit}`;
    
    const response = await fetch(apiUrl, { headers: HEADERS });
    
    console.log(`Naver API response status: ${response.status}`);
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`Naver Stock API failed: ${response.status} - ${text.slice(0, 200)}`);
      return [];
    }
    
    const data = await response.json() as any[];
    console.log(`Naver API returned ${data?.length || 0} groups`);
    
    const articles: NewsArticle[] = [];
    
    for (const group of data) {
      if (!group.items) continue;
      
      for (const item of group.items) {
        if (articles.length >= limit) break;
        
        // datetime format: "202602021951" -> "2026-02-02"
        const datetime = item.datetime || '';
        const publishedDate = datetime.length >= 8 
          ? `${datetime.slice(0, 4)}-${datetime.slice(4, 6)}-${datetime.slice(6, 8)}`
          : new Date().toISOString().split('T')[0];
        
        // 네이버 뉴스 URL 생성
        const url = `https://n.news.naver.com/mnews/article/${item.officeId}/${item.articleId}`;
        
        articles.push({
          title: item.title || item.titleFull || '',
          url,
          publishedDate,
          source: item.officeName || '',
          summary: item.body || ''
        });
      }
      
      if (articles.length >= limit) break;
    }
    
    return articles;
  } catch (error) {
    console.error('News scraping error:', error);
    return [];
  }
}
