export default async function handler(req, res) {
  // CORS 허용 (GitHub Pages에서 호출 가능하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
  const KEYWORDS = ["전시","홍보관","과학관","체험","박물관","행사","홍보","인테리어","디자인","공간"];
  const TRACK_A_PATTERNS = ['협상','기술제안','제안서','2단계','설계공모'];
  
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  
  const now = new Date();
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  
  // 30일씩 2구간 (총 60일)
  const ranges = [
    { bgn: fmt(day30) + "0000", end: fmt(now) + "2359" },
    { bgn: fmt(day60) + "0000", end: fmt(day30) + "2359" }
  ];
  
  // 모든 키워드 × 모든 구간 병렬 호출
  const tasks = [];
  for (const keyword of KEYWORDS) {
    for (const range of ranges) {
      const url = `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch?` +
        `ServiceKey=${API_KEY}` +
        `&type=json&inqryDiv=1` +
        `&inqryBgnDt=${range.bgn}&inqryEndDt=${range.end}` +
        `&pageNo=1&numOfRows=100` +
        `&bidNtceNm=${encodeURIComponent(keyword)}`;
      
      tasks.push(
        fetch(url)
          .then(r => r.json())
          .then(data => ({ 
            keyword, 
            items: data?.response?.body?.items || [] 
          }))
          .catch(err => ({ keyword, items: [], error: err.message }))
      );
    }
  }
  
  const results = await Promise.all(tasks);
  
  // 중복 제거 + 키워드 통합
  const itemMap = new Map();
  
  for (const { keyword, items } of results) {
    for (const item of items) {
      const key = `${item.bidNtceNo}-${item.bidNtceOrd}`;
      
      if (itemMap.has(key)) {
        const existing = itemMap.get(key);
        if (!existing.matchedKeywords.includes(keyword)) {
          existing.matchedKeywords.push(keyword);
        }
      } else {
        const name = item.bidNtceNm || '';
        const isTrackA = TRACK_A_PATTERNS.some(p => name.includes(p));
        
        itemMap.set(key, {
          ...item,
          matchedKeywords: [keyword],
          track: isTrackA ? 'A' : 'B'
        });
      }
    }
  }
  
  const allItems = Array.from(itemMap.values());
  
  // 마감일 가까운 순 정렬
  allItems.sort((a, b) => {
    const aDate = a.bidClseDt || '9999';
    const bDate = b.bidClseDt || '9999';
    return aDate.localeCompare(bDate);
  });
  
  res.status(200).json({
    success: true,
    timestamp: now.toISOString(),
    totalCount: allItems.length,
    trackACount: allItems.filter(i => i.track === 'A').length,
    trackBCount: allItems.filter(i => i.track === 'B').length,
    items: allItems
  });
}
