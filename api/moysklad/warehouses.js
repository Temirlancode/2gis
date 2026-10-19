// Server-only Vercel Function. Never expose MOYSKLAD_TOKEN in browser code.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const setupKey = process.env.ADMIN_SETUP_KEY;
  if (!setupKey) return res.status(503).json({ error: 'ADMIN_SETUP_KEY is not configured' });
  if (req.headers.authorization !== `Bearer ${setupKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = process.env.MOYSKLAD_TOKEN;
  if (!token) return res.status(503).json({ error: 'MOYSKLAD_TOKEN is not configured' });
  try {
    const upstream = await fetch('https://api.moysklad.ru/api/remap/1.2/entity/store?limit=100', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) return res.status(502).json({ error: 'MoySklad request failed', status: upstream.status });
    const body = await upstream.json();
    return res.status(200).json({
      warehouses: (body.rows || []).map(s => ({
        id: s.id, name: s.name, archived: !!s.archived
      })),
      hasMore: !!body.meta && body.meta.size > (body.rows || []).length
    });
  } catch {
    return res.status(502).json({ error: 'MoySklad temporarily unavailable' });
  }
}
