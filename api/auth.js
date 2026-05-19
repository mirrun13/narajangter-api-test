import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const { password } = req.body || {};

  try {
    // 1. [긴급 조치] 암호 검사 무시하고 무조건 통과 (관리자 권한 부여)
    const sessionToken = 'admin_' + Math.random().toString(36).substr(2, 9);
    await kv.set(`session_${sessionToken}`, 'admin', { ex: 86400 });
    
    return res.status(200).json({ 
      success: true, 
      access: 'admin', 
      token: sessionToken,
      message: "긴급 모드: 무조건 로그인 성공" 
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
