import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

const xmlData = fs.readFileSync('/tmp/corpcode.xml', 'utf-8');
const parser = new XMLParser({
  // 숫자로 자동 변환하지 않도록 설정
  parseTagValue: false
});
const result = parser.parse(xmlData);
const list = result.result?.list || [];

const items = Array.isArray(list) ? list : [list];

// 상장 기업만 필터링 (stock_code가 있는 기업)
const companies = items
  .filter(item => item.stock_code && String(item.stock_code).trim() !== '')
  .map(item => ({
    corpCode: String(item.corp_code).padStart(8, '0'),
    corpName: String(item.corp_name),
    stockCode: String(item.stock_code).trim().padStart(6, '0'),
    market: '' // 시장 정보는 corpCode.xml에 없음, 나중에 별도 API로 조회 필요
  }));

console.log('Total listed companies:', companies.length);
fs.writeFileSync('src/data/companies.json', JSON.stringify(companies));
console.log('Saved to src/data/companies.json');
