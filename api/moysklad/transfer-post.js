// Authenticated seller/admin transfer worker. Disabled by default. Never retry uncertain outcomes.
const B='https://api.moysklad.ru/api/remap/1.2';
const P={'MA-001':'74dfab0e-c48d-11f1-0a80-029d002504df','PR-001':'863fb57e-c48d-11f1-0a80-0bb00026219b','KU-001':'984fc86e-c48d-11f1-0a80-0e780024b1ac','EL-001':'e52604ea-cbe3-11f1-0a80-02e500009275'};
const V={'vehicle-1':'Машина №1','vehicle-2':'Машина №2','vehicle-3':'Машина №3'};
const ORG='eb18e661-c477-11f1-0a80-0e7800217f3a';
const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const meta=(type,id)=>({meta:{href:B+'/entity/'+type+'/'+id,type,mediaType:'application/json'}});
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(process.env.MOYSKLAD_TRANSFER_WRITE_ENABLED!=='true')return res.status(423).json({error:'Posting disabled'});
 // Temporary single-operation allowlist: write flag alone is not enough.
 const approvedTestId='dbd87e8e-8196-495c-9447-e5e7d761daae';
 const liveEnabled=process.env.MOYSKLAD_TRANSFER_LIVE_ENABLED==='true';
 if(!liveEnabled&&process.env.MOYSKLAD_TRANSFER_TEST_OPERATION_ID!==approvedTestId)return res.status(423).json({error:'Single-operation test not armed'});
 const id=String(req.body?.id||''),jwt=String(req.headers.authorization||'');
 if(!U.test(id)||!jwt.startsWith('Bearer '))return res.status(400).json({error:'Invalid request'});
 const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY,token=process.env.MOYSKLAD_TOKEN,source=process.env.MOYSKLAD_WAREHOUSE_ID;
 if(!url||!anon||!service||!token||!U.test(source||''))return res.status(503).json({error:'Missing server configuration'});
 const uh={apikey:anon,Authorization:jwt},sh={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},mh={Authorization:'Bearer '+token.trim(),Accept:'application/json;charset=utf-8','Content-Type':'application/json'};
 const read=async(u,h)=>{const r=await fetch(u,{headers:h,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Read failed '+r.status);return r.json()};
 const rpc=async(name,body)=>{const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:sh,body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('RPC failed '+name);return r.json()};
 let claimed=false;
 try{
  const userResponse=await fetch(url.replace(/\/+$/,'')+'/auth/v1/user',{headers:uh,signal:AbortSignal.timeout(10000)});
  if(!userResponse.ok)return res.status(401).json({error:'Unauthorized'});
  const user=await userResponse.json();
  const profiles=await read(url+'/rest/v1/user_profiles?user_id=eq.'+user.id+'&select=role',uh);
  const isAdmin=profiles[0]?.role==='admin';
  if(!['admin','seller'].includes(profiles[0]?.role))return res.status(403).json({error:'Seller or admin required'});
  const rows=await read(url+'/rest/v1/sales_map_moysklad_operations?id=eq.'+id+'&select=*',sh);
  const op=rows[0];
  if(!op||op.status!=='pending'||!P[op.product]||!V[op.vehicle_id]||!Number.isInteger(op.qty)||op.qty<1||!['load','return'].includes(op.direction))return res.status(409).json({error:'Invalid pending operation'});
  if(!liveEnabled&&(op.id!==approvedTestId||op.vehicle_id!=='vehicle-1'||op.product!=='KU-001'||op.qty!==1||op.direction!=='load'))return res.status(409).json({error:'Not the approved one-unit test'});
  if(!isAdmin&&op.seller_id!==user.id)return res.status(403).json({error:'Operation belongs to another seller'});
  const shifts=await read(url+'/rest/v1/sales_map_shifts?id=eq.'+encodeURIComponent(op.shift_id)+'&select=id,seller_id,vehicle_id,ended_at',sh);
  const shift=shifts[0];
  if(!shift||shift.ended_at!==null||shift.seller_id!==op.seller_id||shift.vehicle_id!==op.vehicle_id)return res.status(409).json({error:'Operation shift is not active for vehicle'});
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
  // Read the exact source warehouse's live stock before claiming or posting.
  // Fail closed on incomplete stock reports; do not use global stock totals.
  if(op.direction==='load'){
   const stockFilter='store='+B+'/entity/store/'+source;
   let offset=0,available=null,complete=false;
   for(let pageNum=0;pageNum<10;pageNum++){
    const stockUrl=new URL(B+'/report/stock/all');
    stockUrl.searchParams.set('filter',stockFilter);
    stockUrl.searchParams.set('limit','1000');
    stockUrl.searchParams.set('offset',String(offset));
    const page=await read(stockUrl.toString(),mh);
    if(!Array.isArray(page.rows))return res.status(502).json({error:'Warehouse stock report unavailable'});
    for(const row of page.rows){
     const href=row.meta?.href||row.assortment?.meta?.href||'';
     const itemId=href.match(/\/([0-9a-f-]{36})(?:\?|$)/i)?.[1];
     if(itemId===P[op.product]){
      const value=Number(row.stock);
      if(!Number.isFinite(value))return res.status(502).json({error:'Invalid source stock'});
      available=(available??0)+value;
     }
    }
    offset+=page.rows.length;
    if(page.rows.length===0||offset>=(page.meta?.size??offset)){complete=true;break}
   }
   if(!complete)return res.status(502).json({error:'Warehouse stock report incomplete'});
   if((available??0)<op.qty)return res.status(409).json({error:'Insufficient source warehouse stock'});
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
  if(verified.id!==doc.id||verified.archived===true||verified.deleted===true||verified.externalCode!==externalCode||verified.applicable!==true||getId(verified.sourceStore)!==from||getId(verified.targetStore)!==to||positions.length!==1||getId(positions[0].assortment)!==P[op.product]||Number(positions[0].quantity)!==op.qty)
   return res.status(502).json({error:'Document verification failed; reconcile manually',operationId:id});
  // Check that the document is posted, not merely created. Only then update app stock.
  if(verified.applicable!==true)return res.status(502).json({error:'Document is not posted; reconcile manually',operationId:id});
  await rpc('sales_map_confirm_transfer',{p_operation_id:id,p_document_id:doc.id});
  return res.status(200).json({ok:true,operationId:id,documentId:doc.id});
 }catch{return res.status(502).json({error:claimed?'Outcome uncertain; reconcile manually':'Preflight failed; nothing posted by this request',operationId:id})}
}
