const BASE='https://api.moysklad.ru/api/remap/1.2';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=process.env.MOYSKLAD_TOKEN;
 if(!token)return res.status(503).json({error:'MoySklad token not configured'});
 try{
  const response=await fetch(BASE+'/entity/organization?limit=100',{headers:{Authorization:'Bearer '+token.trim(),Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('API request failed');
  const page=await response.json();
  const organizations=(page.rows||[]).filter(o=>!o.archived);
  if((page.meta?.size||0)>100||organizations.length!==1)return res.status(409).json({ready:false,count:organizations.length,reason:'Expected exactly one active organization'});
  return res.status(200).json({ready:true,organization:{id:organizations[0].id,name:organizations[0].name},writeEnabled:false});
 }catch{return res.status(502).json({ready:false,error:'Organization check failed'})}
}