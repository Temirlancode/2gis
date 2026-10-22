// Read-only deployment readiness check. Does not reveal secrets or post moves.
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const required=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','MOYSKLAD_TOKEN','MOYSKLAD_WAREHOUSE_ID'];
 const missing=required.filter(k=>!process.env[k]);
 const writeEnabled=process.env.MOYSKLAD_TRANSFER_WRITE_ENABLED==='true';
 const liveEnabled=process.env.MOYSKLAD_TRANSFER_LIVE_ENABLED==='true';
 const testIdConfigured=Boolean(process.env.MOYSKLAD_TRANSFER_TEST_OPERATION_ID);
 return res.status(200).json({
  configured:missing.length===0,
  missing,
  writeEnabled,
  liveEnabled,
  testIdConfigured,
  postingMode:!writeEnabled?'disabled':liveEnabled?'live':'single-test-only',
  safeForReadOnlyChecks:missing.length===0&&!writeEnabled&&!liveEnabled,
  nextStep:missing.length?'Configure missing server variables':writeEnabled||liveEnabled?'Disable write flags until controlled test is approved':'Verify Supabase SQL functions and run a controlled test plan before enabling writes'
 });
}
