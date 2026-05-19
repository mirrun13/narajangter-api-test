import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
const KEYWORDS = ['전시','박물관','홍보관','기념관','체험관','방문자센터','안내센터','전시관','기획전시','상설전시','인테리어'];
const CACHE_TTL = 3600;

async function fetchBids(keyword) {
  try {
    const url = `https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServc?ServiceKey=${API_KEY}&type=json&numOfRows=100&pageNo=1&bidNm=${encodeURIComponent(keyword)}`;
    const res = await fetch(url);
    const data = await res.json();
    const items = data?.response?.body?.items || [];
    return (Array.isArray(items) ? items : [items]).map(item => ({
      ...item,
      matchedKeywords: [keyword],
      track: detectTrack(item),
      industryStatus: detectIndustry(item),
      isPreSpec: false
    }));
  } catch { return []; }
}

async function fetchSpecs(keyword) {
  try {
    const url = `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?ServiceKey=${API_KEY}&type=json&numOfRows=100&pageNo=1&bfSpecNm=${encodeURIComponent(keyword)}`;
    const res = await fetch(url);
    const data = await res.json();
    const items = data?.response?.body?.items || [];
    return (Array.isArray(items) ? items : [items]).map(item => ({
      ...item,
      bidNtceNo: item.bfSpecRgstNo || '',
      bidNtceNm: item.bfSpecNm || item.prdctClsfcNoNm || '사전규격',
      bidClseDt: item.rcptDocClseDt || item.endDt || '',
      bidNtceDt: item.bfSpecRgstDt || '',
      dminsttNm: item.dminsttNm || item.orderInsttNm || '',
      presmptPrce: item.asignBdgtAmt || item.bdgtAmt || '0'
