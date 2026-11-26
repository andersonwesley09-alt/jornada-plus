// Jornada+ — cadastro sem e-mail: Edge Function Supabase
// Deploy como função pública (verify_jwt=false). A própria função valida o token no comando 'rotate'.
// Service role e segredo de recuperação ficam somente no Supabase, NUNCA no GitHub Pages.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SECRET = Deno.env.get('JORNADA_RECOVERY_PEPPER') || '';
const ALLOWED_ORIGINS = (Deno.env.get('JORNADA_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
const ACCOUNT_DOMAIN = 'contas.jornada.test';
const USERNAME = /^[a-z][a-z0-9_-]{3,23}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const encoder = new TextEncoder();

function originAllowed(origin: string | null) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}
function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && originAllowed(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}
function answer(data: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(data), {status, headers:{...corsHeaders(origin), 'Content-Type':'application/json; charset=utf-8'}});
}
function normalizeUsername(s: unknown) {return String(s ?? '').trim().toLowerCase();}
function codeChars(code: unknown) {return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function techEmail(username: string) {return `${username}@${ACCOUNT_DOMAIN}`;}
function passwordOk(value: unknown): value is string {return typeof value === 'string' && value.length >= 10 && value.length <= 128;}
function recoveryCode() {
  // 16 símbolos em alfabeto de 32: 80 bits de entropia, somente exibido uma vez.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, n=>ALPHABET[n & 31]).join('');
  return 'JP-'+chars.match(/.{1,4}/g)!.join('-');
}
async function hmac(value: string) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig = await crypto.subtle.sign('HMAC',key,encoder.encode(value));
  return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equalHash(a: string,b: string) {
  if(a.length!==b.length)return false;
  let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);
  return x===0;
}
function clientIp(req: Request) {
  // Proxy deve definir os cabeçalhos; não usar como controle antiabuso único em produção.
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

Deno.serve(async req=>{
  const origin=req.headers.get('Origin');
  if(!originAllowed(origin))return answer({error:'Origem não autorizada.'},403,null);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(origin)});
  if(req.method!=='POST')return answer({error:'Método não permitido.'},405,origin);
  if(!SUPABASE_URL||!SERVICE_KEY||SECRET.length<32||!ALLOWED_ORIGINS.length)
    return answer({error:'Servidor de contas não foi configurado. Confira as variáveis secretas.'},503,origin);
  const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
  let body:Record<string,unknown>;
  try{
    const raw=await req.text();if(raw.length>4096)return answer({error:'Solicitação grande demais.'},413,origin);
    body=JSON.parse(raw);
  }catch{return answer({error:'Solicitação inválida.'},400,origin);}
  const action=body.action;
  if(!['register','recover','rotate'].includes(String(action)))return answer({error:'Operação inválida.'},400,origin);
  const username=normalizeUsername(body.username);
  const ipHash=await hmac('ip:'+clientIp(req));
  const idHash=await hmac('username:'+username);
  const cutoff=new Date(Date.now()-(action==='register'?3600000:1800000)).toISOString();
  const ipMax=action==='register'?8:12;
  try{
    // Limites básicos por IP e por usuário. Para lançamento público, adicione CAPTCHA/WAF.
    const q1=await admin.from('jornada_auth_attempts').select('id',{count:'exact',head:true}).eq('action',action).eq('ip_hash',ipHash).gte('created_at',cutoff);
    if(q1.error)throw q1.error;
    if((q1.count??0)>=ipMax)return answer({error:'Muitas tentativas. Tente novamente mais tarde.'},429,origin);
    if(action==='recover'){
      const q2=await admin.from('jornada_auth_attempts').select('id',{count:'exact',head:true}).eq('action','recover').eq('identifier_hash',idHash).gte('created_at',cutoff);
      if(q2.error)throw q2.error;
      if((q2.count??0)>=5)return answer({error:'Muitas tentativas. Tente novamente mais tarde.'},429,origin);
    }
    const tracked=await admin.from('jornada_auth_attempts').insert({action,ip_hash:ipHash,identifier_hash:idHash});
    if(tracked.error)throw tracked.error;

    if(action==='register'){
      const name=String(body.name??'').trim();
      if(!USERNAME.test(username)||name.length<2||name.length>70||!passwordOk(body.password))
        return answer({error:'Informe nome válido, usuário de 4 a 24 caracteres e senha com pelo menos 10 caracteres.'},400,origin);
      const existing=await admin.from('jornada_account_recovery').select('user_id').eq('username',username).maybeSingle();
      if(existing.error)throw existing.error;
      if(existing.data)return answer({error:'Esse nome de usuário já está em uso.'},409,origin);
      const {data:created,error:authErr}=await admin.auth.admin.createUser({
        email:techEmail(username),password:body.password,email_confirm:true,user_metadata:{name,username}
      });
      if(authErr){
        if(/already|registered|duplicate/i.test(authErr.message))return answer({error:'Esse nome de usuário já está em uso.'},409,origin);
        throw authErr;
      }
      const userId=created.user?.id;
      if(!userId)throw new Error('Conta não criada.');
      const code=recoveryCode();
      const digest=await hmac('recovery:'+username+':'+codeChars(code));
      const saved=await admin.from('jornada_account_recovery').insert({user_id:userId,username,code_hash:digest});
      const prof=saved.error?{error:saved.error}:await admin.from('jornada_profiles').upsert({id:userId,name,schedule:{}},{onConflict:'id'});
      if(saved.error||prof.error){
        await admin.auth.admin.deleteUser(userId);
        throw saved.error||prof.error;
      }
      return answer({ok:true,recovery_code:code},201,origin);
    }

    if(action==='recover'){
      if(!USERNAME.test(username)||!passwordOk(body.password)||codeChars(body.code).length!==18||!codeChars(body.code).startsWith('JP'))
        return answer({error:'Confira usuário, código de recuperação e nova senha.'},400,origin);
      const record=await admin.from('jornada_account_recovery').select('user_id,code_hash').eq('username',username).maybeSingle();
      if(record.error)throw record.error;
      const digest=await hmac('recovery:'+username+':'+codeChars(body.code));
      if(!record.data||!equalHash(digest,record.data.code_hash))
        return answer({error:'Usuário ou código inválido.'},401,origin);
      const changed=await admin.auth.admin.updateUserById(record.data.user_id,{password:body.password});
      if(changed.error)throw changed.error;
      const newCode=recoveryCode();
      const upd=await admin.from('jornada_account_recovery').update({code_hash:await hmac('recovery:'+username+':'+codeChars(newCode)),changed_at:new Date().toISOString()}).eq('user_id',record.data.user_id);
      if(upd.error)throw upd.error;
      return answer({ok:true,recovery_code:newCode},200,origin);
    }

    if(action==='rotate'){
      const authHeader=req.headers.get('Authorization')||'';
      const jwt=/^Bearer\s+(.+)$/i.exec(authHeader)?.[1];
      if(!jwt)return answer({error:'Entre na sua conta para gerar outro código.'},401,origin);
      const session=await admin.auth.getUser(jwt);
      if(session.error||!session.data.user)return answer({error:'Sessão expirada. Faça login novamente.'},401,origin);
      const userId=session.data.user.id;
      const row=await admin.from('jornada_account_recovery').select('username').eq('user_id',userId).maybeSingle();
      if(row.error)throw row.error;
      if(!row.data)return answer({error:'Conta antiga sem código. Procure o suporte para migração.'},400,origin);
      const newCode=recoveryCode();
      const upd=await admin.from('jornada_account_recovery').update({code_hash:await hmac('recovery:'+row.data.username+':'+codeChars(newCode)),changed_at:new Date().toISOString()}).eq('user_id',userId);
      if(upd.error)throw upd.error;
      return answer({ok:true,recovery_code:newCode},200,origin);
    }
    return answer({error:'Operação inválida.'},400,origin);
  }catch(err){
    console.error('Jornada+ contas: erro interno',err instanceof Error?err.message:String(err));
    return answer({error:'Não foi possível completar a operação. Confira a configuração do servidor.'},500,origin);
  }
});
