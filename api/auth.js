import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const { password, token, newPassword } = req.body || {};

  try {
    // 중앙 서버에서 최신 암호 가져오기 (기본값 설정)
    let adminPw = await kv.get('admin_pw') || 'mir19790805';
    let guestPw = await kv.get('guest_pw') || 'some2026';

    // 1. 로그인 요청 처리
    if (action === 'check-access' || action === 'login') {
      if (password === adminPw) {
        const sessionToken = 'admin_' + Math.random().toString(36).substr(2, 9);
        await kv.set(`session_${sessionToken}`, 'admin', { ex: 86400 });
        return res.status(200).json({ success: true, access: 'admin', token: sessionToken });
      }
      if (password === guestPw) {
        return res.status(200).json({ success: true, access: 'guest' });
      }
      return res.status(401).json({ success: false, error: '비밀번호가 틀렸습니다.' });
    }

    // 2. 비밀번호 변경 (관리자 전용)
    if (action === 'change-password') {
      const role = await kv.get(`session_${token}`);
      if (role !== 'admin') return res.status(401).json({ success: false, error: '권한 없음' });
      await kv.set('admin_pw', newPassword);
      return res.status(200).json({ success: true, message: '비밀번호가 변경되었습니다.' });
    }

    // 3. 상태 확인
    if (action === 'verify') {
      const role = await kv.get(`session_${token}`);
      return res.status(200).json({ success: true, isAdmin: role === 'admin' });
    }

    // 4. 로그아웃 (세션 삭제)
    if (action === 'logout') {
      await kv.del(`session_${token}`);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
