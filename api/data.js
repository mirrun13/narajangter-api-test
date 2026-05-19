import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";

  // 검색 조건 싹 다 삭제 (가장 최근 100건을 무조건 가져옵니다)
  const url = `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?ServiceKey=${API_KEY}&type=json&numOfRows=100&pageNo=1`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    // 데이터를 못 가져와도 에러를 내지 않고 빈 배열이라도 전달 (대시보드 먹통 방지)
    const items = data?.response?.body?.items || [];
    
    res.status(200).json({ 
      success: true, 
      items: items.map(item => ({
        ...item,
        bidNtceNo: item.bfSpecRgstNo || '000',
        bidNtceNm: item.bfSpecRgstNm || '제목없음',
        track: 'P' // 사전규격 표시
      }))
    });
  } catch (e) {
    res.status(200).json({ success: true, items: [], error: "API 연결 실패" });
  }
}
