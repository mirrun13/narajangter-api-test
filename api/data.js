import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
const KEYWORDS = ['전시', '박물관', '홍보관', '기념관', '체험관', '방문자센터', '안내센터', '전시관', '기획전시', '상설전시', '인테리어'];
const CACHE_TTL = 3600;

async function fetchBidList(keyword) {
  const url = `https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServc?ServiceKey=${API_KEY}&type=json&numOfRows=100&pageNo=1&bidNm=${encodeURIComponent(keyword)}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.response?.body?.items || [];
}

async function fetchSpecList(keyword) {
  const url = `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?ServiceKey=${API_KEY}&type=json&numOfRows=100&pageNo=1&bfSpecNm=${encodeURIComponent(keyword)}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.response?.body?.items || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const cacheKey = 'bid_data_cache';
    const cached = await kv.get(cacheKey);
    if (cached) {
      return res.status(200).json({ success: true, data: cached, fromCache: true });
    }

    const bidResults = [];
    const specResults = [];

    for (const keyword of KEYWORDS) {
      try {
        const bids = await fetchBidList(keyword);
        bidResults.push(...bids);
        const specs = await fetchSpecList(keyword);
        specResults.push(...specs);
      } catch (e) {
        console.error(`키워드 ${keyword} 오류:`, e.message);
      }
    }

    const uniqueBids = Array.from(new Map(bidResults.map(item => [item.bidNtceNo, item])).values());
    const uniqueSpecs = Array.from(new Map(specResults.map(item => [item.bfSpecRegNo, item])).values());

    const result = {
      bids: uniqueBids,
      specs: uniqueSpecs,
      updatedAt: new Date().toISOString()
    };

    await kv.set(cacheKey, result, { ex: CACHE_TTL });

    return res.status(200).json({ success: true, data: result, fromCache: false });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
