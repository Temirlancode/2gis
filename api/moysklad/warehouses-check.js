// Safe read-only discovery of warehouse names. No credentials or IDs returned.
const BASE='https://api.moysklad.ru/api/remap/1.2';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=process.env.MOYSKLAD_TOKEN?.trim();
 if(!token)return res.status(503).json({error:'MOYSKLAD_TOKEN is not configured'});
 try{
  const r=await fetch(BASE+'/entity/store?limit=100',{headers:{Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('MoySklad HTTP '+r.status);
  const body=await r.json();
  const required=['Береке базар','Машина №1','Машина №2','Машина №3'];
  const rows=body.rows||[];
  const found=required.map(name=>({name,found:rows.some(s=>s.name===name)}));
  const selected=rows.find(s=>s.name==='Береке базар');
  const configured=(process.env.MOYSKLAD_WAREHOUSE_ID||'').toLowerCase();
  return res.status(200).json({warehouses:found,sourceWarehouseMatches:!!selected&&selected.id?.toLowerCase()===configured,allFound:found.every(x=>x.found),writeEnabled:false,notice:'No inventory changes. Main warehouse in another city is excluded.'});
 }catch{return res.status(502).json({error:'Could not verify MoySklad warehouses'})}
}
