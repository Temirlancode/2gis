// Server-side proxy: never expose DGIS_API_KEY in the browser.
module.exports=async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const lon=Number(req.query.lon),lat=Number(req.query.lat);
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon < -180||lon > 180||lat < -90||lat > 90)return res.status(400).json({error:'Invalid coordinates'});
  const key=process.env.DGIS_API_KEY;
  if(!key)return res.status(503).json({error:'Ключ 2ГИС не настроен на сервере'});
  try{
    const url=new URL('https://catalog.api.2gis.com/3.0/items/geocode');
    url.searchParams.set('lon',String(lon));url.searchParams.set('lat',String(lat));
    url.searchParams.set('type','building');url.searchParams.set('fields','items.address,items.point');
    url.searchParams.set('key',key);
    const upstream=await fetch(url,{signal:AbortSignal.timeout(8000)});
    const body=await upstream.json();
    if(!upstream.ok||body.meta?.code&&body.meta.code!==200){
      console.error('2GIS geocode status',upstream.status,body.meta?.code);
      return res.status(502).json({error:'2ГИС не вернул данные. Проверьте доступ ключа к Geocoder API'});
    }
    const item=body.result?.items?.[0];
    const address=item?.address_name||item?.full_name||item?.address?.name||'';
    const place=item?{name:item.name||item.full_name||'Здание',address,type:item.type||''}:null;
    res.setHeader('Cache-Control','public, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({place});
  }catch(err){console.error('2GIS geocode failed',err.message);return res.status(502).json({error:'Не удалось связаться с 2ГИС'})}
};
