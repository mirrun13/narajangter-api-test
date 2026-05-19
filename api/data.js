import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
  const KEYWORDS = ["전시","홍보관","과학관","체험","박물관","행사","홍보","인테리어","디자인","공간","서울"];
  const TRACK_A_PATTERNS = ['협상','기술제안','제안서','2단계','설계공모'];
  const TARGET_INDUSTRY_CODE = "4990";
  const CACHE_TTL = 3600;

  const forceRefresh = req.query.refresh === 'true';

  try {
    const cacheKey = 'bid_data_v4';
    if (!forceRefresh) {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const age = cached.cachedAt ? Math.floor((Date.now() - cached.cachedAt) / 1000) : 0;
        return res.status(200).json({ ...cached.payload, cached: true, cacheAge: age });
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

    // 사전규격은 용역/공사 둘 다 호출
    const buildPreSpecServcUrl = (range) =>
      `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=1&numOfRows=100`;

    const buildPreSpecCnstwkUrl = (range) =>
      `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoCnstwk?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=1&numOfRows=100`;

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

    // 사전규격은 키워드 없이 전체 호출 후 클라이언트 필터링
    const preSpecTasks = [];
    for (const range of ranges) {
      preSpecTasks.push(
        fetch(buildPreSpecServcUrl(range))
          .then(r => r.json())
          .then(data => ({ items: data?.response?.body?.items || [], type: 'preSpec' }))
          .catch(err => ({ items: [], type: 'preSpec', error: err.message }))
      );
      preSpecTasks.push(
        fetch(buildPreSpecCnstwkUrl(range))
          .then(r => r.json())
          .then(data => ({ items: data?.response?.body?.items || [], type: 'preSpec' }))
          .catch(err => ({ items: [], type: 'preSpec', error: err.message }))
      );
    }

    const [bidResults, preSpecResults] = await Promise.all([
      Promise.all(bidTasks),
      Promise.all(preSpecTasks)
    ]);

    const itemMap = new Map();

    // 입찰공고 처리
    for (const { keyword, items } of bidResults) {
      const list = Array.isArray(items) ? items : [items];
      for (const item of list) {
        if (!item) continue;
        const key = `${item.bidNtceNo || ''}-${item.bidNtceOrd || '000'}-bid`;
        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          if (!existing.matchedKeywords.includes(keyword)) existing.matchedKeywords.push(keyword);
        } else {
          const name = item.bidNtceNm || '';
          const isTrackA = TRACK_A_PATTERNS.some(p => name.includes(p));
          const indstCd = item.indstrytyCd || '';
          const indstNm = item.indstrytyLmtNm || '';
          const hasIndstLimit = item.indstrytyLmtYn === 'Y' || indstCd || indstNm;
          let industryStatus = 'unknown';
          if (!hasIndstLimit) industryStatus = 'no_limit';
          else if (indstCd.includes(TARGET_INDUSTRY_CODE) || indstNm.includes('실내건축')) industryStatus = 'match';
          else industryStatus = 'mismatch';
          itemMap.set(key, {
            ...item, matchedKeywords: [keyword],
            track: isTrackA ? 'A' : 'B',
            isPreSpec: false, industryStatus,
            industryCode: indstCd, industryName: indstNm
          });
        }
      }
    }

    // 사전규격 처리 - 키워드 매칭 직접 수행
    for (const { items } of preSpecResults) {
      const list = Array.isArray(items) ? items : [items];
      for (const item of list) {
        if (!item) continue;
        const name = item.prdctClsfcNoNm || item.bsnsDivNm || '';
        const client = item.rlDminsttNm || item.orderInsttNm || item.dminsttNm || '';
        const searchText = name + ' ' + client;
        const matchedKw = KEYWORDS.filter(kw => searchText.includes(kw));
        if (matchedKw.length === 0) continue;

        const key = `${item.bfSpecRgstNo || ''}-pre`;
        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          for (const kw of matchedKw) {
            if (!existing.matchedKeywords.includes(kw)) existing.matchedKeywords.push(kw);
          }
        } else {
          itemMap.set(key, {
            ...item,
            bidNtceNo: item.bfSpecRgstNo || '',
            bidNtceNm: name,
            dminsttNm: client,
            presmptPrce: item.asignBdgtAmt || '0',
            bidClseDt: item.opnRgstClseDt || '',
            bidNtceDt: item.rgstDt || '',
            matchedKeywords: matchedKw,
            track: 'P',
            isPreSpec: true,
            industryStatus: 'unknown',
            industryCode: '',
            industryName: ''
          });
        }
      }
    }
    const allItems = Array.from(itemMap.values());
    allItems.sort((a, b) => {
      const aDate = a.bidClseDt || a.opengDt || a.rcptDocClseDt || '9999';
      const bDate = b.bidClseDt || b.opengDt || b.rcptDocClseDt || '9999';
      return aDate.localeCompare(bDate);
    });

    const payload = {
      success: true,
      timestamp: now.toISOString(),
      totalCount: allItems.length,
      trackACount: allItems.filter(i => i.track === 'A').length,
      trackBCount: allItems.filter(i => i.track === 'B').length,
      preSpecCount: allItems.filter(i => i.track === 'P').length,
      items: allItems
    };

    await kv.set(cacheKey, { payload, cachedAt: Date.now() }, { ex: CACHE_TTL });
    return res.status(200).json({ ...payload, cached: false, cacheAge: 0 });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
