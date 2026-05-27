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
  const TRACK_A_PATTERNS = ['협상','기술제안','제안서','2단계','설계공모'];
  const TARGET_INDUSTRY_CODE = "4990";
  const CACHE_TTL = 86400;
  const CHUNK_SIZE = 200;          // 한 번에 200개씩 동시 호출
  const MAX_RETRIES = 1;            // 실패 시 최대 1번 재시도
  const forceRefresh = req.query.refresh === 'true';

  try {
    const cacheKey = 'bid_data_v16';
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

    // 재시도 fetch 함수
    const fetchWithRetry = async (url, retries = MAX_RETRIES) => {
      for (let i = 0; i <= retries; i++) {
        try {
          const r = await fetch(url);
          const data = await r.json();
          return data;
        } catch (err) {
          if (i === retries) return null;
          await new Promise(r => setTimeout(r, 200 * (i + 1))); // 점차 길어지는 대기
        }
      }
      return null;
    };

    // 청크 단위로 순차 실행
    const runInChunks = async (tasks, chunkSize) => {
      const results = [];
      for (let i = 0; i < tasks.length; i += chunkSize) {
        const chunk = tasks.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(t => t()));
        results.push(...chunkResults);
      }
      return results;
    };

    const now = new Date();

    // 입찰공고: 10일×12구간 = 120일
    const bidRanges = [];
    for (let i = 0; i < 12; i++) {
      const start = new Date(now.getTime() - (i + 1) * 10 * 24 * 60 * 60 * 1000);
      const end = new Date(now.getTime() - i * 10 * 24 * 60 * 60 * 1000);
      bidRanges.push({
        bgn: fmt(start) + "0000",
        end: fmt(end) + "2359"
      });
    }

    // 사전규격: 1일×60구간 = 60일
    const preSpecRanges = [];
    for (let i = 0; i < 60; i++) {
      const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      preSpecRanges.push({
        bgn: fmt(day) + "0000",
        end: fmt(day) + "2359"
      });
    }

    const buildBidPPSSrchUrl = (keyword, range) =>
      `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=1&numOfRows=100&bidNtceNm=${encodeURIComponent(keyword)}`;

    const buildBidServcUrl = (range, pageNo) =>
      `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServc?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=${pageNo}&numOfRows=500`;

    const buildBidCnstwkUrl = (range, pageNo) =>
      `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=${pageNo}&numOfRows=500`;

    const buildPreSpecServcUrl = (range) =>
      `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=1&numOfRows=500`;

    const buildPreSpecCnstwkUrl = (range) =>
      `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoCnstwk?` +
      `ServiceKey=${API_KEY}&type=json&inqryDiv=1` +
      `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
      `&pageNo=1&numOfRows=500`;

    // 작업 준비 (함수로 래핑해서 청크 실행 시점에 호출되도록)
    const ppsTasks = [];
    for (const keyword of KEYWORDS) {
      for (const range of bidRanges) {
        ppsTasks.push(async () => {
          const data = await fetchWithRetry(buildBidPPSSrchUrl(keyword, range));
          return { keyword, items: data?.response?.body?.items || [] };
        });
      }
    }

    const fullScanTasks = [];
    for (const range of bidRanges) {
      for (let page = 1; page <= 10; page++) {
        fullScanTasks.push(async () => {
          const data = await fetchWithRetry(buildBidServcUrl(range, page));
          return { items: data?.response?.body?.items || [] };
        });
        fullScanTasks.push(async () => {
          const data = await fetchWithRetry(buildBidCnstwkUrl(range, page));
          return { items: data?.response?.body?.items || [] };
        });
      }
    }

    const preSpecTasks = [];
    for (const range of preSpecRanges) {
      preSpecTasks.push(async () => {
        const data = await fetchWithRetry(buildPreSpecServcUrl(range));
        return { items: data?.response?.body?.items || [] };
      });
      preSpecTasks.push(async () => {
        const data = await fetchWithRetry(buildPreSpecCnstwkUrl(range));
        return { items: data?.response?.body?.items || [] };
      });
    }

    // 청크로 순차 실행
    const [ppsResults, fullResults, preSpecResults] = await Promise.all([
      runInChunks(ppsTasks, CHUNK_SIZE),
      runInChunks(fullScanTasks, CHUNK_SIZE),
      runInChunks(preSpecTasks, CHUNK_SIZE)
    ]);

    const itemMap = new Map();

    function makeBidEntry(item, keywords) {
      const name = item.bidNtceNm || '';
      const sucsfbidMthd = item.sucsfbidMthdNm || '';
      const techRate = item.techAbltEvlRt || '';
      const isTrackA =
        (techRate && techRate !== '0') ||
        sucsfbidMthd.includes('제안') ||
        sucsfbidMthd.includes('협상') ||
        TRACK_A_PATTERNS.some(p => name.includes(p));
      const indstCd = item.indstrytyCd || '';
      const indstNm = item.indstrytyLmtNm || '';
      const hasIndstLimit = item.indstrytyLmtYn === 'Y' || indstCd || indstNm;
      let industryStatus = 'unknown';
      if (!hasIndstLimit) industryStatus = 'no_limit';
      else if (indstCd.includes(TARGET_INDUSTRY_CODE) || indstNm.includes('실내건축')) industryStatus = 'match';
      else industryStatus = 'mismatch';

      return {
        bidNtceNo: item.bidNtceNo || '',
        bidNtceOrd: item.bidNtceOrd || '',
        bidNtceNm: name,
        bidNtceDt: item.bidNtceDt || '',
        bidClseDt: item.bidClseDt || '',
        opengDt: item.opengDt || '',
        ntceKindNm: item.ntceKindNm || '',
        ntceInsttNm: item.ntceInsttNm || '',
        dminsttNm: item.dminsttNm || '',
        presmptPrce: item.presmptPrce || '0',
        asignBdgtAmt: item.asignBdgtAmt || '0',
        bidNtceUrl: item.bidNtceUrl || item.bidNtceDtlUrl || '',
        sucsfbidMthdNm: sucsfbidMthd,
        techAbltEvlRt: techRate,
        bidPrtcptLmtYn: item.bidPrtcptLmtYn || 'N',
        jntcontrctDutyRgnNm1: item.jntcontrctDutyRgnNm1 || '',
        cntrctCnclsMthdNm: item.cntrctCnclsMthdNm || '',
        refNo: item.refNo || '',
        matchedKeywords: keywords,
        track: isTrackA ? 'A' : 'B',
        isPreSpec: false,
        industryStatus,
        industryCode: indstCd,
        industryName: indstNm
      };
    }

    for (const { keyword, items } of ppsResults) {
      const list = Array.isArray(items) ? items : [items];
      for (const item of list) {
        if (!item) continue;
        const key = `${item.bidNtceNo || ''}-${item.bidNtceOrd || '000'}-bid`;
       if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          if (!existing.matchedKeywords.includes(keyword) && existing.matchedKeywords.length < 3) {
            existing.matchedKeywords.push(keyword);
          }
        } else {
          itemMap.set(key, makeBidEntry(item, [keyword]));
        }
      }
    }

    for (const { items } of fullResults) {
      const list = Array.isArray(items) ? items : [items];
      for (const item of list) {
        if (!item) continue;
        const name = item.bidNtceNm || '';
       const matchedKw = KEYWORDS.filter(kw => searchText.includes(kw)).slice(0, 3);
        if (matchedKw.length === 0) continue;
        const key = `${item.bfSpecRgstNo || ''}-pre`;
        if (itemMap.has(key)) {
          const existing = itemMap.get(key);
          for (const kw of matchedKw) {
            if (!existing.matchedKeywords.includes(kw) && existing.matchedKeywords.length < 3) {
              existing.matchedKeywords.push(kw);
            }
          }
        }
        } else {
          itemMap.set(key, makeBidEntry(item, matchedKw));
        }
      }
    }

    for (const { items } of preSpecResults) {
      const list = Array.isArray(items) ? items : [items];
      for (const item of list) {
        if (!item) continue;
        const name = item.prdctClsfcNoNm || '';
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
        } else {
          itemMap.set(key, {
            bidNtceNo: item.bfSpecRgstNo || '',
            bidNtceOrd: '',
            bidNtceNm: name,
            bidNtceDt: item.rgstDt || '',
            bidClseDt: item.opninRgstClseDt || item.rcptDt || '',
            opengDt: '',
            ntceKindNm: '사전규격',
            ntceInsttNm: item.dminsttNm || '',
            dminsttNm: client,
            presmptPrce: item.asignBdgtAmt || '0',
            asignBdgtAmt: item.asignBdgtAmt || '0',
            bidNtceUrl: item.specDocFileUrl1 || '',
            sucsfbidMthdNm: '',
            techAbltEvlRt: '',
            bidPrtcptLmtYn: 'N',
            jntcontrctDutyRgnNm1: '',
            cntrctCnclsMthdNm: '',
            refNo: '',
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
      items: allItems
    };

    await kv.set(cacheKey, { payload, cachedAt: Date.now() }, { ex: CACHE_TTL });
    return res.status(200).json({ ...payload, cached: false, cacheAge: 0 });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
