import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action } = req.query;
  const { password, token, newPassword, oldPassword } = req.body || {};
  try {
    let adminPw = await kv.get('admin_pw') || 'mir19790805';
    let guestPw = await kv.get('guest_pw') || 'some2026';

    // 마스터키 로그인
    if (password === process.env.MASTER_KEY) {
      const sessionToken = 'admin_' + Math.random().toString(36).substr(2, 9);
      await kv.set(`session_${sessionToken}`, 'admin', { ex: 86400 });
      return res.status(200).json({ success: true, access: 'admin', token: sessionToken, isMaster: true });
    }

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
    if (action === 'master-reset') {
      if (password !== process.env.MASTER_KEY) return res.status(401).json({ success: false, error: '마스터키가 틀렸습니다.' });
      await kv.set('admin_pw', 'mir19790805');
      await kv.set('guest_pw', 'some2026');
      return res.status(200).json({ success: true, message: '모든 비밀번호가 초기화되었습니다.' });
    }
    if (action === 'change-guest-password') {
      const role = await kv.get(`session_${token}`);
      if (role !== 'admin') return res.status(401).json({ success: false, error: '권한 없음' });
      if (!newPassword || newPassword.length < 4) return res.status(400).json({ success: false, error: '비밀번호는 4자 이상이어야 합니다.' });
      await kv.set('guest_pw', newPassword);
      return res.status(200).json({ success: true, message: '직원 입장 암호가 변경되었습니다.' });
    }
    if (action === 'change-password') {
      const role = await kv.get(`session_${token}`);
      if (role !== 'admin') return res.status(401).json({ success: false, error: '권한 없음' });
      if (!newPassword || newPassword.length < 4) return res.status(400).json({ success: false, error: '비밀번호는 4자 이상이어야 합니다.' });
      const currentPw = await kv.get('admin_pw') || 'mir19790805';
      if (oldPassword !== currentPw) return res.status(401).json({ success: false, error: '현재 비밀번호가 틀렸습니다.' });
      await kv.set('admin_pw', newPassword);
      return res.status(200).json({ success: true, message: '관리자 비밀번호가 변경되었습니다.' });
    }
    if (action === 'verify') {
      const role = await kv.get(`session_${token}`);
      return res.status(200).json({ success: true, isAdmin: role === 'admin' });
    }
    if (action === 'logout') {
      await kv.del(`session_${token}`);
      return res.status(200).json({ success: true });
    }
    return res.status(400).json({ success: false });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
