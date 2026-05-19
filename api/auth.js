import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const { password, token, newPassword } = req.body || {};

  try {
    // 1. 서버 중앙 DB에서 항상 최신 비밀번호를 가져옴 (PC 로컬값 무시)
    let adminPw = await kv.get('admin_pw') || 'mir19790805';
    let guestPw = await kv.get('guest_pw') || 'some2026';

    // 2. 로그인 로직
    if (action === 'check-access' || action === 'login') {
      if (password === adminPw) {
        const sessionToken = 'admin_' + Math.random().toString(36).substr(2, 9);
        await kv.set(`session_${sessionToken}`, 'admin', { ex: 86400 });
        return res.status(200).json({ success: true, access: 'admin', token: sessionToken });
      }
      if (password === guestPw) {
        return res.status(200).json({ success: true, access: 'guest' });
      }
      return res.status(401).json({ success: false, error: '비밀번호 불일치' });
    }

    // 3. 비밀번호 변경 로직 (중앙 DB만 업데이트하면 모든 PC 동기화됨)
    if (action === 'change-password') {
      const role = await kv.get(`session_${token}`);
      if (role !== 'admin') return res.status(401).json({ success: false, error: '권한 없음' });
      
      await kv.set('admin_pw', newPassword);
      return res.status(200).json({ success: true, message: '중앙 서버 암호 업데이트 완료' });
    }

    if (action === 'verify') {
      const role = await kv.get(`session_${token}`);
      return res.status(200).json({ success: true, isAdmin: role === 'admin' });
    }

    return res.status(400).json({ success: false });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
