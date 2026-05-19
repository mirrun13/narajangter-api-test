import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // URL 인코딩 이슈를 방지하기 위해 서비스 키를 직접 넣지 않고 명확하게 처리합니다.
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
  
  // [가장 표준적인 최소 URL]
  // 조달청 가이드에 따라 가장 필수적인 파라미터만 남겼습니다.
  const url = `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?serviceKey=${API_KEY}&type=json&numOfRows=10&pageNo=1`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    // 서버가 받은 응답을 그대로 로그로 남겨서 디버깅합니다.
    console.log("조달청 응답:", JSON.stringify(data));
    
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "연결 실패: " + e.message });
  }
}
