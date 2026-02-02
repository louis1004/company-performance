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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      color: #333;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
      border: 2px solid #e1e5eb;
      border-radius: 10px;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-box input:focus { border-color: #667eea; }
    .autocomplete {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid #e1e5eb;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      max-height: 300px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    }
    .autocomplete.show { display: block; }
    .autocomplete-item {
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
    }
    .autocomplete-item:hover { background: #f5f7fa; }
    .autocomplete-item:last-child { border-bottom: none; }
    .company-name { font-weight: 600; }
    .company-meta { font-size: 0.85rem; color: #666; }
    .company-header {
      background: white;
      padding: 24px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      display: none;
    }
    .company-header.show { display: block; }
    .company-title { font-size: 1.5rem; font-weight: 700; }
    .stock-price {
      font-size: 1.8rem;
      font-weight: 700;
      color: #667eea;
      margin-top: 8px;
    }
    .company-info { color: #666; margin-top: 4px; }
    .grid { display: grid; gap: 20px; }
    .grid-2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    .card-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #f0f0f0;
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
      transition: height 0.3s;
      cursor: pointer;
    }
    .chart-bar.revenue { background: #667eea; }
    .chart-bar.operating { background: #48bb78; }
    .chart-bar.net { background: #ed8936; }
    .chart-label { font-size: 0.75rem; color: #666; margin-top: 8px; }
    .chart-legend {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-top: 16px;
      font-size: 0.85rem;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot { width: 12px; height: 12px; border-radius: 3px; }
    .qoq-chart-container { padding: 10px 0; }
    #qoqChart { display: block; margin: 0 auto; }
    .qoq-label { font-size: 11px; fill: #666; }
    .qoq-value { font-size: 10px; font-weight: 600; }
    .qoq-value.positive { fill: #e53e3e; }
    .qoq-value.negative { fill: #3182ce; }
    .qoq-table-container { margin-top: 20px; overflow-x: auto; }
    .qoq-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .qoq-table th, .qoq-table td {
      padding: 10px 8px;
      text-align: center;
      border-bottom: 1px solid #e1e5eb;
    }
    .qoq-table th {
      background: #f5f7fa;
      font-weight: 600;
      color: #555;
    }
    .qoq-table th:first-child, .qoq-table td:first-child {
      text-align: left;
      font-weight: 500;
    }
    .qoq-table .positive { color: #e53e3e; }
    .qoq-table .negative { color: #3182ce; }
    .qoq-table .metric-revenue { border-left: 3px solid #667eea; }
    .qoq-table .metric-op { border-left: 3px solid #48bb78; }
    .qoq-table .metric-net { border-left: 3px solid #ed8936; }
    .ratios-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 16px;
    }
    .ratio-item { text-align: center; }
    .ratio-value { font-size: 1.4rem; font-weight: 700; color: #667eea; }
    .ratio-label { font-size: 0.85rem; color: #666; margin-top: 4px; }
    .list-item {
      padding: 12px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .list-item:last-child { border-bottom: none; }
    .list-item a {
      color: #333;
      text-decoration: none;
      display: block;
    }
    .list-item a:hover { color: #667eea; }
    .list-title { font-weight: 500; margin-bottom: 4px; }
    .list-meta { font-size: 0.85rem; color: #888; }
    .loading {
      text-align: center;
      padding: 40px;
      color: #888;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #f0f0f0;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #888;
    }
    .empty-state h2 { font-size: 1.2rem; margin-bottom: 8px; color: #666; }
    
    /* Mobile Responsive */
    @media (max-width: 768px) {
      .container { padding: 12px; }
      header { padding: 20px 16px; margin-bottom: 20px; border-radius: 8px; }
      header h1 { font-size: 1.4rem; }
      header p { font-size: 0.85rem; }
      .search-box { margin-bottom: 20px; }
      .search-box input { padding: 12px 16px; font-size: 16px; }
      .company-header { padding: 16px; }
      .company-title { font-size: 1.2rem; }
      .stock-price { font-size: 1.4rem; }
      .card { padding: 16px; border-radius: 8px; }
      .card-title { font-size: 1rem; margin-bottom: 12px; padding-bottom: 8px; }
      .chart-container { height: 250px; }
      .chart-bars { height: 200px; }
      .chart-bar-wrapper { height: 160px; }
      .chart-bar { width: 14px; }
      .chart-legend { gap: 12px; font-size: 0.75rem; flex-wrap: wrap; }
      .legend-dot { width: 10px; height: 10px; }
      .ratios-grid { grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .ratio-value { font-size: 1.1rem; }
      .ratio-label { font-size: 0.75rem; }
      .grid-2 { grid-template-columns: 1fr; }
      .list-item { padding: 10px 0; }
      .list-title { font-size: 0.9rem; line-height: 1.4; }
      .list-meta { font-size: 0.75rem; }
      .empty-state { padding: 40px 16px; }
      .empty-state h2 { font-size: 1rem; }
      .empty-state p { font-size: 0.9rem; }
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
        <div class="card-title">📈 분기별 재무 실적</div>
        <div class="chart-container">
          <div class="chart-bars" id="chartBars"></div>
          <div class="chart-legend">
            <div class="legend-item"><div class="legend-dot" style="background: #667eea;"></div>매출액</div>
            <div class="legend-item"><div class="legend-dot" style="background: #48bb78;"></div>영업이익</div>
            <div class="legend-item"><div class="legend-dot" style="background: #ed8936;"></div>당기순이익</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-title">📉 전분기 대비 성장률 (QoQ)</div>
        <div class="qoq-chart-container">
          <svg id="qoqChart" width="100%" height="200" viewBox="0 0 600 200"></svg>
          <div class="chart-legend">
            <div class="legend-item"><div class="legend-dot" style="background: #667eea;"></div>매출액</div>
            <div class="legend-item"><div class="legend-dot" style="background: #48bb78;"></div>영업이익</div>
            <div class="legend-item"><div class="legend-dot" style="background: #ed8936;"></div>당기순이익</div>
          </div>
        </div>
        <div class="qoq-table-container" id="qoqTableContainer"></div>
      </div>
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-title">📊 주요 재무비율</div>
        <div class="ratios-grid" id="ratiosGrid">
          <div class="ratio-item"><div class="ratio-value" id="ratioEPS">-</div><div class="ratio-label">EPS</div></div>
          <div class="ratio-item"><div class="ratio-value" id="ratioPER">-</div><div class="ratio-label">PER</div></div>
          <div class="ratio-item"><div class="ratio-value" id="ratioPBR">-</div><div class="ratio-label">PBR</div></div>
          <div class="ratio-item"><div class="ratio-value" id="ratioROA">-</div><div class="ratio-label">ROA</div></div>
          <div class="ratio-item"><div class="ratio-value" id="ratioROE">-</div><div class="ratio-label">ROE</div></div>
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
      const chartBars = document.getElementById('chartBars');
      chartBars.innerHTML = '<div class="loading"><div class="spinner"></div>재무 데이터 로딩 중...</div>';
      try {
        const res = await fetch(API_BASE + '/companies/' + corpCode + '/financial');
        const data = await res.json();
        if (data.chartData && data.chartData.length > 0) {
          renderChart(data.chartData);
        } else {
          chartBars.innerHTML = '<div class="loading">재무 데이터가 없습니다</div>';
        }
      } catch (err) {
        console.error('Financial data error:', err);
        chartBars.innerHTML = '<div class="loading">재무 데이터를 불러올 수 없습니다</div>';
      }
    }

    function renderChart(chartData) {
      const chartBars = document.getElementById('chartBars');
      
      // 모든 값을 억 원 단위로 변환하여 스케일 통일
      const allValues = chartData.flatMap(d => [
        toHundredMillion(d.revenue), 
        toHundredMillion(d.operatingProfit), 
        toHundredMillion(d.netIncome)
      ]);
      const maxValue = Math.max(...allValues.filter(v => v > 0));
      
      chartBars.innerHTML = chartData.map(d => {
        const revenueNorm = toHundredMillion(d.revenue);
        const opNorm = toHundredMillion(Math.abs(d.operatingProfit));
        const netNorm = toHundredMillion(Math.abs(d.netIncome));
        
        const revenueHeight = maxValue > 0 ? (revenueNorm / maxValue) * 180 : 0;
        const opHeight = maxValue > 0 ? (opNorm / maxValue) * 180 : 0;
        const netHeight = maxValue > 0 ? (netNorm / maxValue) * 180 : 0;
        
        return '<div class="chart-group">' +
          '<div class="chart-bar-wrapper">' +
          '<div class="chart-bar revenue" style="height: ' + Math.max(revenueHeight, 4) + 'px" title="매출액: ' + formatKoreanCurrency(d.revenue) + '"></div>' +
          '<div class="chart-bar operating" style="height: ' + Math.max(opHeight, 4) + 'px" title="영업이익: ' + formatKoreanCurrency(d.operatingProfit) + '"></div>' +
          '<div class="chart-bar net" style="height: ' + Math.max(netHeight, 4) + 'px" title="당기순이익: ' + formatKoreanCurrency(d.netIncome) + '"></div>' +
          '</div>' +
          '<div class="chart-label">' + d.quarter + '</div>' +
          '</div>';
      }).join('');
      
      // QoQ 성장률 차트 렌더링
      renderQoQChart(chartData);
    }

    function renderQoQChart(chartData) {
      const svg = document.getElementById('qoqChart');
      const tableContainer = document.getElementById('qoqTableContainer');
      if (!svg || chartData.length < 2) {
        if (tableContainer) tableContainer.innerHTML = '';
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
          opQoQ: prev.operatingProfit !== 0 ? ((curr.operatingProfit - prev.operatingProfit) / Math.abs(prev.operatingProfit)) * 100 : 0,
          netQoQ: prev.netIncome !== 0 ? ((curr.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100 : 0
        });
      }
      
      if (qoqData.length === 0) return;
      
      const width = 600;
      const height = 200;
      const padding = { top: 30, right: 40, bottom: 40, left: 50 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      
      // Y축 범위 계산
      const allQoQ = qoqData.flatMap(d => [d.revenueQoQ, d.opQoQ, d.netQoQ]);
      const maxQoQ = Math.max(...allQoQ, 10);
      const minQoQ = Math.min(...allQoQ, -10);
      const yRange = Math.max(Math.abs(maxQoQ), Math.abs(minQoQ)) * 1.2;
      
      // X, Y 좌표 계산 함수
      const xScale = (i) => padding.left + (i / (qoqData.length - 1 || 1)) * chartWidth;
      const yScale = (v) => padding.top + chartHeight / 2 - (v / yRange) * (chartHeight / 2);
      
      // SVG 내용 생성
      let svgContent = '';
      
      // 0% 기준선
      const zeroY = yScale(0);
      svgContent += '<line x1="' + padding.left + '" y1="' + zeroY + '" x2="' + (width - padding.right) + '" y2="' + zeroY + '" stroke="#ccc" stroke-dasharray="4"/>';
      
      // Y축 레이블
      const yTicks = [-Math.round(yRange), -Math.round(yRange/2), 0, Math.round(yRange/2), Math.round(yRange)];
      yTicks.forEach(tick => {
        const y = yScale(tick);
        svgContent += '<text x="' + (padding.left - 10) + '" y="' + (y + 4) + '" class="qoq-label" text-anchor="end">' + tick + '%</text>';
      });
      
      // 선 그리기 함수
      function drawLine(data, getValue, color) {
        if (data.length < 1) return '';
        let path = 'M';
        let circles = '';
        let labels = '';
        
        data.forEach((d, i) => {
          const x = qoqData.length === 1 ? padding.left + chartWidth / 2 : xScale(i);
          const y = yScale(getValue(d));
          path += (i === 0 ? '' : ' L') + x + ',' + y;
          circles += '<circle cx="' + x + '" cy="' + y + '" r="5" fill="' + color + '" stroke="white" stroke-width="2"/>';
          
          const val = getValue(d).toFixed(1);
          const sign = val >= 0 ? '+' : '';
          const valClass = val >= 0 ? 'positive' : 'negative';
          labels += '<text x="' + x + '" y="' + (y - 10) + '" class="qoq-value ' + valClass + '" text-anchor="middle">' + sign + val + '%</text>';
        });
        
        return '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.5"/>' + circles + labels;
      }
      
      // 세 개의 선 그리기
      svgContent += drawLine(qoqData, d => d.revenueQoQ, '#667eea');
      svgContent += drawLine(qoqData, d => d.opQoQ, '#48bb78');
      svgContent += drawLine(qoqData, d => d.netQoQ, '#ed8936');
      
      // X축 레이블
      qoqData.forEach((d, i) => {
        const x = qoqData.length === 1 ? padding.left + chartWidth / 2 : xScale(i);
        svgContent += '<text x="' + x + '" y="' + (height - 10) + '" class="qoq-label" text-anchor="middle">' + d.quarter + '</text>';
      });
      
      svg.innerHTML = svgContent;
      
      // QoQ 테이블 렌더링
      renderQoQTable(chartData, qoqData, tableContainer);
    }
    
    function renderQoQTable(chartData, qoqData, container) {
      if (!container) return;
      
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
      
      // 당기순이익 행
      let netRow = '<td class="metric-net">당기순이익</td>';
      chartData.forEach((d, i) => {
        const value = formatKoreanCurrency(d.netIncome);
        const qoq = i > 0 ? qoqData[i - 1].netQoQ : null;
        const qoqStr = qoq !== null ? '<br><span class="' + (qoq >= 0 ? 'positive' : 'negative') + '">(' + (qoq >= 0 ? '+' : '') + qoq.toFixed(1) + '%)</span>' : '';
        netRow += '<td>' + value + qoqStr + '</td>';
      });
      
      container.innerHTML = '<table class="qoq-table"><thead><tr>' + headerHtml + '</tr></thead><tbody>' +
        '<tr>' + revenueRow + '</tr>' +
        '<tr>' + opRow + '</tr>' +
        '<tr>' + netRow + '</tr>' +
        '</tbody></table>';
    }

    async function loadRatios(corpCode) {
      ['ratioEPS', 'ratioPER', 'ratioPBR', 'ratioROA', 'ratioROE'].forEach(id => document.getElementById(id).textContent = '-');
      try {
        const res = await fetch(API_BASE + '/companies/' + corpCode + '/ratios');
        const data = await res.json();
        if (data.ratios) {
          document.getElementById('ratioEPS').textContent = data.ratios.eps ? data.ratios.eps.toLocaleString() + '원' : '-';
          document.getElementById('ratioPER').textContent = data.ratios.per ? data.ratios.per.toFixed(2) + '배' : '-';
          document.getElementById('ratioPBR').textContent = data.ratios.pbr ? data.ratios.pbr.toFixed(2) + '배' : '-';
          document.getElementById('ratioROA').textContent = data.ratios.roa ? data.ratios.roa.toFixed(2) + '%' : '-';
          document.getElementById('ratioROE').textContent = data.ratios.roe ? data.ratios.roe.toFixed(2) + '%' : '-';
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
