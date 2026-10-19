// Public read-only catalog for the four approved products at the selected warehouse.
// Credentials remain server-side. No inventory mutations are performed.
const IDS=['74dfab0e-c48d-11f1-0a80-029d002504df','863fb57e-c48d-11f1-0a80-0bb00026219b','984fc86e-c48d-11f1-0a80-0e780024b1ac','e52604ea-cbe3-11f1-0a80-02e500009275'];
const BASE='https://api.moysklad.ru/api/remap/1.2';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const token=process.env.MOYSKLAD_TOKEN,warehouse=process.env.MOYSKLAD_WAREHOUSE_ID;
  if(!token||!warehouse)return res.status(503).json({error:'MoySklad warehouse is not configured'});
  if(!/^[0-9a-f-]{36}$/i.test(warehouse))return res.status(503).json({error:'Invalid warehouse configuration'});
  const headers={Authorization:`Bearer ${token.trim()}`,Accept:'application/json;charset=utf-8'};
  const get=async url=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('MoySklad HTTP '+r.status);return r.json()};
  try{
    // The warehouse filter is critical: do not sum stocks from other stores.
    const filter='store='+BASE+'/entity/store/'+warehouse;
    const stockById=new Map();
    let offset=0;
    while(true){
      const u=new URL(BASE+'/report/stock/all');
      u.searchParams.set('filter',filter);u.searchParams.set('limit','1000');u.searchParams.set('offset',String(offset));
      const page=await get(u.toString());
      const rows=Array.isArray(page.rows)?page.rows:[];
      for(const row of rows){
        const href=row.meta?.href||row.assortment?.meta?.href||'';
        const id=href.match(/\/([0-9a-f-]{36})(?:\?|$)/i)?.[1];
        if(id&&IDS.includes(id))stockById.set(id,Number(row.stock)||0);
      }
      offset+=rows.length;
      if(!rows.length||offset>=(page.meta?.size??offset)||offset>=10000)break;
    }
    const products=await Promise.all(IDS.map(async id=>{
      const p=await get(BASE+'/entity/product/'+id);
      const sale=p.salePrices?.find(x=>x.priceType?.name==='Цена продажи')||p.salePrices?.[0];
      return {id,name:p.name,article:p.article||'',code:p.code||'',price:sale&&Number.isFinite(sale.value)?sale.value/100:null,stock:stockById.get(id)??0};
    }));
    return res.status(200).json({warehouse:'Береке базар',products,updatedAt:new Date().toISOString()});
  }catch(e){return res.status(502).json({error:'Could not load warehouse stock and prices',detail:/MoySklad HTTP \d+/.test(e.message)?e.message:undefined});}
}
