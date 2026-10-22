const BASE='https://api.moysklad.ru/api/remap/1.2';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=process.env.MOYSKLAD_TOKEN;
 if(!token)return res.status(503).json({error:'MoySklad token not configured'});
 try{
  const response=await fetch(BASE+'/entity/organization?limit=100',{headers:{Authorization:'Bearer '+token.trim(),Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok){const raw=await response.text();let detail='';try{const data=JSON.parse(raw);detail=(data.errors||[]).map(x=>({code:x.code,error:x.error})).slice(0,3)}catch{}return res.status(502).json({ready:false,error:'MoySklad API returned error',upstreamStatus:response.status,details:detail,hint:response.status===400?'Check API request and error code':response.status===401?'Check MOYSKLAD_TOKEN':response.status===403?'Check token permissions':response.status===429?'Rate limited; retry later':'Check MoySklad API availability'});}
  const page=await response.json();
  const organizations=(page.rows||[]).filter(o=>!o.archived);
  if((page.meta?.size||0)>100||organizations.length!==1)return res.status(409).json({ready:false,count:organizations.length,reason:'Expected exactly one active organization'});
  return res.status(200).json({ready:true,organization:{id:organizations[0].id,name:organizations[0].name},writeEnabled:false});
 }catch(e){return res.status(502).json({ready:false,error:'Organization check failed',reason:e?.name==='TimeoutError'?'timeout':e instanceof SyntaxError?'invalid_json':'network_or_runtime_error'})}
}