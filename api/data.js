import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";

  const KEYWORDS = [
    "전시", "홍보관", "과학관", "체험", "박물관", "행사", "홍보", "인테리어", "디자인", "공간", "서울",
    "미술관", "갤러리", "기념관", "아트센터", "문화관", "교육관", "문화재", "관광",
    "미디어아트", "실감콘텐츠", "VR", "AR", "메타버스",
    "리뉴얼", "리모델링", "개보수", "구축"
  ];

  const TRACK_A_PATTERNS = ['협상', '기술제안', '제안서', '2단계', '설계공모'];
  const TARGET_INDUSTRY_CODE = "4990";
  const CACHE_TTL = 86400;
  const forceRefresh = req.query.refresh === 'true';

  const BID_NUM_OF_ROWS     = 100;
  const PRESPEC_NUM_OF_ROWS = 200;
  const BID_MAX_PAGES       = 5;
  const PRESPEC_MAX_PAGES   = 5;
  const CHUNK_SIZE          = 7;
  const SEARCH_DAYS         = 90;
  const CACHE_KEY           = 'bid_data_v7_2';

  let apiSuccessCount = 0;
  let apiErrorCount = 0;

  try {
    if (!forceRefresh) {
      const cached = await kv.get(CACHE_KEY);
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
    const half = SEARCH_DAYS / 2;
    const dayHalf = new Date(now.getTime() - half * 24 * 60 * 60 * 1000);
    const dayFull = new Date(now.getTime() - SEARCH_DAYS * 24 * 60 * 60 * 1000);

    const ranges = [
      { bgn: fmt(dayHalf) + "0000", end: fmt(now) + "2359" },
      { bgn: fmt(dayFull) + "0000", end: fmt(dayHalf) + "2359" }
    ];

    const buildBidUrl = (keyword, range, pageNo) =>
      `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=${pageNo}&numOfRows=${BID_NUM_OF_ROWS}&bidNtceNm=${encodeURIComponent(keyword)}`;

    const buildPreSpecServcUrl = (range, pageNo) =>
      `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=${pageNo}&numOfRows=${PRESPEC_NUM_OF_ROWS}`;

    const buildPreSpecCnstwkUrl = (range, pageNo) =>
      `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoCnstwk?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=${pageNo}&numOfRows=${PRESPEC_NUM_OF_ROWS}`;

    async function processInChunks(taskFns, chunkSize) {
      const results = [];
      for (let i = 0; i < taskFns.length; i += chunkSize) {
        const chunk = taskFns.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(fn => fn()));
        results.push(...chunkResults);
      }
      return results;
    }

    async function fetchAllPages(urlBuilder, urlArgs, maxPages, numRows) {
      const collected = [];
      for (let page = 1; page <= maxPages; page++) {
        try {
          const url = urlBuilder(...urlArgs, page);
          const r = await fetch(url);
          const data = await r.json();
          const items = data?.response?.body?.items;
          const totalCount = parseInt(data?.response?.body?.totalCount || '0', 10);

          if (!items) { apiErrorCount++; break; }
          const list = Array.isArray(items) ? items : [items];
          if (list.length === 0) break;

          apiSuccessCount++;
          collected.push(...list);

          if (collected.length >= totalCount) break;
          if (list.length < numRows) break;
        } catch (err) {
          apiErrorCount++;
          break;
        }
      }
      return collected;
    }

    const bidTaskFns = [];
    for (const keyword of KEYWORDS) {
      for (const range of ranges) {
        bidTaskFns.push(() =>
          fetchAllPages(buildBidUrl, [keyword, range], BID_MAX_PAGES, BID_NUM_OF_ROWS)
            .then(items => ({ keyword, items }))
            .catch(() => ({ keyword, items: [] }))
        );
      }
    }

    const preSpecTaskFns = [];
    for (const range of ranges) {
      preSpecTaskFns.push(() =>
        fetchAllPages(buildPreSpecServcUrl, [range], PRESPEC_MAX_PAGES, PRESPEC_NUM_OF_ROWS)
          .then(items => ({ items }))
          .catch(() => ({ items: [] }))
      );
      preSpecTaskFns.push(() =>
        fetchAllPages(buildPreSpecCnstwkUrl, [range], PRESPEC_MAX_PAGES, PRESPEC_NUM_OF_ROWS)
          .then(items => ({ items }))
          .catch(() => ({ items: [] }))
      );
    }

    const [bidResults, preSpecResults] = await Promise.all([
      processInChunks(bidTaskFns, CHUNK_SIZE),
      processInChunks(preSpecTaskFns, CHUNK_SIZE)
    ]);

    const itemMap = new Map();

    for (const { keyword, items } of bidResults) {
      for (const item of items) {
        if (!item) continue;
        const key = `${item.bidNtceNo || ''}-${item.bidNtceOrd || '000'}-bid`;

        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          if (!existing.matchedKeywords.includes(keyword)) existing.matchedKeywords.push(keyword);
          continue;
        }

        const name         = item.bidNtceNm || '';
        const sucsfbidMthd = item.sucsfbidMthdNm || '';
        const techRate     = item.techAbltEvlRt || '';
        const indstCd      = item.indstrytyCd || '';
        const indstNm      = item.indstrytyLmtNm || '';

        const isTrackA =
          (techRate && techRate !== '0') ||
          sucsfbidMthd.includes('제안') ||
          sucsfbidMthd.includes('협상') ||
          TRACK_A_PATTERNS.some(p => name.includes(p));

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
          matchedKeywords: [keyword],
          track: isTrackA ? 'A' : 'B',
          isPreSpec: false,
          industryStatus,
          industryCode: indstCd,
          industryName: indstNm
        });
      }
    }

    for (const [, item] of itemMap) {
      const searchText = [
        item.bidNtceNm || '',
        item.dminsttNm || '',
        item.ntceInsttNm || '',
        item.indstrytyLmtNm || ''
      ].join(' ');
      for (const kw of KEYWORDS) {
        if (searchText.includes(kw) && !item.matchedKeywords.includes(kw)) {
          item.matchedKeywords.push(kw);
        }
      }
    }

    for (const { items } of preSpecResults) {
      for (const item of items) {
        if (!item) continue;
        const name   = item.prdctClsfcNoNm || '';
        const client = item.rlDminsttNm || item.dminsttNm || '';
        const searchText = name + ' ' + client;
        const matchedKw = KEYWORDS.filter(kw => searchText.includes(kw));
        if (matchedKw.length === 0) continue;

        const key = `${item.bfSpecRgstNo || ''}-pre`;
        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          for (const kw of matchedKw) {
            if (!existing.matchedKeywords.includes(kw)) existing.matchedKeywords.push(kw);
          }
          continue;
        }

        itemMap.set(key, {
          ...item,
          bidNtceNo: item.bfSpecRgstNo || '',
          bidNtceNm: name,
          dminsttNm: client,
          presmptPrce: item.asignBdgtAmt || '0',
          bidClseDt: item.opninRgstClseDt || item.rcptDt || '',
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

    const allItems = Array.from(itemMap.values());
    allItems.sort((a, b) => {
      const aDate = a.bidClseDt || a.opengDt || '9999';
      const bDate = b.bidClseDt || b.opengDt || '9999';
      return aDate.localeCompare(bDate);
    });

    const payload = {
      success: true,
      timestamp: now.toISOString(),
      totalCount: allItems.length,
      trackACount: allItems.filter(i => i.track === 'A').length,
      trackBCount: allItems.filter(i => i.track === 'B').length,
      preSpecCount: allItems.filter(i => i.track === 'P').length,
      searchDays: SEARCH_DAYS,
      keywordCount: KEYWORDS.length,
      debug: {
        apiSuccessCount,
        apiErrorCount,
        bidNumOfRows: BID_NUM_OF_ROWS,
        bidMaxPages: BID_MAX_PAGES,
        chunkSize: CHUNK_SIZE,
        version: 'v7.2'
      },
      items: allItems
    };

    await kv.set(CACHE_KEY, { payload, cachedAt: Date.now() }, { ex: CACHE_TTL });

    return res.status(200).json({ ...payload, cached: false, cacheAge: 0 });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      debug: { apiSuccessCount, apiErrorCount }
    });
  }
}
