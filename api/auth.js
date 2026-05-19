import { kv } from '@vercel/kv';

const DEFAULT_ADMIN_PASSWORD = "some2026";
const DEFAULT_GUEST_PASSWORD = "some";

function generateToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
}

async function verifyToken(token) {
  if (!token) return false;
  const stored = await kv.get(`token:${token}`);
  return stored === 'admin';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { action } = req.query;
  
  try {
    // 입장 비밀번호 확인 (직원 또는 관리자)
    if (action === 'check-access') {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ success: false, error: '비밀번호를 입력하세요' });
      
      // 관리자 비밀번호 확인
      let adminPassword = await kv.get('admin_password');
      if (!adminPassword) {
        adminPassword = DEFAULT_ADMIN_PASSWORD;
        await kv.set('admin_password', DEFAULT_ADMIN_PASSWORD);
      }
      
      if (password === adminPassword) {
        const token = generateToken();
        await kv.set(`token:${token}`, 'admin', { ex: 86400 });
        return res.status(200).json({ success: true, access: 'admin', token });
      }
      
      // 직원 비밀번호 확인
      let guestPassword = await kv.get('guest_password');
      if (!guestPassword) {
        guestPassword = DEFAULT_GUEST_PASSWORD;
        await kv.set('guest_password', DEFAULT_GUEST_PASSWORD);
      }
      
      if (password === guestPassword) {
        return res.status(200).json({ success: true, access: 'guest' });
      }
      
      return res.status(401).json({ success: false, error: '비밀번호가 일치하지 않습니다' });
    }
    
    // 기존 관리자 로그인
    if (action === 'login') {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ success: false, error: '비밀번호를 입력하세요' });
      
      let storedPassword = await kv.get('admin_password');
      if (!storedPassword) {
        storedPassword = DEFAULT_ADMIN_PASSWORD;
        await kv.set('admin_password', DEFAULT_ADMIN_PASSWORD);
      }
      
      if (password !== storedPassword) {
        return res.status(401).json({ success: false, error: '비밀번호가 틀렸습니다' });
      }
      
      const token = generateToken();
      await kv.set(`token:${token}`, 'admin', { ex: 86400 });
      return res.status(200).json({ success: true, token });
    }
    
    // 관리자 비밀번호 변경
    if (action === 'change-password') {
      const { token, oldPassword, newPassword } = req.body || {};
      if (!await verifyToken(token)) return res.status(401).json({ success: false, error: '관리자 권한이 필요합니다' });
      
      const stored = await kv.get('admin_password') || DEFAULT_ADMIN_PASSWORD;
      if (oldPassword !== stored) return res.status(401).json({ success: false, error: '현재 비밀번호가 틀렸습니다' });
      
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, error: '새 비밀번호는 4자 이상이어야 합니다' });
      }
      
      await kv.set('admin_password', newPassword);
      return res.status(200).json({ success: true, message: '관리자 비밀번호가 변경되었습니다' });
    }
    
    // 직원 비밀번호 변경 (관리자만)
    if (action === 'change-guest-password') {
      const { token, newPassword } = req.body || {};
      if (!await verifyToken(token)) return res.status(401).json({ success: false, error: '관리자 권한이 필요합니다' });
      
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, error: '비밀번호는 4자 이상이어야 합니다' });
      }
      
      await kv.set('guest_password', newPassword);
      return res.status(200).json({ success: true, message: '직원 입장 비밀번호가 변경되었습니다' });
    }
    
    if (action === 'verify') {
      const { token } = req.body || {};
      const isAdmin = await verifyToken(token);
      return res.status(200).json({ success: true, isAdmin });
    }
    
    if (action === 'logout') {
      const { token } = req.body || {};
      if (token) await kv.del(`token:${token}`);
      return res.status(200).json({ success: true });
    }
    
    return res.status(400).json({ success: false, error: '잘못된 요청' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
