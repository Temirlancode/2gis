// Read-only check: exactly one active organization is required for future moves.
const BASE='https://api.moysklad.ru/api/remap/1.2';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=process.env.MOYSKLAD_TOKEN;
 if(!token)return res.status(503).json({error:'MOYSKLAD_TOKEN missing'});
 try{
  const h={Authorization:'Bearer '+token.trim(),Accept:'application/json;charset=utf-8'};
  const organizations=[];let offset=0;
  while(offset<1000){
   const r=await fetch(BASE+'/entity/organization?limit=100&offset='+offset,{headers:h,signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('MoySklad organization lookup failed: '+r.status);
   const page=await r.json();const rows=page.rows||[];
   organizations.push(...rows);offset+=rows.length;
   if(rows.length<100)break;
  }
  // Never silently choose an organization if more than one is returned.
  const active=organizations.filter(o=>!o.archived);
  if(active.length!==1)return res.status(409).json({ready:false,count:active.length,error:'Expected exactly one active organization; no automatic selection'});
  const o=active[0];
  return res.status(200).json({ready:true,organization:{id:o.id,name:o.name},writeEnabled:false,details:'Read-only; no documents created'});
 }catch(e){return res.status(502).json({ready:false,error:'Could not verify organization'})}
}
