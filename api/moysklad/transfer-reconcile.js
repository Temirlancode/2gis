// Read-only reconciliation of a queued transfer with MoySklad documents.
// Requires authenticated seller; does not change any operation status or stock.
const BASE='https://api.moysklad.ru/api/remap/1.2';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const id=String(req.query?.id||'');
 const authorization=req.headers.authorization||'';
 if(!UUID.test(id))return res.status(400).json({error:'Invalid operation ID'});
 if(!/^Bearer [^ ]+$/.test(authorization))return res.status(401).json({error:'Login required'});
 const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY,token=process.env.MOYSKLAD_TOKEN;
 if(!url||!anon||!token)return res.status(503).json({error:'Server not configured'});
 try{
  const h={apikey:anon,Authorization:authorization};
  const userResp=await fetch(url+'/auth/v1/user',{headers:h,signal:AbortSignal.timeout(10000)});
  if(!userResp.ok)return res.status(401).json({error:'Invalid session'});
  const user=await userResp.json();
  const opResp=await fetch(url+'/rest/v1/sales_map_moysklad_operations?id=eq.'+id+'&select=id,seller_id,status,moysklad_document_id',{headers:h,signal:AbortSignal.timeout(10000)});
  if(!opResp.ok)return res.status(403).json({error:'Operation inaccessible'});
  const op=(await opResp.json())[0];
  if(!op||op.seller_id!==user.id)return res.status(404).json({error:'Operation not found'});
  const externalCode='sales-map-transfer-'+op.id;
  const msHeaders={Authorization:'Bearer '+token.trim(),Accept:'application/json;charset=utf-8'};
  // Filter by deterministic external code; if lookup fails, report unknown,
  // NEVER infer absence and NEVER retry a potentially committed POST.
  const query=new URL(BASE+'/entity/move');
  query.searchParams.set('filter','externalCode='+externalCode);
  query.searchParams.set('limit','10');
  const r=await fetch(query,{headers:msHeaders,signal:AbortSignal.timeout(12000)});
  if(!r.ok)return res.status(502).json({error:'MoySklad lookup failed; outcome unknown'});
  const data=await r.json();
  const rows=(data.rows||[]).filter(x=>x.externalCode===externalCode);
  return res.status(200).json({
   operationId:op.id,operationStatus:op.status,externalCode,
   reconciliation:rows.length===0?'not_found':rows.length===1?'found':'ambiguous',
   documents:rows.map(x=>({id:x.id,applicable:x.applicable,externalCode:x.externalCode})),
   writeEnabled:false,
   note:'Read-only lookup. Not found is not permission to repost. Verify document positions and warehouses before confirming.'
  });
 }catch{return res.status(502).json({error:'Reconciliation unavailable; outcome unknown'})}
}
