import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const { password, token, oldPassword, newPassword } = req.body || {};

  try {
    const ADMIN_PW = await kv.get('admin_pw') || 'mir19790805';
    const GUEST_PW = await kv.get('guest_pw') || 'some2026';

    // 1. 대시보드 최초 입장 로직 (에러 발생 원인 해결!)
    if (action === 'check-access') {
      if (password === ADMIN_PW) {
        const newToken = 'admin_' + Math.random().toString(36).substr(2, 9);
        await kv.set(`session_${newToken}`, 'admin', { ex: 86400 });
        return res.status(200).json({ success: true, access: 'admin', token: newToken });
      }
      if (password === GUEST_PW) {
        return res.status(200).json({ success: true, access: 'guest' });
      }
      return res.status(401).json({ success: false, error: '비밀번호가 일치하지 않습니다.' });
    }

    // 2. 우측 상단 관리자 로그인 로직
    if (action === 'login') {
      if (password === ADMIN_PW) {
        const newToken = 'admin_' + Math.random().toString(36).substr(2, 9);
        await kv.set(`session_${newToken}`, 'admin', { ex: 86400 });
        return res.status(200).json({ success: true, token: newToken });
      }
      return res.status(401).json({ success: false, error: '비밀번호가 일치하지 않습니다.' });
    }

    // 3. 관리자 권한 검증
    if (action === 'verify') {
      const role = await kv.get(`session_${token}`);
      if (role === 'admin') return res.status(200).json({ success: true, isAdmin: true });
      return res.status(401).json({ success: false, isAdmin: false });
    }

    // 4. 로그아웃
    if (action === 'logout') {
      if (token) await kv.del(`session_${token}`);
      return res.status(200).json({ success: true });
    }

    // 5. 관리자 암호 변경
    if (action === 'change-password') {
      const role = await kv.get(`session_${token}`);
      if (role !== 'admin') return res.status(401).json({ success: false, error: '권한이 없습니다.' });
      if (oldPassword !== ADMIN_PW) return res.status(401).json({ success: false, error: '현재 비밀번호가 일치하지 않습니다.' });
      await kv.set('admin_pw', newPassword);
      return res.status(200).json({ success: true, message: '관리자 비밀번호가 변경되었습니다.' });
    }

    // 6. 직원 입장 암호 변경
    if (action === 'change-guest-password') {
      const role = await kv.get(`session_${token}`);
      if (role !== 'admin') return res.status(401).json({ success: false, error: '권한이 없습니다.' });
      await kv.set('guest_pw', newPassword);
      return res.status(200).json({ success: true, message: '직원용 비밀번호가 일괄 변경되었습니다.' });
    }

    return res.status(400).json({ success: false, error: '잘못된 요청입니다.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
