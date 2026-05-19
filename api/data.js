import { kv } from '@vercel/kv';

const CACHE_KEY = 'bid_data_cache';
const CACHE_DURATION = 3600;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
  const KEYWORDS = ["전시","홍보관","과학관","체험","박물관","행사","홍보","인테리어","디자인","공간","서울"];
  const TRACK_A_PATTERNS = ['협상','기술제안','제안서','2단계','설계공모'];
  const TARGET_INDUSTRY_CODE = "4990";
  
  const forceRefresh = req.query.refresh === 'true';
  
  if (!forceRefresh) {
    try {
      const cached = await kv.get(CACHE_KEY);
      if (cached) return res.status(200).json({...cached, cached: true});
    } catch (e) { console.error(e); }
  }
  
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  
  const now = new Date();
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ranges = [{ bgn: fmt(day30) + "0000", end: fmt(now) + "2359" }];
  
  // 1. 일반 입찰 API
  const bidUrl = (kw, r) => `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch?ServiceKey=${API_KEY}&type=json&inqryDiv=1&inqryBgnDt=${r.bgn}&inqryEndDt=${r.end}&bidNtceNm=${encodeURIComponent(kw)}`;
  // 2. 사전규격 API (방금 신청하신 것)
  const preUrl = (kw, r) => `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?ServiceKey=${API_KEY}&type=json&inqryDiv=1&inqryBgnDt=${r.bgn}&inqryEndDt=${r.end}&bfSpecRgstNm=${encodeURIComponent(kw)}`;
  
  const tasks = [];
  for (const kw of KEYWORDS) {
    for (const r of ranges) {
      tasks.push(fetch(bidUrl(kw, r)).then(r => r.json()).then(d => ({ items: d?.response?.body?.items || [], type: 'bid' })));
      tasks.push(fetch(preUrl(kw, r)).then(r => r.json()).then(d => ({ items: d?.response?.body?.items || [], type: 'pre' })));
    }
  }
  
  const results = await Promise.all(tasks);
  const itemMap = new Map();
  
  results.forEach(res => {
    res.items.forEach(item => {
      const isPre = res.type === 'pre';
      const id = isPre ? item.bfSpecRgstNo : item.bidNtceNo;
      if (!id) return;
      
      const key = `${id}-${isPre ? 'pre' : 'bid'}`;
      if (!itemMap.has(key)) {
        const title = isPre ? item.bfSpecRgstNm : item.bidNtceNm;
        itemMap.set(key, { ...item, bidNtceNo: id, bidNtceNm: title, track: isPre ? 'P' : 'B' });
      }
    });
  });
  
  const items = Array.from(itemMap.values());
  const response = { success: true, items };
  await kv.set(CACHE_KEY, response, { ex: CACHE_DURATION });
  res.status(200).json(response);
}
