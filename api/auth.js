import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // ... (헤더 설정 동일)
  const { action } = req.query;
  const { password, token, newPassword } = req.body || {};

  try {
    // 중앙 DB에서 항상 최신 암호를 읽어옵니다 (모든 PC 동기화의 핵심!)
    let adminPw = await kv.get('admin_pw') || 'mir19790805';
    let guestPw = await kv.get('guest_pw') || 'some2026';

    if (action === 'check-access' || action === 'login') {
      if (password === adminPw) { // 중앙 DB 암호와 비교
        const sessionToken = 'admin_' + Math.random().toString(36).substr(2, 9);
        await kv.set(`session_${sessionToken}`, 'admin', { ex: 86400 });
        return res.status(200).json({ success: true, access: 'admin', token: sessionToken });
      }
      if (password === guestPw) return res.status(200).json({ success: true, access: 'guest' });
      return res.status(401).json({ success: false, error: '비밀번호 불일치' });
    }

    if (action === 'change-password') {
      const role = await kv.get(`session_${token}`);
      if (role !== 'admin') return res.status(401).json({ success: false, error: '권한 없음' });
      
      // 중앙 DB를 업데이트하면, 그 순간부터 모든 PC는 이 새 암호로만 로그인 가능합니다!
      await kv.set('admin_pw', newPassword); 
      return res.status(200).json({ success: true, message: '모든 접속자 암호 동기화 완료' });
    }
    // ...
  } catch (error) { /* ... */ }
}
