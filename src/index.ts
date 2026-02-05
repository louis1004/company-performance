/**
 * Company Performance Service - Main Entry Point
 * 
 * A Cloudflare Workers application built with Hono framework
 * to provide financial data for Korean stock market companies.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ErrorResponse } from './types';
import api from './routes/api';
import { createCacheManager, CACHE_TTL, CACHE_KEYS } from './cache/cache-manager';
import { createDARTClient } from './clients/dart-client';
import { getSearchService } from './services/search-service';

// HTML UI Template
const indexHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>기업 실적 조회 서비스</title>
  <style>
    /* CSS 변수 기반 다크모드 (기본 테마) */
    :root {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-card: #1e2a4a;
      --bg-input: #0f1629;
      --text-primary: #e4e4e4;
      --text-secondary: #a0a0a0;
      --text-muted: #6b7280;
      --accent-color: #7c8cff;
      --accent-secondary: #48bb78;
      --accent-tertiary: #ed8936;
      --border-color: #2d3748;
      --card-shadow: 0 2px 8px rgba(0,0,0,0.3);
      --chart-revenue: #7c8cff;
      --chart-operating: #48bb78;
      --chart-net: #ed8936;
      --positive-color: #fc8181;
      --negative-color: #63b3ed;
      --header-gradient: linear-gradient(135deg, #4c5fd5 0%, #6b46c1 100%);
      --hover-bg: #2d3a5a;
      --table-header-bg: #1e2a4a;
      --spinner-bg: #2d3748;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      transition: background-color 0.3s, color 0.3s;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      background: var(--header-gradient);
      color: white;
      padding: 30px 20px;
      text-align: center;
      margin-bottom: 30px;
      border-radius: 12px;
    }
    header h1 { font-size: 1.8rem; margin-bottom: 8px; }
    header p { opacity: 0.9; font-size: 0.95rem; }
    .search-box {
      position: relative;
      max-width: 500px;
      margin: 0 auto 30px;
    }
    .search-box input {
      width: 100%;
      padding: 15px 20px;
      font-size: 1rem;
      border: 2px solid var(--border-color);
      border-radius: 10px;
      outline: none;
      transition: border-color 0.2s, background-color 0.3s;
      background: var(--bg-input);
      color: var(--text-primary);
    }
    .search-box input::placeholder { color: var(--text-muted); }
    .search-box input:focus { border-color: var(--accent-color); }
    .autocomplete {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      box-shadow: var(--card-shadow);
      max-height: 300px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    }
    .autocomplete.show { display: block; }
    .autocomplete-item {
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      transition: background-color 0.2s;
    }
    .autocomplete-item:hover { background: var(--hover-bg); }
    .autocomplete-item:last-child { border-bottom: none; }
    .company-name { font-weight: 600; color: var(--text-primary); }
    .company-meta { font-size: 0.85rem; color: var(--text-secondary); }
    .company-header {
      background: var(--bg-card);
      padding: 24px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: var(--card-shadow);
      display: none;
      border: 1px solid var(--border-color);
    }
    .company-header.show { display: block; }
    .company-title { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); }
    .stock-price {
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--accent-color);
      margin-top: 8px;
    }
    .company-info { color: var(--text-secondary); margin-top: 4px; }
    .grid { display: grid; gap: 20px; }
    .grid-2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 20px;
      box-shadow: var(--card-shadow);
      border: 1px solid var(--border-color);
    }
    .card-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid var(--border-color);
      color: var(--text-primary);
    }
    .chart-container { height: 300px; position: relative; }
    .chart-bars {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      height: 250px;
      padding: 0 10px;
    }
    .chart-group { text-align: center; flex: 1; }
    .chart-bar-wrapper {
      display: flex;
      justify-content: center;
      gap: 4px;
      height: 200px;
      align-items: flex-end;
    }
    .chart-bar {
      width: 20px;
      border-radius: 4px 4px 0 0;
      transition: height 0.6s ease-out, opacity 0.3s ease, transform 0.2s ease;
      cursor: pointer;
      transform-origin: bottom;
    }
    .chart-bar:hover {
      opacity: 0.8;
      transform: scaleY(1.02);
    }
    .chart-bar.revenue { background: var(--chart-revenue); }
    .chart-bar.operating { background: var(--chart-operating); }
    .chart-bar.net { background: var(--chart-net); }
    .chart-label { font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px; }
    .chart-legend {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-top: 16px;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot { width: 12px; height: 12px; border-radius: 3px; }
    .qoq-chart-container { padding: 10px 0; }
    #qoqChart { display: block; margin: 0 auto; }
    .qoq-label { font-size: 11px; fill: var(--text-secondary); }
    .qoq-value { font-size: 10px; font-weight: 600; }
    .qoq-value.positive { fill: var(--positive-color); }
    .qoq-value.negative { fill: var(--negative-color); }
    .qoq-table-container { margin-top: 20px; overflow-x: auto; }
    .qoq-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .qoq-table th, .qoq-table td {
      padding: 10px 8px;
      text-align: center;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-primary);
    }
    .qoq-table th {
      background: var(--table-header-bg);
      font-weight: 600;
      color: var(--text-secondary);
    }
    .qoq-table th:first-child, .qoq-table td:first-child {
      text-align: left;
      font-weight: 500;
    }
    .qoq-table .positive { color: var(--positive-color); }
    .qoq-table .negative { color: var(--negative-color); }
    .qoq-table .metric-revenue { border-left: 3px solid var(--chart-revenue); }
    .qoq-table .metric-op { border-left: 3px solid var(--chart-operating); }
    .qoq-table .metric-net { border-left: 3px solid var(--chart-net); }
    .ratios-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 16px;
    }
    .ratio-item { text-align: center; }
    .ratio-value { font-size: 1.4rem; font-weight: 700; color: var(--accent-color); }
    .ratio-label { 
      font-size: 0.85rem; 
      color: var(--text-secondary); 
      margin-top: 4px;
      cursor: default;
    }
    .ratio-label[title] { cursor: help; }
    
    /* 재무비율 카테고리 스타일 */
    .ratio-category {
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }
    .ratio-category:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    .ratio-category-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .list-item {
      padding: 12px 0;
      border-bottom: 1px solid var(--border-color);
    }
    .list-item:last-child { border-bottom: none; }
    .list-item a {
      color: var(--text-primary);
      text-decoration: none;
      display: block;
      transition: color 0.2s;
    }
    .list-item a:hover { color: var(--accent-color); }
    .list-title { font-weight: 500; margin-bottom: 4px; }
    .list-meta { font-size: 0.85rem; color: var(--text-muted); }
    .loading {
      text-align: center;
      padding: 40px;
      color: var(--text-muted);
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--spinner-bg);
      border-top-color: var(--accent-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-muted);
    }
    .empty-state h2 { font-size: 1.2rem; margin-bottom: 8px; color: var(--text-secondary); }
    
    /* 차트 애니메이션 */
    @keyframes barGrow {
      from { transform: scaleY(0); }
      to { transform: scaleY(1); }
    }
    .chart-bar.animate {
      animation: barGrow 0.6s ease-out forwards;
    }
    
    /* 차트 툴팁 */
    .chart-tooltip {
      position: fixed;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      z-index: 1000;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      font-size: 0.85rem;
      max-width: 200px;
    }
    .chart-tooltip.show { opacity: 1; }
    .chart-tooltip .tooltip-title {
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
    }
    .chart-tooltip .tooltip-value {
      color: var(--accent-color);
      font-weight: 700;
      font-size: 1.1rem;
    }
    .chart-tooltip .tooltip-change {
      font-size: 0.8rem;
      margin-top: 4px;
    }
    .chart-tooltip .tooltip-change.positive { color: var(--positive-color); }
    .chart-tooltip .tooltip-change.negative { color: var(--negative-color); }
    
    /* 영업이익 양수/음수 구분 */
    .chart-bar.operating.negative-value {
      background: var(--negative-color);
    }
    
    /* Mobile Responsive */
    @media (max-width: 768px) {
      .container { padding: 12px; }
      header { padding: 20px 16px; margin-bottom: 20px; border-radius: 8px; }
      header h1 { font-size: 1.4rem; }
      header p { font-size: 0.85rem; }
      .search-box { margin-bottom: 20px; }
      .search-box input { padding: 12px 16px; font-size: 16px; min-height: 48px; }
      .company-header { padding: 16px; }
      .company-title { font-size: 1.2rem; }
      .stock-price { font-size: 1.4rem; }
      .card { padding: 16px; border-radius: 8px; }
      .card-title { font-size: 1rem; margin-bottom: 12px; padding-bottom: 8px; }
      .chart-container { height: 250px; overflow-x: auto; }
      .chart-bars { height: 200px; min-width: 100%; }
      .chart-bar-wrapper { height: 160px; }
      .chart-bar { width: 14px; }
      .chart-legend { gap: 12px; font-size: 0.75rem; flex-wrap: wrap; }
      .legend-dot { width: 10px; height: 10px; }
      .ratios-grid { grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .ratio-value { font-size: 1.1rem; }
      .ratio-label { font-size: 0.75rem; }
      .grid-2 { grid-template-columns: 1fr; }
      .list-item { padding: 10px 0; min-height: 44px; }
      .list-title { font-size: 0.9rem; line-height: 1.4; }
      .list-meta { font-size: 0.75rem; }
      .empty-state { padding: 40px 16px; }
      .empty-state h2 { font-size: 1rem; }
      .empty-state p { font-size: 0.9rem; }
      .autocomplete-item { min-height: 44px; padding: 14px 16px; }
      .qoq-table-container { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    }
    
    @media (max-width: 480px) {
      .ratios-grid { grid-template-columns: repeat(2, 1fr); }
      .chart-bar { width: 10px; }
      .chart-label { font-size: 0.65rem; }
      .qoq-table { font-size: 0.75rem; }
      .qoq-table th, .qoq-table td { padding: 6px 4px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- 차트 툴팁 -->
    <div class="chart-tooltip" id="chartTooltip">
      <div class="tooltip-title"></div>
      <div class="tooltip-value"></div>
      <div class="tooltip-change"></div>
    </div>
    
    <header>
      <h1>📊 기업 실적 조회 서비스</h1>
      <p>KOSPI · KOSDAQ 상장 기업의 재무 데이터를 한눈에</p>
    </header>
    <div class="search-box">
      <input type="text" id="searchInput" placeholder="기업명을 입력하세요 (예: 삼성전자)" autocomplete="off">
      <div class="autocomplete" id="autocomplete"></div>
    </div>
    <div class="empty-state" id="emptyState">
      <h2>기업을 검색해주세요</h2>
      <p>검색창에 기업명을 입력하면 재무 데이터를 확인할 수 있습니다</p>
    </div>
    <div class="company-header" id="companyHeader">
      <div class="company-title" id="companyName">-</div>
      <div class="stock-price" id="stockPrice">-</div>
      <div class="company-info" id="companyInfo">-</div>
    </div>
    <div id="mainContent" style="display: none;">
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-title">📈 분기별 매출액</div>
        <div class="chart-container">
          <div class="chart-bars" id="revenueChartBars"></div>
        </div>
      </div>
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-title">📈 분기별 영업이익</div>
        <div class="chart-container">
          <div class="chart-bars" id="profitChartBars"></div>
        </div>
        <div class="qoq-table-container" id="qoqTableContainer"></div>
        <div class="annual-table-container" id="annualTableContainer" style="margin-top: 24px;"></div>
      </div>
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-title">📊 주요 재무비율</div>
        
        <!-- 가치평가 지표 -->
        <div class="ratio-category">
          <div class="ratio-category-title">가치평가</div>
          <div class="ratios-grid" id="ratiosGrid">
            <div class="ratio-item"><div class="ratio-value" id="ratioMarketCap">-</div><div class="ratio-label">시가총액</div></div>
            <div class="ratio-item"><div class="ratio-value" id="ratioPER">-</div><div class="ratio-label">PER</div></div>
            <div class="ratio-item"><div class="ratio-value" id="ratioPBR">-</div><div class="ratio-label">PBR</div></div>
            <div class="ratio-item"><div class="ratio-value" id="ratioEPS">-</div><div class="ratio-label">EPS</div></div>
          </div>
        </div>
        
        <!-- 수익성 지표 -->
        <div class="ratio-category">
          <div class="ratio-category-title">수익성</div>
          <div class="ratios-grid">
            <div class="ratio-item"><div class="ratio-value" id="ratioROE">-</div><div class="ratio-label">ROE</div></div>
            <div class="ratio-item"><div class="ratio-value" id="ratioOperatingMargin">-</div><div class="ratio-label">영업이익률</div></div>
            <div class="ratio-item"><div class="ratio-value" id="ratioDividend">-</div><div class="ratio-label">배당수익률</div></div>
          </div>
        </div>
        
        <!-- 안정성 지표 -->
        <div class="ratio-category">
          <div class="ratio-category-title">안정성</div>
          <div class="ratios-grid">
            <div class="ratio-item"><div class="ratio-value" id="ratioDebtRatio">-</div><div class="ratio-label">부채비율</div></div>
            <div class="ratio-item"><div class="ratio-value" id="ratioCurrentRatio">-</div><div class="ratio-label">당좌비율</div></div>
          </div>
        </div>
        
        <!-- 주가 정보 -->
        <div class="ratio-category">
          <div class="ratio-category-title">주가 정보</div>
          <div class="ratios-grid">
            <div class="ratio-item"><div class="ratio-value" id="ratio52wHigh">-</div><div class="ratio-label">52주 최고</div></div>
            <div class="ratio-item"><div class="ratio-value" id="ratio52wLow">-</div><div class="ratio-label">52주 최저</div></div>
          </div>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">📋 최근 공시 (5건)</div>
          <div id="disclosuresList"><div class="loading"><div class="spinner"></div>공시 정보를 불러오는 중...</div></div>
        </div>
        <div class="card">
          <div class="card-title">📰 최신 뉴스 (10건)</div>
          <div id="newsList"><div class="loading"><div class="spinner"></div>뉴스를 불러오는 중...</div></div>
        </div>
      </div>
    </div>
  </div>
  <script>
    const API_BASE = '/api';
    let selectedCorpCode = null;
    let debounceTimer = null;
    const searchInput = document.getElementById('searchInput');
    const autocomplete = document.getElementById('autocomplete');
    const emptyState = document.getElementById('emptyState');
    const companyHeader = document.getElementById('companyHeader');
    const mainContent = document.getElementById('mainContent');

    function formatKoreanCurrency(value) {
      if (value === null || value === undefined) return '-';
      const absValue = Math.abs(value);
      if (absValue >= 1e12) return (value / 1e12).toFixed(1) + '조';
      if (absValue >= 1e8) return (value / 1e8).toFixed(0) + '억';
      if (absValue >= 1e4) return (value / 1e4).toFixed(0) + '만';
      return value.toLocaleString();
    }

    // 억 원 단위로 변환 (그래프 스케일 통일용)
    function toHundredMillion(value) {
      return value / 1e8;
    }

    function formatPrice(price) {
      if (!price) return '-';
      return price.toLocaleString() + '원';
    }

    function formatDate(dateStr) {
      if (!dateStr || dateStr.length !== 8) return dateStr;
      return dateStr.slice(0,4) + '.' + dateStr.slice(4,6) + '.' + dateStr.slice(6,8);
    }

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(debounceTimer);
      if (query.length < 2) {
        autocomplete.classList.remove('show');
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(API_BASE + '/companies/search?q=' + encodeURIComponent(query));
          const data = await res.json();
          if (data.companies && data.companies.length > 0) {
            renderAutocomplete(data.companies);
          } else {
            autocomplete.innerHTML = '<div class="autocomplete-item">검색 결과가 없습니다</div>';
            autocomplete.classList.add('show');
          }
        } catch (err) {
          console.error('Search error:', err);
        }
      }, 300);
    });

    function renderAutocomplete(companies) {
      autocomplete.innerHTML = companies.map(c => 
        '<div class="autocomplete-item" data-corp-code="' + c.corpCode + '" data-stock-code="' + c.stockCode + '">' +
        '<div class="company-name">' + c.corpName + '</div>' +
        '<div class="company-meta">' + (c.stockCode || '') + ' · ' + (c.market || '') + '</div>' +
        '</div>'
      ).join('');
      autocomplete.classList.add('show');
      autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          const corpCode = item.dataset.corpCode;
          const corpName = item.querySelector('.company-name').textContent;
          searchInput.value = corpName;
          autocomplete.classList.remove('show');
          loadCompanyData(corpCode);
        });
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) autocomplete.classList.remove('show');
    });

    async function loadCompanyData(corpCode) {
      selectedCorpCode = corpCode;
      emptyState.style.display = 'none';
      companyHeader.classList.add('show');
      mainContent.style.display = 'block';
      document.getElementById('companyName').textContent = '로딩 중...';
      document.getElementById('stockPrice').textContent = '-';
      document.getElementById('companyInfo').textContent = '';
      await Promise.all([
        loadCompanyInfo(corpCode),
        loadFinancialData(corpCode),
        loadRatios(corpCode),
        loadDisclosures(corpCode),
        loadNews(corpCode)
      ]);
    }

    async function loadCompanyInfo(corpCode) {
      try {
        const res = await fetch(API_BASE + '/companies/' + corpCode);
        const data = await res.json();
        if (data.company) {
          document.getElementById('companyName').textContent = data.company.corpName;
          document.getElementById('stockPrice').textContent = data.formattedPrice || formatPrice(data.stockPrice);
          document.getElementById('companyInfo').textContent = (data.company.stockCode || '') + ' · ' + (data.company.market || '');
        }
      } catch (err) {
        console.error('Company info error:', err);
        document.getElementById('companyName').textContent = '정보를 불러올 수 없습니다';
      }
    }

    async function loadFinancialData(corpCode) {
      const revenueChartBars = document.getElementById('revenueChartBars');
      const profitChartBars = document.getElementById('profitChartBars');
      revenueChartBars.innerHTML = '<div class="loading"><div class="spinner"></div>재무 데이터 로딩 중...</div>';
      profitChartBars.innerHTML = '<div class="loading"><div class="spinner"></div>재무 데이터 로딩 중...</div>';
      try {
        const res = await fetch(API_BASE + '/companies/' + corpCode + '/financial');
        const data = await res.json();
        if (data.chartData && data.chartData.length > 0) {
          renderChart(data.chartData);
        } else {
          revenueChartBars.innerHTML = '<div class="loading">재무 데이터가 없습니다</div>';
          profitChartBars.innerHTML = '<div class="loading">재무 데이터가 없습니다</div>';
        }
      } catch (err) {
        console.error('Financial data error:', err);
        revenueChartBars.innerHTML = '<div class="loading">재무 데이터를 불러올 수 없습니다</div>';
        profitChartBars.innerHTML = '<div class="loading">재무 데이터를 불러올 수 없습니다</div>';
      }
    }

    function renderChart(chartData) {
      const revenueChartBars = document.getElementById('revenueChartBars');
      const profitChartBars = document.getElementById('profitChartBars');
      const tooltip = document.getElementById('chartTooltip');
      
      // 차트에는 최근 6분기만 표시
      const recentData = chartData.slice(-6);
      
      // QoQ 계산 (툴팁용)
      const qoqData = [];
      for (let i = 0; i < recentData.length; i++) {
        if (i === 0) {
          qoqData.push({ revenueQoQ: null, opQoQ: null });
        } else {
          const prev = recentData[i - 1];
          const curr = recentData[i];
          qoqData.push({
            revenueQoQ: prev.revenue !== 0 ? ((curr.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100 : null,
            opQoQ: prev.operatingProfit !== 0 ? ((curr.operatingProfit - prev.operatingProfit) / Math.abs(prev.operatingProfit)) * 100 : null
          });
        }
      }
      
      // 툴팁 표시 함수
      function showTooltip(e, title, value, change) {
        const tooltipTitle = tooltip.querySelector('.tooltip-title');
        const tooltipValue = tooltip.querySelector('.tooltip-value');
        const tooltipChange = tooltip.querySelector('.tooltip-change');
        
        tooltipTitle.textContent = title;
        tooltipValue.textContent = value;
        
        if (change !== null && change !== undefined) {
          const sign = change >= 0 ? '+' : '';
          tooltipChange.textContent = 'QoQ: ' + sign + change.toFixed(1) + '%';
          tooltipChange.className = 'tooltip-change ' + (change >= 0 ? 'positive' : 'negative');
          tooltipChange.style.display = 'block';
        } else {
          tooltipChange.style.display = 'none';
        }
        
        tooltip.style.left = (e.clientX + 10) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
        tooltip.classList.add('show');
      }
      
      function hideTooltip() {
        tooltip.classList.remove('show');
      }
      
      // 매출액 차트 - 자체 스케일
      const revenueValues = recentData.map(d => toHundredMillion(d.revenue));
      const maxRevenue = Math.max(...revenueValues.filter(v => v > 0));
      
      revenueChartBars.innerHTML = recentData.map((d, i) => {
        const revenueNorm = toHundredMillion(d.revenue);
        const revenueHeight = maxRevenue > 0 ? (revenueNorm / maxRevenue) * 180 : 0;
        
        return '<div class="chart-group">' +
          '<div class="chart-bar-wrapper">' +
          '<div class="chart-bar revenue animate" data-index="' + i + '" data-type="revenue" style="height: ' + Math.max(revenueHeight, 4) + 'px; animation-delay: ' + (i * 0.1) + 's"></div>' +
          '</div>' +
          '<div class="chart-label">' + d.quarter + '</div>' +
          '</div>';
      }).join('');
      
      // 영업이익 차트 - 자체 스케일 (양수/음수 구분)
      const profitValues = recentData.map(d => toHundredMillion(Math.abs(d.operatingProfit)));
      const maxProfit = Math.max(...profitValues.filter(v => v > 0));
      
      profitChartBars.innerHTML = recentData.map((d, i) => {
        const opNorm = toHundredMillion(Math.abs(d.operatingProfit));
        const opHeight = maxProfit > 0 ? (opNorm / maxProfit) * 180 : 0;
        const isNegative = d.operatingProfit < 0;
        
        return '<div class="chart-group">' +
          '<div class="chart-bar-wrapper">' +
          '<div class="chart-bar operating animate' + (isNegative ? ' negative-value' : '') + '" data-index="' + i + '" data-type="profit" style="height: ' + Math.max(opHeight, 4) + 'px; animation-delay: ' + (i * 0.1) + 's"></div>' +
          '</div>' +
          '<div class="chart-label">' + d.quarter + '</div>' +
          '</div>';
      }).join('');
      
      // 툴팁 이벤트 바인딩
      revenueChartBars.querySelectorAll('.chart-bar').forEach(bar => {
        const idx = parseInt(bar.dataset.index);
        const d = recentData[idx];
        bar.addEventListener('mouseenter', (e) => {
          showTooltip(e, d.quarter + ' 매출액', formatKoreanCurrency(d.revenue), qoqData[idx].revenueQoQ);
        });
        bar.addEventListener('mousemove', (e) => {
          tooltip.style.left = (e.clientX + 10) + 'px';
          tooltip.style.top = (e.clientY - 10) + 'px';
        });
        bar.addEventListener('mouseleave', hideTooltip);
      });
      
      profitChartBars.querySelectorAll('.chart-bar').forEach(bar => {
        const idx = parseInt(bar.dataset.index);
        const d = recentData[idx];
        bar.addEventListener('mouseenter', (e) => {
          showTooltip(e, d.quarter + ' 영업이익', formatKoreanCurrency(d.operatingProfit), qoqData[idx].opQoQ);
        });
        bar.addEventListener('mousemove', (e) => {
          tooltip.style.left = (e.clientX + 10) + 'px';
          tooltip.style.top = (e.clientY - 10) + 'px';
        });
        bar.addEventListener('mouseleave', hideTooltip);
      });
      
      // QoQ 테이블 렌더링 (최근 6분기)
      renderQoQTable(recentData);
      
      // 연간 실적 테이블 렌더링 (전체 데이터 사용)
      renderAnnualTable(chartData);
    }
    
    function renderQoQTable(chartData) {
      const container = document.getElementById('qoqTableContainer');
      if (!container || chartData.length < 2) {
        if (container) container.innerHTML = '';
        return;
      }
      
      // QoQ 계산 (첫 번째 분기는 비교 대상 없음)
      const qoqData = [];
      for (let i = 1; i < chartData.length; i++) {
        const prev = chartData[i - 1];
        const curr = chartData[i];
        qoqData.push({
          quarter: curr.quarter,
          revenueQoQ: prev.revenue !== 0 ? ((curr.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100 : 0,
          opQoQ: prev.operatingProfit !== 0 ? ((curr.operatingProfit - prev.operatingProfit) / Math.abs(prev.operatingProfit)) * 100 : 0
        });
      }
      
      // 테이블 헤더 (분기)
      let headerHtml = '<th>지표</th>';
      chartData.forEach(d => {
        headerHtml += '<th>' + d.quarter + '</th>';
      });
      
      // 매출액 행
      let revenueRow = '<td class="metric-revenue">매출액</td>';
      chartData.forEach((d, i) => {
        const value = formatKoreanCurrency(d.revenue);
        const qoq = i > 0 ? qoqData[i - 1].revenueQoQ : null;
        const qoqStr = qoq !== null ? '<br><span class="' + (qoq >= 0 ? 'positive' : 'negative') + '">(' + (qoq >= 0 ? '+' : '') + qoq.toFixed(1) + '%)</span>' : '';
        revenueRow += '<td>' + value + qoqStr + '</td>';
      });
      
      // 영업이익 행
      let opRow = '<td class="metric-op">영업이익</td>';
      chartData.forEach((d, i) => {
        const value = formatKoreanCurrency(d.operatingProfit);
        const qoq = i > 0 ? qoqData[i - 1].opQoQ : null;
        const qoqStr = qoq !== null ? '<br><span class="' + (qoq >= 0 ? 'positive' : 'negative') + '">(' + (qoq >= 0 ? '+' : '') + qoq.toFixed(1) + '%)</span>' : '';
        opRow += '<td>' + value + qoqStr + '</td>';
      });
      
      container.innerHTML = '<table class="qoq-table"><thead><tr>' + headerHtml + '</tr></thead><tbody>' +
        '<tr>' + revenueRow + '</tr>' +
        '<tr>' + opRow + '</tr>' +
        '</tbody></table>';
    }
    
    function renderAnnualTable(chartData) {
      const container = document.getElementById('annualTableContainer');
      if (!container || chartData.length === 0) {
        if (container) container.innerHTML = '';
        return;
      }
      
      // 분기 데이터를 연도별로 그룹화하고 분기 수 카운트
      const yearlyData = {};
      chartData.forEach(d => {
        const year = d.quarter.split('-')[0];
        if (!yearlyData[year]) {
          yearlyData[year] = { revenue: 0, operatingProfit: 0, quarterCount: 0 };
        }
        yearlyData[year].revenue += d.revenue;
        yearlyData[year].operatingProfit += d.operatingProfit;
        yearlyData[year].quarterCount += 1;
      });
      
      // 연도 정렬 (오래된 순)
      const years = Object.keys(yearlyData).sort();
      
      // 최근 3개년만 표시 (현재 연도 포함)
      const recentYears = years.slice(-3);
      
      if (recentYears.length === 0) {
        container.innerHTML = '';
        return;
      }
      
      // 테이블 헤더 (분기 수 표시)
      let headerHtml = '<th>연간 실적</th>';
      recentYears.forEach(year => {
        const qCount = yearlyData[year].quarterCount;
        const suffix = qCount < 4 ? ' (Q1~Q' + qCount + ')' : '';
        headerHtml += '<th>' + year + suffix + '</th>';
      });
      
      // YoY 계산 (4분기 완료된 연도끼리만 비교)
      const yoyData = [];
      for (let i = 1; i < recentYears.length; i++) {
        const prevYear = recentYears[i - 1];
        const currYear = recentYears[i];
        // 둘 다 4분기 완료된 경우만 YoY 계산
        if (yearlyData[prevYear].quarterCount === 4 && yearlyData[currYear].quarterCount === 4) {
          yoyData.push({
            year: currYear,
            revenueYoY: yearlyData[prevYear].revenue !== 0 
              ? ((yearlyData[currYear].revenue - yearlyData[prevYear].revenue) / Math.abs(yearlyData[prevYear].revenue)) * 100 
              : 0,
            opYoY: yearlyData[prevYear].operatingProfit !== 0 
              ? ((yearlyData[currYear].operatingProfit - yearlyData[prevYear].operatingProfit) / Math.abs(yearlyData[prevYear].operatingProfit)) * 100 
              : 0
          });
        } else {
          yoyData.push({ year: currYear, revenueYoY: null, opYoY: null });
        }
      }
      
      // 매출액 행
      let revenueRow = '<td class="metric-revenue">매출액</td>';
      recentYears.forEach((year, i) => {
        const value = formatKoreanCurrency(yearlyData[year].revenue);
        const yoy = i > 0 ? yoyData[i - 1].revenueYoY : null;
        const yoyStr = yoy !== null ? '<br><span class="' + (yoy >= 0 ? 'positive' : 'negative') + '">(' + (yoy >= 0 ? '+' : '') + yoy.toFixed(1) + '%)</span>' : '';
        revenueRow += '<td>' + value + yoyStr + '</td>';
      });
      
      // 영업이익 행
      let opRow = '<td class="metric-op">영업이익</td>';
      recentYears.forEach((year, i) => {
        const value = formatKoreanCurrency(yearlyData[year].operatingProfit);
        const yoy = i > 0 ? yoyData[i - 1].opYoY : null;
        const yoyStr = yoy !== null ? '<br><span class="' + (yoy >= 0 ? 'positive' : 'negative') + '">(' + (yoy >= 0 ? '+' : '') + yoy.toFixed(1) + '%)</span>' : '';
        opRow += '<td>' + value + yoyStr + '</td>';
      });
      
      container.innerHTML = '<table class="qoq-table"><thead><tr>' + headerHtml + '</tr></thead><tbody>' +
        '<tr>' + revenueRow + '</tr>' +
        '<tr>' + opRow + '</tr>' +
        '</tbody></table>';
    }

    async function loadRatios(corpCode) {
      ['ratioMarketCap', 'ratioDividend', 'ratioPER', 'ratioPBR', 'ratioROE', 'ratioEPS', 'ratio52wHigh', 'ratio52wLow', 'ratioOperatingMargin', 'ratioDebtRatio', 'ratioCurrentRatio'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '-';
      });
      try {
        const res = await fetch(API_BASE + '/companies/' + corpCode + '/ratios');
        const data = await res.json();
        if (data.ratios) {
          document.getElementById('ratioMarketCap').textContent = data.marketCap ? formatKoreanCurrency(data.marketCap) : '-';
          document.getElementById('ratioDividend').textContent = data.ratios.dividendYield ? data.ratios.dividendYield.toFixed(2) + '%' : '-';
          document.getElementById('ratioPER').textContent = data.ratios.per ? data.ratios.per.toFixed(2) + '배' : '-';
          document.getElementById('ratioPBR').textContent = data.ratios.pbr ? data.ratios.pbr.toFixed(2) + '배' : '-';
          document.getElementById('ratioROE').textContent = data.ratios.roe ? data.ratios.roe.toFixed(2) + '%' : '-';
          document.getElementById('ratioEPS').textContent = data.ratios.eps ? data.ratios.eps.toLocaleString() + '원' : '-';
          document.getElementById('ratio52wHigh').textContent = data.ratios.high52w ? data.ratios.high52w.toLocaleString() + '원' : '-';
          document.getElementById('ratio52wLow').textContent = data.ratios.low52w ? data.ratios.low52w.toLocaleString() + '원' : '-';
          
          // 새로운 재무비율 (영업이익률, 부채비율, 유동비율)
          document.getElementById('ratioOperatingMargin').textContent = data.ratios.operatingMargin ? data.ratios.operatingMargin.toFixed(2) + '%' : '-';
          document.getElementById('ratioDebtRatio').textContent = data.ratios.debtRatio ? data.ratios.debtRatio.toFixed(2) + '%' : '-';
          document.getElementById('ratioCurrentRatio').textContent = data.ratios.currentRatio ? data.ratios.currentRatio.toFixed(2) + '%' : '-';
        }
      } catch (err) {
        console.error('Ratios error:', err);
      }
    }

    async function loadDisclosures(corpCode) {
      const list = document.getElementById('disclosuresList');
      list.innerHTML = '<div class="loading"><div class="spinner"></div>공시 정보를 불러오는 중...</div>';
      try {
        const res = await fetch(API_BASE + '/companies/' + corpCode + '/disclosures');
        const data = await res.json();
        if (data.disclosures && data.disclosures.length > 0) {
          list.innerHTML = data.disclosures.map(d =>
            '<div class="list-item">' +
            '<a href="' + d.url + '" target="_blank" rel="noopener">' +
            '<div class="list-title">' + d.reportNm + '</div>' +
            '<div class="list-meta">' + formatDate(d.rcept_dt) + ' · ' + d.flr_nm + '</div>' +
            '</a></div>'
          ).join('');
        } else {
          list.innerHTML = '<div class="loading">공시 정보가 없습니다</div>';
        }
      } catch (err) {
        console.error('Disclosures error:', err);
        list.innerHTML = '<div class="loading">공시 정보를 불러올 수 없습니다</div>';
      }
    }

    async function loadNews(corpCode) {
      const list = document.getElementById('newsList');
      list.innerHTML = '<div class="loading"><div class="spinner"></div>뉴스를 불러오는 중...</div>';
      try {
        const res = await fetch(API_BASE + '/companies/' + corpCode + '/news');
        const data = await res.json();
        if (data.articles && data.articles.length > 0) {
          list.innerHTML = data.articles.map(a =>
            '<div class="list-item">' +
            '<a href="' + a.url + '" target="_blank" rel="noopener">' +
            '<div class="list-title">' + a.title + '</div>' +
            '<div class="list-meta">' + (a.source || '') + ' · ' + (a.publishedDate || '') + '</div>' +
            '</a></div>'
          ).join('');
        } else {
          list.innerHTML = '<div class="loading">뉴스가 없습니다</div>';
        }
      } catch (err) {
        console.error('News error:', err);
        list.innerHTML = '<div class="loading">뉴스를 불러올 수 없습니다</div>';
      }
    }
  </script>
</body>
</html>`;

// Create Hono application
const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use('*', cors());

// Request ID middleware
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);
  await next();
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'company-performance',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Root endpoint - Serve HTML UI
app.get('/', (c) => {
  return c.html(indexHtml);
});

// Initialize company list cache on first request (MUST be before routes)
app.use('/api/*', async (c, next) => {
  const searchService = getSearchService();
  
  if (!searchService.isInitialized()) {
    try {
      const cache = createCacheManager(c.env.COMPANY_CACHE);
      let companies = await cache.get<any[]>(CACHE_KEYS.COMPANY_LIST);
      
      if (!companies) {
        // 회사 목록은 KV에 미리 저장되어 있음 (company_list 키)
        const kvCompanies = await c.env.COMPANY_CACHE.get('company_list', 'json');
        
        if (kvCompanies) {
          companies = kvCompanies as any[];
          await cache.set(CACHE_KEYS.COMPANY_LIST, companies, CACHE_TTL.COMPANY_LIST);
        } else {
          companies = [];
        }
      }
      
      searchService.initializeIndex(companies);
    } catch (error) {
      // Silent fail - search will return empty results
    }
  }
  
  await next();
});

// Mount API routes
app.route('/api', api);

// 404 handler
app.notFound((c) => {
  const error: ErrorResponse = {
    error: 'NOT_FOUND',
    message: '요청하신 리소스를 찾을 수 없습니다.'
  };
  return c.json(error, 404);
});

// Global error handler
app.onError((err, c) => {
  const error: ErrorResponse = {
    error: 'INTERNAL_ERROR',
    message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    code: err.message
  };
  
  return c.json(error, 500);
});

// Export the application
export default app;
