import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
  
  // URL을 생성하는 가장 안전한 방법입니다.
  const baseUrl = 'https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo';
  const params = new URLSearchParams({
    ServiceKey: API_KEY, // 조달청은 대소문자를 구분할 수 있으므로 표준을 따릅니다.
    type: 'json',
    numOfRows: '10',
    pageNo: '1'
  });

  const finalUrl = `${baseUrl}?${params.toString()}`;

  try {
    const response = await fetch(finalUrl);
    const data = await response.json();
    
    // 서버 응답 자체를 그대로 리턴합니다.
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "코드 오류: " + e.message });
  }
}
