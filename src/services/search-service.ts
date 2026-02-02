/**
 * Search Service
 * 
 * Provide autocomplete functionality for company search.
 */

import type { Company } from '../types';

/**
 * Search Service class
 */
export class SearchService {
  private companies: Company[] = [];
  private initialized: boolean = false;

  /**
   * Initialize search index from company list
   */
  initializeIndex(companies: Company[]): void {
    this.companies = companies;
    this.initialized = true;
  }

  /**
   * Check if index is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Search companies by name (Korean)
   * Supports partial matching and fuzzy search
   */
  search(query: string, limit: number = 10): Company[] {
    if (!this.initialized || !query || query.length < 2) {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    
    // Score and filter companies
    const scored = this.companies
      .map(company => ({
        company,
        score: this.calculateRelevanceScore(company, normalizedQuery)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(item => item.company);
  }

  /**
   * Calculate relevance score for a company
   */
  private calculateRelevanceScore(company: Company, query: string): number {
    const name = company.corpName.toLowerCase();
    const stockCode = company.stockCode.toLowerCase();
    
    // Exact match gets highest score
    if (name === query) return 100;
    
    // Starts with query gets high score
    if (name.startsWith(query)) return 80;
    
    // Contains query
    if (name.includes(query)) return 60;
    
    // Stock code match
    if (stockCode === query) return 70;
    if (stockCode.startsWith(query)) return 50;
    
    // Fuzzy matching for Korean characters
    if (this.fuzzyMatch(name, query)) return 40;
    
    return 0;
  }

  /**
   * Simple fuzzy matching for Korean text
   */
  private fuzzyMatch(text: string, query: string): boolean {
    // Check if all characters in query appear in text in order
    let textIndex = 0;
    for (const char of query) {
      const foundIndex = text.indexOf(char, textIndex);
      if (foundIndex === -1) return false;
      textIndex = foundIndex + 1;
    }
    return true;
  }

  /**
   * Get company by corp code
   */
  getCompanyByCode(corpCode: string): Company | undefined {
    return this.companies.find(c => c.corpCode === corpCode);
  }

  /**
   * Get company by stock code
   */
  getCompanyByStockCode(stockCode: string): Company | undefined {
    return this.companies.find(c => c.stockCode === stockCode);
  }

  /**
   * Get total company count
   */
  getCompanyCount(): number {
    return this.companies.length;
  }

  /**
   * Clear the index
   */
  clearIndex(): void {
    this.companies = [];
    this.initialized = false;
  }
}

/**
 * Create search service instance
 */
export function createSearchService(): SearchService {
  return new SearchService();
}

// Singleton instance for global use
let searchServiceInstance: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!searchServiceInstance) {
    searchServiceInstance = new SearchService();
  }
  return searchServiceInstance;
}
