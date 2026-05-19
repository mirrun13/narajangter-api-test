import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function verifyToken(token) {
  if (!token) return false;
  const stored = await kv.get(`token:${token}`);
  return stored === 'admin';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    if (req.method === 'GET') {
      const ids = await kv.smembers('history:ids') || [];
      const items = [];
      
      for (const id of ids) {
        const item = await kv.get(`history:${id}`);
        if (item) items.push(item);
      }
      
      items.sort((a, b) => (b.participatedAt || '').localeCompare(a.participatedAt || ''));
      
      return res.status(200).json({ success: true, items });
    }
    
    if (req.method === 'POST') {
      const { token, item } = req.body || {};
      
      if (!await verifyToken(token)) {
        return res.status(401).json({ success: false, error: '관리자 권한이 필요합니다' });
      }
      
      if (!item || !item.title) {
        return res.status(400).json({ success: false, error: '공고 정보가 필요합니다' });
      }
      
      const id = item.id || `h_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const newItem = {
        id,
        bidNtceNo: item.bidNtceNo || '',
        title: item.title,
        client: item.client || '',
        budget: item.budget || '',
        deadline: item.deadline || '',
        track: item.track || 'B',
        keyword: item.keyword || '',
        url: item.url || '',
        result: item.result || 'pending',
        memo: item.memo || '',
        attachmentUrl: item.attachmentUrl || '',
        attachmentName: item.attachmentName || '',
        participatedAt: item.participatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await kv.set(`history:${id}`, newItem);
      await kv.sadd('history:ids', id);
      
      return res.status(200).json({ success: true, item: newItem });
    }
    
    if (req.method === 'PUT') {
      const { token, id, updates } = req.body || {};
      
      if (!await verifyToken(token)) {
        return res.status(401).json({ success: false, error: '관리자 권한이 필요합니다' });
      }
      
      const existing = await kv.get(`history:${id}`);
      if (!existing) {
        return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다' });
      }
      
      const updated = {
        ...existing,
        ...updates,
        id,
        updatedAt: new Date().toISOString()
      };
      
      await kv.set(`history:${id}`, updated);
      return res.status(200).json({ success: true, item: updated });
    }
    
    if (req.method === 'DELETE') {
      const { token, id } = req.body || {};
      
      if (!await verifyToken(token)) {
        return res.status(401).json({ success: false, error: '관리자 권한이 필요합니다' });
      }
      
      await kv.del(`history:${id}`);
      await kv.srem('history:ids', id);
      
      return res.status(200).json({ success: true });
    }
    
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message });
  }
}
