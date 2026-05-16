export default async function handler(req, res) {
  const API_KEY = "183930463902db8616a702c3c3c875687e7f85b717d1ac6352473b3b9d390f5f";
  
  const now = new Date();
  const past = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  
  const bgnDt = fmt(past) + "0000";
  const endDt = fmt(now) + "2359";
  
  const keyword = "전시";
  
  // /ad/ 포함된 HTTPS 엔드포인트
  const url = `https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch?` +
    `ServiceKey=${API_KEY}` +
    `&type=json` +
    `&inqryDiv=1` +
    `&inqryBgnDt=${bgnDt}` +
    `&inqryEndDt=${endDt}` +
    `&pageNo=1` +
    `&numOfRows=10` +
    `&bidNtceNm=${encodeURIComponent(keyword)}`;
  
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    // JSON 파싱 시도
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { rawText: text };
    }
    
    res.status(200).json({
      success: true,
      requestUrl: url,
      response: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      requestUrl: url
    });
  }
}
