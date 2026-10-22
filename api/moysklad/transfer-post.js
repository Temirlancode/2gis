// Admin-only transfer worker. Disabled by default. Never retry uncertain outcomes.
const B='https://api.moysklad.ru/api/remap/1.2';
const P={'EL-001':'74dfab0e-c48d-11f1-0a80-029d002504df','MA-001':'863fb57e-c48d-11f1-0a80-0bb00026219b','PR-001':'984fc86e-c48d-11f1-0a80-0e780024b1ac','KU-001':'e52604ea-cbe3-11f1-0a80-02e500009275'};
const V={'vehicle-1':'Машина №1','vehicle-2':'Машина №2','vehicle-3':'Машина №3'};
const ORG='eb18e661-c477-11f1-0a80-0e7800217f3a';
const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const meta=(type,id)=>({meta:{href:B+'/entity/'+type+'/'+id,type,mediaType:'application/json'}});
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(process.env.MOYSKLAD_TRANSFER_WRITE_ENABLED!=='true')return res.status(423).json({error:'Posting disabled'});
 const id=String(req.body?.id||''),jwt=String(req.headers.authorization||'');
 if(!U.test(id)||!jwt.startsWith('Bearer '))return res.status(400).json({error:'Invalid request'});
 const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY,token=process.env.MOYSKLAD_TOKEN,source=process.env.MOYSKLAD_WAREHOUSE_ID;
 if(!url||!anon||!service||!token||!U.test(source||''))return res.status(503).json({error:'Missing server configuration'});
 const uh={apikey:anon,Authorization:jwt},sh={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},mh={Authorization:'Bearer '+token.trim(),Accept:'application/json;charset=utf-8','Content-Type':'application/json'};
 const read=async(u,h)=>{const r=await fetch(u,{headers:h,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Read failed '+r.status);return r.json()};
 const rpc=async(name,body)=>{const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:sh,body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('RPC failed '+name);return r.json()};
 let claimed=false;
 try{
  const userResponse=await fetch(url+'/auth/v1/user',{headers:uh,signal:AbortSignal.timeout(10000)});
  if(!userResponse.ok)return res.status(401).json({error:'Unauthorized'});
  const user=await userResponse.json();
  const profiles=await read(url+'/rest/v1/user_profiles?user_id=eq.'+user.id+'&select=role',uh);
  if(profiles[0]?.role!=='admin')return res.status(403).json({error:'Admin only'});
  const rows=await read(url+'/rest/v1/sales_map_moysklad_operations?id=eq.'+id+'&select=*',sh);
  const op=rows[0];
  if(!op||op.status!=='pending'||!P[op.product]||!V[op.vehicle_id]||!Number.isInteger(op.qty)||op.qty<1||!['load','return'].includes(op.direction))return res.status(409).json({error:'Invalid pending operation'});
  const stores=(await read(B+'/entity/store?limit=1000',mh)).rows||[];
  const a=stores.filter(x=>x.id===source&&x.name==='Береке базар');
  const b=stores.filter(x=>x.name===V[op.vehicle_id]);
  if(a.length!==1||b.length!==1||a[0].id===b[0].id)return res.status(409).json({error:'Warehouse verification failed'});
  const org=await read(B+'/entity/organization/'+ORG,mh);
  if(org.archived)return res.status(409).json({error:'Organization archived'});
  await read(B+'/entity/product/'+P[op.product],mh);
  if(op.direction==='return'){
   const stock=await read(url+'/rest/v1/sales_map_car_stock?vehicle_id=eq.'+op.vehicle_id+'&product=eq.'+op.product+'&select=qty',sh);
   if(!stock.length||stock[0].qty<op.qty)return res.status(409).json({error:'Insufficient vehicle stock'});
  }
  const externalCode='sales-map-transfer-'+op.id;
  const q=new URL(B+'/entity/move');q.searchParams.set('filter','externalCode='+externalCode);
  const found=(await read(q.toString(),mh)).rows||[];
  if(found.length)return res.status(409).json({error:'Document exists; reconcile manually'});
  await rpc('sales_map_claim_transfer',{p_operation_id:id});claimed=true;
  const from=op.direction==='load'?a[0].id:b[0].id,to=op.direction==='load'?b[0].id:a[0].id;
  const payload={externalCode,applicable:true,organization:meta('organization',ORG),sourceStore:meta('store',from),targetStore:meta('store',to),positions:[{quantity:op.qty,assortment:meta('product',P[op.product])}]};
  const posted=await fetch(B+'/entity/move',{method:'POST',headers:mh,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  if(!posted.ok)return res.status(502).json({error:'Posting result uncertain; manual reconciliation required',operationId:id});
  const doc=await posted.json();
  if(!U.test(doc.id||''))return res.status(502).json({error:'Missing document ID; reconcile manually'});
  const verified=await read(B+'/entity/move/'+doc.id+'?expand=positions',mh);
  const getId=x=>x?.meta?.href?.match(/\/([0-9a-f-]{36})(?:\?|$)/i)?.[1];
  const positions=verified.positions?.rows||[];
  if(verified.externalCode!==externalCode||verified.applicable!==true||getId(verified.sourceStore)!==from||getId(verified.targetStore)!==to||positions.length!==1||getId(positions[0].assortment)!==P[op.product]||Number(positions[0].quantity)!==op.qty)
   return res.status(502).json({error:'Document verification failed; reconcile manually',operationId:id});
  await rpc('sales_map_confirm_transfer',{p_operation_id:id,p_document_id:doc.id});
  return res.status(200).json({ok:true,operationId:id,documentId:doc.id});
 }catch{return res.status(502).json({error:claimed?'Outcome uncertain; reconcile manually':'Preflight failed; nothing posted by this request',operationId:id})}
}
