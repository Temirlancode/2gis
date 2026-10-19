// Admin-only catalog lookup; never send the MoySklad token to the browser.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const key=process.env.ADMIN_SETUP_KEY;
  if(!key) return res.status(503).json({error:'ADMIN_SETUP_KEY is not configured'});
  if(req.headers.authorization!==`Bearer ${key}`) return res.status(401).json({error:'Unauthorized'});
  const token=process.env.MOYSKLAD_TOKEN;
  if(!token) return res.status(503).json({error:'MOYSKLAD_TOKEN is not configured'});
  const offset=Number(req.query?.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000) return res.status(400).json({error:'Invalid offset'});
  try {
    const url=new URL('https://api.moysklad.ru/api/remap/1.2/entity/product');
    url.searchParams.set('limit','100');
    url.searchParams.set('offset',String(offset));
    const upstream=await fetch(url,{headers:{Authorization:`Bearer ${token.trim()}`,Accept:'application/json;charset=utf-8'},signal:AbortSignal.timeout(12000)});
    if(!upstream.ok) return res.status(502).json({error:'MoySklad catalog request failed',status:upstream.status});
    const body=await upstream.json();
    const rows=Array.isArray(body.rows)?body.rows:[];
    return res.status(200).json({products:rows.map(p=>({id:p.id,name:p.name,code:p.code||'',article:p.article||'',archived:!!p.archived})),nextOffset:offset+rows.length<(body.meta?.size??0)?offset+rows.length:null});
  } catch {return res.status(502).json({error:'MoySklad temporarily unavailable'});}
}
