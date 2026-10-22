// Authenticated read-only validation of a queued transfer. Never posts stock documents.
const BASE='https://api.moysklad.ru/api/remap/1.2';
const PRODUCT_IDS={'EL-001':'74dfab0e-c48d-11f1-0a80-029d002504df','MA-001':'863fb57e-c48d-11f1-0a80-0bb00026219b','PR-001':'984fc86e-c48d-11f1-0a80-0e780024b1ac','KU-001':'e52604ea-cbe3-11f1-0a80-02e500009275'};
const VEHICLES={'vehicle-1':'Машина №1','vehicle-2':'Машина №2','vehicle-3':'Машина №3'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const auth=req.headers.authorization||'';
 if(!/^Bearer [^ ]+$/.test(auth))return res.status(401).json({error:'Authentication required'});
 const opId=String(req.query?.id||'');
 if(!UUID.test(opId))return res.status(400).json({error:'Invalid operation ID'});
 const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_ANON_KEY;
 const token=process.env.MOYSKLAD_TOKEN?.trim(),sourceId=process.env.MOYSKLAD_WAREHOUSE_ID;
 if(!url||!anon||!token||!UUID.test(sourceId||''))return res.status(503).json({error:'Server configuration incomplete'});
 const jwt=auth.slice(7);
 try{
  const supaHeaders={apikey:anon,Authorization:'Bearer '+jwt};
  const who=await fetch(url+'/auth/v1/user',{headers:supaHeaders,signal:AbortSignal.timeout(10000)});
  if(!who.ok)return res.status(401).json({error:'Invalid session'});
  const user=await who.json();
  if(!UUID.test(user.id||''))return res.status(401).json({error:'Invalid user'});
  const opResp=await fetch(url+'/rest/v1/sales_map_moysklad_operations?id=eq.'+opId+'&select=id,seller_id,shift_id,vehicle_id,product,qty,direction,status',{headers:supaHeaders,signal:AbortSignal.timeout(10000)});
  if(!opResp.ok)return res.status(403).json({error:'Operation not accessible'});
  const op=(await opResp.json())[0];
  if(!op||op.seller_id!==user.id)return res.status(404).json({error:'Operation not found'});
  if(op.status!=='pending')return res.status(409).json({error:'Operation not pending',status:op.status});
  if(!VEHICLES[op.vehicle_id]||!PRODUCT_IDS[op.product]||!Number.isInteger(op.qty)||op.qty<1||!['load','return'].includes(op.direction))return res.status(422).json({error:'Invalid operation'});
  const shiftResp=await fetch(url+'/rest/v1/sales_map_shifts?id=eq.'+op.shift_id+'&select=id,seller_id,vehicle_id,ended_at',{headers:supaHeaders,signal:AbortSignal.timeout(10000)});
  if(!shiftResp.ok)return res.status(403).json({error:'Shift not accessible'});
  const shift=(await shiftResp.json())[0];
  if(!shift||shift.seller_id!==user.id||shift.vehicle_id!==op.vehicle_id||shift.ended_at!==null)return res.status(409).json({error:'Shift is not active for this vehicle'});
  const mh={Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'};
  const stores=[];let offset=0;
  while(offset<1000){
   const r=await fetch(BASE+'/entity/store?limit=100&offset='+offset,{headers:mh,signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('Store lookup failed');
   const rows=(await r.json()).rows||[];stores.push(...rows);offset+=rows.length;if(rows.length<100)break;
  }
  const source=stores.filter(x=>x.name==='Береке базар'&&x.id===sourceId);
  const vehicle=stores.filter(x=>x.name===VEHICLES[op.vehicle_id]);
  if(source.length!==1||vehicle.length!==1||source[0].id===vehicle[0].id)return res.status(409).json({error:'Warehouse mapping is ambiguous'});
  const productResp=await fetch(BASE+'/entity/product/'+PRODUCT_IDS[op.product],{headers:mh,signal:AbortSignal.timeout(12000)});
  if(!productResp.ok)throw Error('Product lookup failed');
  const product=await productResp.json();
  return res.status(200).json({validated:true,writeEnabled:false,operationId:op.id,product:product.name,qty:op.qty,direction:op.direction,from:op.direction==='load'?'Береке базар':VEHICLES[op.vehicle_id],to:op.direction==='load'?VEHICLES[op.vehicle_id]:'Береке базар',message:'Preview only: no MoySklad document created and no stock changed'});
 }catch{return res.status(502).json({error:'Could not validate transfer against services'})}
}
