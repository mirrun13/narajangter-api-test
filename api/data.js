import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";

  // 1. 날짜 설정 (오늘부터 한 달 전까지)
  const today = new Date();
  const oneMonthAgo = new Date();
  oneMonthAgo.setDate(today.getDate() - 30);
  
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const bgn = fmt(oneMonthAgo);
  const end = fmt(today);

  // 2. 핵심 API 호출 (서울 관련 사전규격)
  const url = `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?ServiceKey=${API_KEY}&type=json&inqryDiv=1&inqryBgnDt=${bgn}0000&inqryEndDt=${end}2359&numOfRows=100&bfSpecRgstNm=${encodeURIComponent('서울')}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // 3. 데이터가 있으면 보내고, 없으면 빈 배열이라도 보냄 (에러 방지)
    const items = data?.response?.body?.items || [];
    
    res.status(200).json({ 
      success: true, 
      items: items.map(item => ({
        ...item,
        bidNtceNo: item.bfSpecRgstNo,
        bidNtceNm: item.bfSpecRgstNm,
        track: 'P'
      }))
    });
  } catch (e) {
    // 4. 에러가 나도 죽지 않음
    res.status(200).json({ success: true, items: [], error: e.message });
  }
}
