// Read-only server-side warehouse resolution. No inventory mutations.
const BASE='https://api.moysklad.ru/api/remap/1.2';
const CARS={'vehicle-1':'Машина №1','vehicle-2':'Машина №2','vehicle-3':'Машина №3'};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=process.env.MOYSKLAD_TOKEN?.trim(),main=process.env.MOYSKLAD_WAREHOUSE_ID;
 if(!token||!main)return res.status(503).json({ready:false,error:'MoySklad configuration missing'});
 try{
  const headers={Authorization:'Bearer '+token,Accept:'application/json;charset=utf-8'};
  const rows=[];let offset=0;
  do{
   const r=await fetch(BASE+'/entity/store?limit=100&offset='+offset,{headers,signal:AbortSignal.timeout(12000)});
   if(!r.ok)throw Error('HTTP '+r.status);
   const j=await r.json(),page=j.rows||[];
   rows.push(...page);offset+=page.length;
   if(page.length<100)break;
  }while(offset<1000);
  const match=name=>rows.filter(x=>x.name===name);
  const source=match('Береке базар');
  const cars=Object.entries(CARS).map(([vehicleId,name])=>({vehicleId,name,matches:match(name).length}));
  const ready=source.length===1&&source[0].id===main&&cars.every(x=>x.matches===1);
  return res.status(200).json({ready,sourceVerified:source.length===1&&source[0].id===main,vehicles:cars.map(({vehicleId,name,matches})=>({vehicleId,name,verified:matches===1})),writeEnabled:false,details:ready?'Warehouses resolved; transfer posting remains disabled':'Check duplicate warehouse names and source warehouse configuration'});
 }catch{return res.status(502).json({ready:false,error:'MoySklad warehouse validation failed'})}
}
