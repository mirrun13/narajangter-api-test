export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";

  // 검색 조건 없이 가장 최근 데이터 1건을 요청합니다.
  const url = `https://apis.data.go.kr/1230000/BfSpecPublicInfoService/getBfSpecListInfo?ServiceKey=${API_KEY}&type=json&numOfRows=1&pageNo=1`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    // API에서 받은 응답을 '가공 없이' 그대로 보여줍니다.
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "코드 오류: " + e.message });
  }
}
