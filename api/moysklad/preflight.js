// Read-only preflight for MoySklad vehicle warehouse integration.
// Never expose token, warehouse IDs or other credentials to the browser.
const BASE='https://api.moysklad.ru/api/remap/1.2';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=process.env.MOYSKLAD_TOKEN?.trim();
 const source=process.env.MOYSKLAD_WAREHOUSE_ID;
 // Mapping must be a server-side JSON object keyed by Supabase user UUID, with MoySklad store UUID values.
 let vehicles={};try{vehicles=JSON.parse(process.env.MOYSKLAD_VEHICLE_WAREHOUSES||'{}')}catch{return res.status(503).json({ready:false,error:'Invalid vehicle warehouse mapping JSON'})}
 if(!vehicles||Array.isArray(vehicles)||typeof vehicles!=='object'||Object.entries(vehicles).some(([k,v])=>!uuid.test(k)||!uuid.test(v)))return res.status(503).json({ready:false,error:'Invalid vehicle warehouse mapping'});
 if(!token||!uuid.test(source||''))return res.status(503).json({ready:false,error:'MoySklad connection not configured'});
 if(Object.values(vehicles).includes(source)||new Set(Object.values(vehicles)).size!==Object.values(vehicles).length)return res.status(503).json({ready:false,error:'Vehicle warehouses must be unique and distinct from main warehouse'});
 try{
  const headers={Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'};
  const ids=[source,...Object.values(vehicles)];
  const stores=await Promise.all(ids.map(async id=>{
   const r=await fetch(BASE+'/entity/store/'+id,{headers,signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('MoySklad HTTP '+r.status);
   const x=await r.json();return {id,name:x.name};
  }));
  return res.status(200).json({ready:stores.length>1,mainWarehouse:stores[0].name,vehicleWarehousesConfigured:stores.length-1,writeEnabled:false,message:'Read-only validation only. Stock mutation is disabled.'});
 }catch(e){return res.status(502).json({ready:false,error:'Cannot validate MoySklad warehouse configuration'})}
}
