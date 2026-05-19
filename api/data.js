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
      presmptPrce: item.asignBdgtAmt || item.bdgtAmt || '0',
      matchedKeywords: [keyword],
      track: 'P',
      industryStatus: 'unknown',
      isPreSpec: true
    }));
  } catch { return []; }
}

function detectTrack(item) {
  const method = item.bidMthdNm || item.cntrctMthdNm || '';
  if (method.includes('제안') || method.includes('협상')) return 'A';
  return 'B';
}

function detectIndustry(item) {
  const txt = JSON.stringify(item);
  if (txt.includes('4990') || txt.includes('실내건축')) return 'match';
  if (!item.indstryLmtYn || item.indstryLmtYn === 'N') return 'no_limit';
  return 'unknown';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const forceRefresh = req.query.refresh === 'true';

  try {
    const cacheKey = 'bid_data_v2';

    if (!forceRefresh) {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const age = cached.cachedAt ? Math.floor((Date.now() - cached.cachedAt) / 1000) : 0;
        return res.status(200).json({
          success: true,
          items: cached.items,
          preSpecCount: cached.preSpecCount || 0,
          cached: true,
          cacheAge: age
        });
      }
    }

    const bidMap = new Map();
    const specMap = new Map();

    for (const kw of KEYWORDS) {
      const bids = await fetchBids(kw);
      for (const b of bids) {
        const key = b.bidNtceNo;
        if (!key) continue;
        if (bidMap.has(key)) {
          bidMap.get(key).matchedKeywords.push(kw);
        } else {
          bidMap.set(key, b);
        }
      }

      const specs = await fetchSpecs(kw);
      for (const s of specs) {
        const key = s.bidNtceNo;
        if (!key) continue;
        if (!specMap.has(key)) specMap.set(key, s);
      }
    }

    const items = [...bidMap.values(), ...specMap.values()];
    const preSpecCount = specMap.size;

    await kv.set(cacheKey, { items, preSpecCount, cachedAt: Date.now() }, { ex: CACHE_TTL });

    return res.status(200).json({ success: true, items, preSpecCount, cached: false, cacheAge: 0 });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
