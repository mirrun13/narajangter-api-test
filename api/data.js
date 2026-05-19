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
      if (cached) {
        return res.status(200).json({
          ...cached,
          cached: true,
          cacheAge: Math.floor((Date.now() - new Date(cached.timestamp).getTime()) / 1000)
        });
      }
    } catch (e) {
      console.error('캐시 조회 실패:', e);
    }
  }
  
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  
  const now = new Date();
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  
  const ranges = [
    { bgn: fmt(day30) + "0000", end: fmt(now) + "2359" },
    { bgn: fmt(day60) + "0000", end: fmt(day30) + "2359" }
  ];
  
  const buildBidUrl = (keyword, range) => 
    `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch?` +
    `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
    `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
    `&pageNo=1&numOfRows=100&bidNtceNm=${encodeURIComponent(keyword)}`;
  
  // [수정 핵심] 사라진 '접수문서' API를 버리고, 방금 신청 완료하신 메인 '사전규격정보' 하나로만 깔끔하게 통일했습니다!
  const preSpecEndpoints = [
    {
      url: (keyword, range) => `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?ServiceKey=${API_KEY}&type=json&inqryDiv=1&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}&pageNo=1&numOfRows=100&bfSpecRgstNm=${encodeURIComponent(keyword)}`,
      titleField: 'bfSpecRgstNm',
      noField: 'bfSpecRgstNo'
    }
  ];
  
  const bidTasks = [];
  for (const keyword of KEYWORDS) {
    for (const range of ranges) {
      bidTasks.push(
        fetch(buildBidUrl(keyword, range))
          .then(r => r.json())
          .then(data => ({ keyword, items: data?.response?.body?.items || [], type: 'bid' }))
          .catch(err => ({ keyword, items: [], type: 'bid', error: err.message }))
      );
    }
  }
  
  const preSpecTasks = [];
  for (const endpoint of preSpecEndpoints) {
    for (const keyword of KEYWORDS) {
      for (const range of ranges) {
        preSpecTasks.push(
          fetch(endpoint.url(keyword, range))
            .then(r => r.json())
            .then(data => ({ 
              keyword, 
              items: data?.response?.body?.items || [], 
              type: 'preSpec',
              titleField: endpoint.titleField,
              noField: endpoint.noField
            }))
            .catch(err => ({ keyword, items: [], type: 'preSpec', error: err.message }))
        );
      }
    }
  }
  
  const [bidResults, preSpecResults] = await Promise.all([
    Promise.all(bidTasks),
    Promise.all(preSpecTasks)
  ]);
  
  const itemMap = new Map();
  
  const processResults = (results, isPreSpec) => {
    for (const result of results) {
      const { keyword, items, titleField, noField } = result;
      for (const item of items) {
        
        const itemNo = isPreSpec 
          ? (item[noField || 'bfSpecRgstNo'] || item.prdctClsfcNo || item.bidNtceNo || '')
          : (item.bidNtceNo || '');
        
        const itemName = isPreSpec
          ? (item[titleField || 'bfSpecRgstNm'] || item.prdctClsfcNoNm || item.bidNtceNm || '사전규격 공고')
          : (item.bidNtceNm || '');
        
        if (!itemNo || !itemName) continue;
        
        const key = `${itemNo}-${item.bidNtceOrd || '000'}-${isPreSpec ? 'pre' : 'bid'}`;
        
        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          if (!existing.matchedKeywords.includes(keyword)) {
            existing.matchedKeywords.push(keyword);
          }
        } else {
          const isTrackA = TRACK_A_PATTERNS.some(p => itemName.includes(p));
          
          const indstCd = item.indstrytyCd || '';
          const indstNm = item.indstrytyLmtNm || '';
          const hasIndstLimit = item.indstrytyLmtYn === 'Y' || indstCd || indstNm;
          
          let industryStatus = 'unknown';
          if (!hasIndstLimit) {
            industryStatus = 'no_limit';
          } else if (indstCd.includes(TARGET_INDUSTRY_CODE) || indstNm.includes('실내건축')) {
            industryStatus = 'match';
          } else {
            industryStatus = 'mismatch';
          }
          
          itemMap.set(key, {
            ...item,
            bidNtceNo: itemNo,
            bidNtceNm: itemName,
            matchedKeywords: [keyword],
            track: isPreSpec ? 'P' : (isTrackA ? 'A' : 'B'),
            isPreSpec,
            industryStatus,
            industryCode: indstCd,
            industryName: indstNm
          });
        }
      }
    }
  };
  
  processResults(bidResults, false);
  processResults(preSpecResults, true);
  
  const allItems = Array.from(itemMap.values());
  
  allItems.sort((a, b) => {
    const aDate = a.bidClseDt || a.opengDt || a.bfSpecRgstDt || '9999';
    const bDate = b.bidClseDt || b.opengDt || b.bfSpecRgstDt || '9999';
    return aDate.localeCompare(bDate);
  });
  
  const response = {
    success: true,
    timestamp: now.toISOString(),
    totalCount: allItems.length,
    trackACount: allItems.filter(i => i.track === 'A').length,
    trackBCount: allItems.filter(i => i.track === 'B').length,
    preSpecCount: allItems.filter(i => i.track === 'P').length,
    items: allItems,
    cached: false
  };
  
  try {
    await kv.set(CACHE_KEY, response, { ex: CACHE_DURATION });
  } catch (e) {
    console.error('캐시 저장 실패:', e);
  }
  
  res.status(200).json(response);
}
