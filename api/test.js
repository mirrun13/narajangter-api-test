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
  
  const url = `http://apis.data.go.kr/1230000/BidPublicInfoService/getBidPblancListInfoServcPPSSrch?` +
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
    const data = await response.json();
    
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
