const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const MAX_BODY = 1 * 1024 * 1024;
const SESSION_TTL = Number(process.env.SESSION_TTL_MS || 1000*60*60*24*7);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const UPLOADS = path.join(ROOT, 'public', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const sessions = new Map();
const attempts = new Map();

function readDb() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeDb(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function now() { return new Date().toISOString(); }
function id(prefix) { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }
function affiliateCode() { return crypto.randomBytes(5).toString('hex').toUpperCase(); }
function affiliateLink(req, code) { const proto=(req.headers['x-forwarded-proto']||'http').split(',')[0]; const host=req.headers.host||'localhost:3000'; return `${proto}://${host}/r/${encodeURIComponent(code)}`; }
function safeUser(u) { const { passwordHash, salt, ...rest } = u; return rest; }
function json(res, status, body, headers={}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', ...headers});
  res.end(payload);
}
function securityHeaders() {
  return {
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy':'same-origin',
    'Cross-Origin-Resource-Policy':'same-origin',
    'Strict-Transport-Security':'max-age=31536000; includeSubDomains; preload',
    'Cache-Control':'no-store'
  };
}
function parseBody(req) {
  return new Promise((resolve,reject)=>{
    let data='';
    req.on('data', c=>{ data+=c; if(data.length>MAX_BODY){ req.destroy(); reject(new Error('Payload too large')); } });
    req.on('end', ()=>{ try{ resolve(data ? JSON.parse(data) : {}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
function userFromReq(req) {
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
  const s=token && sessions.get(token);
  if(!s) return null;
  if(Date.now()>s.expiresAt){ sessions.delete(token); return null; }
  return s.user;
}
function requireAuth(req,res,role) {
  const u=userFromReq(req);
  if(!u){ json(res,401,{error:'Não autenticado'},securityHeaders()); return null; }
  if(role && u.role!==role){ json(res,403,{error:'Sem permissão'},securityHeaders()); return null; }
  return u;
}
function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')) {
  const passwordHash=crypto.scryptSync(password,salt,64).toString('hex');
  return {passwordHash,salt};
}
function verifyPassword(password,u) {
  if(!u.passwordHash || !u.salt) return false;
  const derived=crypto.scryptSync(password,u.salt,64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived,'hex'),Buffer.from(u.passwordHash,'hex'));
}
function rateLimit(key, limit=8, windowMs=60000) {
  const t=Date.now(); const rec=attempts.get(key)||{start:t,count:0};
  if(t-rec.start>windowMs){ attempts.set(key,{start:t,count:1}); return true; }
  rec.count++; attempts.set(key,rec); return rec.count<=limit;
}
function cleanText(v, max=5000) { return String(v||'').trim().slice(0,max); }
function ensureDbShape(db){ db.notifications ||= []; db.messages ||= []; db.orders ||= []; db.payments ||= []; db.uploads ||= []; db.pushSubscriptions ||= []; return db; }
function paymentProvider(){ return process.env.PAYMENT_PROVIDER || 'mock'; }
function paymentMethods(){ return ['cash_delivery','bank_transfer','wallet','multicaixa_express']; }
function validateImageMagic(buf,ext){
  if(ext==='png') return buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(ext==='jpg') return buf.subarray(0,3).equals(Buffer.from([255,216,255]));
  if(ext==='webp') return buf.subarray(0,4).toString('ascii')==='RIFF' && buf.subarray(8,12).toString('ascii')==='WEBP';
  return false;
}

function parseDataUrl(dataUrl){ const m=String(dataUrl||'').match(/^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/); if(!m) return null; const ext=m[2]==='jpeg'?'jpg':m[2]; const buf=Buffer.from(m[3],'base64'); if(buf.length>3*1024*1024) return null; if(!validateImageMagic(buf,ext)) return null; return {ext,buf}; }
function categoryName(db, cid){ return db.categories.find(c=>c.id===cid)?.name || 'Outros'; }
function publicProducts(db){
  return db.products.filter(p=>p.status==='approved').sort((a,b)=>(Number(b.featured)-Number(a.featured))||(new Date(b.createdAt)-new Date(a.createdAt))).map(p=>({...p,categoryName:categoryName(db,p.categoryId)}));
}
function publicServices(db){
  return db.services.filter(s=>s.status==='approved').sort((a,b)=>(Number(b.featured)-Number(a.featured))||(new Date(b.createdAt)-new Date(a.createdAt)));
}
function sendFile(res,file) {
  const ext=path.extname(file).toLowerCase();
  const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json'}[ext]||'application/octet-stream';
  const cache=['.js','.css','.svg','.png','.jpg','.jpeg','.webp'].includes(ext)?'public, max-age=86400':'no-cache';
  if(reqForFileEncoding(res,file)) return;
  res.writeHead(200,{...securityHeaders(),'Content-Type':mime,'Cache-Control':cache});
  fs.createReadStream(file).pipe(res);
}
function reqForFileEncoding(res,file){ return false; }

async function handleApi(req,res){
  const url=new URL(req.url,`http://${req.headers.host}`); const route=url.pathname; const db=ensureDbShape(readDb());
  try {
    if(req.method==='GET' && route==='/api/health') return json(res,200,{ok:true,app:'Kamba Market',version:'4.0.0',time:now()},securityHeaders());
    if(req.method==='GET' && route==='/api/ready') { const pg=!!process.env.DATABASE_URL; return json(res,200,{ok:true,postgresConfigured:pg,storageConfigured:!!process.env.S3_BUCKET,paymentsConfigured:process.env.PAYMENT_PROVIDER && process.env.PAYMENT_PROVIDER!=='mock'},securityHeaders()); }
    if(req.method==='GET' && route==='/api/bootstrap') return json(res,200,{categories:db.categories,products:publicProducts(db),services:publicServices(db),plans:db.plans},securityHeaders());

    if(req.method==='POST' && route==='/api/register') {
      const ip=req.socket.remoteAddress||'unknown'; if(!rateLimit('reg:'+ip,5,3600000)) return json(res,429,{error:'Muitas tentativas. Tente novamente mais tarde.'},securityHeaders());
      const b=await parseBody(req); const name=cleanText(b.name,100); const phone=cleanText(b.phone,30).replace(/\s/g,''); const email=cleanText(b.email,150).toLowerCase(); const password=String(b.password||'');
      if(name.length<2||phone.length<7||password.length<8) return json(res,400,{error:'Nome, telefone e palavra-passe (mínimo 8 caracteres) são obrigatórios.'},securityHeaders());
      if(db.users.some(u=>u.phone===phone || (email && u.email===email))) return json(res,409,{error:'Já existe uma conta com estes dados.'},securityHeaders());
      const hp=hashPassword(password); const u={id:id('u'),name,phone,email,passwordHash:hp.passwordHash,salt:hp.salt,role:'user',verified:false,createdAt:now()}; db.users.push(u); writeDb(db);
      return json(res,201,{user:safeUser(u)},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/login') {
      const ip=req.socket.remoteAddress||'unknown'; if(!rateLimit('login:'+ip,10,900000)) return json(res,429,{error:'Muitas tentativas de login. Tente novamente mais tarde.'},securityHeaders());
      const b=await parseBody(req); const identifier=cleanText(b.identifier,150).toLowerCase(); const u=db.users.find(x=>x.email===identifier || x.phone===identifier);
      if(!u || !verifyPassword(String(b.password||''),u)) return json(res,401,{error:'Credenciais inválidas.'},securityHeaders());
      const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{user:safeUser(u),expiresAt:Date.now()+SESSION_TTL});
      return json(res,200,{token,user:safeUser(u)},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/logout') {
      const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim(); if(token) sessions.delete(token); return json(res,200,{ok:true},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/me') {
      const u=requireAuth(req,res); if(!u) return; const db2=readDb();
      const products=db2.products.filter(p=>p.sellerId===u.id).map(p=>({...p,categoryName:categoryName(db2,p.categoryId)}));
      const services=db2.services.filter(s=>s.providerId===u.id); const favoriteIds=db2.favorites.filter(f=>f.userId===u.id).map(f=>f.productId);
      const sub=db2.subscriptions.filter(s=>s.userId===u.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0]||null;
      return json(res,200,{user:u,products,services,favoriteIds,subscription:sub},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/uploads') {
      const u=requireAuth(req,res); if(!u) return;
      const b=await parseBody(req); const parsed=parseDataUrl(b.dataUrl);
      if(!parsed) return json(res,400,{error:'Imagem inválida. Envie PNG, JPG ou WEBP até 3 MB.'},securityHeaders());
      const fileName=`${u.id}_${crypto.randomBytes(8).toString('hex')}.${parsed.ext}`;
      const full=path.join(UPLOADS,fileName); fs.writeFileSync(full,parsed.buf,{flag:'wx'});
      const d=ensureDbShape(readDb()); const rec={id:id('up'),userId:u.id,fileName,url:`/uploads/${fileName}`,bytes:parsed.buf.length,createdAt:now()}; d.uploads.push(rec); writeDb(d);
      return json(res,201,{upload:rec},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/payments/initiate') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const d=ensureDbShape(readDb());
      const order=d.orders.find(o=>o.id===cleanText(b.orderId,100)&& (o.buyerId===u.id||o.sellerId===u.id)); if(!order) return json(res,404,{error:'Encomenda não encontrada.'},securityHeaders());
      const method=paymentMethods().includes(b.method)?b.method:order.paymentMethod;
      const provider=paymentProvider(); const payment={id:id('pay'),orderId:order.id,userId:u.id,amount:order.total,method,provider,status:provider==='mock'?'pending':'pending',reference:id('ref'),createdAt:now()};
      d.payments.push(payment); order.paymentId=payment.id; writeDb(d);
      return json(res,201,{payment,notice:provider==='mock'?'Ambiente de testes: confirme o pagamento no painel administrativo.':'Pagamento iniciado no provedor configurado.'},securityHeaders());
    }
    if(req.method==='GET' && route.startsWith('/api/payments/')) {
      const u=requireAuth(req,res); if(!u) return; const paymentId=decodeURIComponent(route.split('/').pop()); const d=ensureDbShape(readDb()); const payment=d.payments.find(x=>x.id===paymentId);
      if(!payment) return json(res,404,{error:'Pagamento não encontrado.'},securityHeaders());
      const order=d.orders.find(o=>o.id===payment.orderId); if(!order || (order.buyerId!==u.id&&order.sellerId!==u.id)) return json(res,403,{error:'Sem permissão'},securityHeaders());
      return json(res,200,{payment},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/products') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req);
      const title=cleanText(b.title,120), description=cleanText(b.description,2000), location=cleanText(b.location,100)||'Angola', image=cleanText(b.image,1000);
      const price=Number(b.price); if(title.length<3||!Number.isFinite(price)||price<=0||!b.categoryId) return json(res,400,{error:'Título, preço positivo e categoria são obrigatórios.'},securityHeaders());
      if(!db.categories.some(c=>c.id===b.categoryId)) return json(res,400,{error:'Categoria inválida.'},securityHeaders());
      const p={id:id('p'),sellerId:u.id,title,description,price,categoryId:b.categoryId,location,condition:cleanText(b.condition,30)||'Usado',phone:u.phone,image:image||'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80',featured:false,status:'pending',createdAt:now()}; db.products.unshift(p); writeDb(db); return json(res,201,{product:p},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/services') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const title=cleanText(b.title,120), description=cleanText(b.description,2000), category=cleanText(b.category,80), location=cleanText(b.location,100)||'Angola'; const priceFrom=Number(b.priceFrom||0);
      if(title.length<3||category.length<2||priceFrom<0) return json(res,400,{error:'Título, categoria e preço inicial válidos são obrigatórios.'},securityHeaders());
      const s={id:id('s'),providerId:u.id,title,description,priceFrom,category,location,phone:u.phone,featured:false,status:'pending',createdAt:now()}; db.services.unshift(s); writeDb(db); return json(res,201,{service:s},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/favorites') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const pid=cleanText(b.productId,100); const db2=readDb(); if(!db2.products.some(p=>p.id===pid)) return json(res,404,{error:'Anúncio não encontrado.'},securityHeaders());
      const i=db2.favorites.findIndex(f=>f.userId===u.id&&f.productId===pid); if(i>=0) db2.favorites.splice(i,1); else db2.favorites.push({id:id('f'),userId:u.id,productId:pid,createdAt:now()}); writeDb(db2); return json(res,200,{favorite:i<0},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/reports') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const targetId=cleanText(b.targetId,100); const reason=cleanText(b.reason,200)||'Outro'; const db2=readDb(); db2.reports.push({id:id('r'),userId:u.id,targetId,reason,createdAt:now(),status:'open'}); writeDb(db2); return json(res,201,{ok:true},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/subscribe') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const plan=db.plans.find(x=>x.id===b.planId); if(!plan) return json(res,404,{error:'Plano não encontrado.'},securityHeaders());
      db.subscriptions.push({id:id('sub'),userId:u.id,planId:plan.id,status:'pending_payment',createdAt:now()}); writeDb(db); return json(res,201,{message:'Pedido de subscrição criado. Integração de pagamento deve ser ligada antes da produção.',plan},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/affiliate/join') {
      const u=requireAuth(req,res); if(!u) return; const d=readDb();
      let a=d.affiliates.find(x=>x.userId===u.id);
      if(!a){ a={id:id('aff'),userId:u.id,code:affiliateCode(),status:'active',commissionRate:0.05,clicks:0,conversions:0,earnings:0,createdAt:now()}; d.affiliates.push(a); writeDb(d); }
      return json(res,201,{affiliate:a},securityHeaders());
    }

    if(req.method==='GET' && route==='/api/affiliate/wallet') {
      const u=requireAuth(req,res); if(!u) return; const d=readDb();
      const a=d.affiliates.find(x=>x.userId===u.id);
      if(!a) return json(res,200,{wallet:{available:0,pending:0,paid:0},withdrawals:[]},securityHeaders());
      const affiliateOrders=d.orders.filter(o=>o.affiliateId===a.id);
      const pending=affiliateOrders.filter(o=>['pending_payment','paid'].includes(o.status)).reduce((s,o)=>s+(Number(o.affiliateCommission)||0),0);
      const paid=affiliateOrders.filter(o=>o.status==='completed').reduce((s,o)=>s+(Number(o.affiliateCommission)||0),0);
      const requested=d.withdrawals.filter(w=>w.affiliateId===a.id&&['requested','approved','processing'].includes(w.status)).reduce((s,w)=>s+Number(w.amount||0),0);
      const available=Math.max(0,paid-requested);
      return json(res,200,{wallet:{available,pending,paid},withdrawals:d.withdrawals.filter(w=>w.affiliateId===a.id).sort((x,y)=>new Date(y.createdAt)-new Date(x.createdAt))},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/affiliate/withdraw') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const amount=Number(b.amount);
      const method=['bank_transfer','wallet','multicaixa_express'].includes(b.method)?b.method:'wallet'; const destination=cleanText(b.destination,120);
      if(!Number.isFinite(amount)||amount<5000) return json(res,400,{error:'O valor mínimo para levantamento é 5.000 Kz.'},securityHeaders());
      if(destination.length<5) return json(res,400,{error:'Indique a conta, número ou destino para receber.'},securityHeaders());
      const d=readDb(); const a=d.affiliates.find(x=>x.userId===u.id); if(!a) return json(res,400,{error:'Adira primeiro ao programa de afiliados.'},securityHeaders());
      const paid=d.orders.filter(o=>o.affiliateId===a.id&&o.status==='completed').reduce((s,o)=>s+(Number(o.affiliateCommission)||0),0);
      const held=d.withdrawals.filter(w=>w.affiliateId===a.id&&['requested','approved','processing'].includes(w.status)).reduce((s,w)=>s+Number(w.amount||0),0);
      const available=Math.max(0,paid-held); if(amount>available) return json(res,400,{error:`Saldo disponível insuficiente. Disponível: ${available.toLocaleString('pt-AO')} Kz.`},securityHeaders());
      const w={id:id('wd'),affiliateId:a.id,userId:u.id,amount,method,destination,status:'requested',createdAt:now()}; d.withdrawals.push(w);
      d.notifications.push({id:id('n'),userId:u.id,type:'withdrawal',title:'Levantamento solicitado',message:`Pedido de ${amount.toLocaleString('pt-AO')} Kz enviado para aprovação.`,read:false,createdAt:now()}); writeDb(d);
      return json(res,201,{withdrawal:w},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/affiliate/dashboard') {
      const u=requireAuth(req,res); if(!u) return; const d=readDb(); const a=d.affiliates.find(x=>x.userId===u.id);
      if(!a) return json(res,200,{affiliate:null,links:[],orders:[]},securityHeaders());
      const links=d.affiliateLinks.filter(x=>x.affiliateId===a.id).map(x=>({...x,product:d.products.find(p=>p.id===x.productId)?.title||'Produto'}));
      const orders=d.orders.filter(o=>o.affiliateId===a.id).map(o=>({...o,product:d.products.find(p=>p.id===o.productId)?.title||'Produto'}));
      const earnings=orders.filter(o=>o.status==='paid'||o.status==='completed').reduce((s,o)=>s+(Number(o.affiliateCommission)||0),0);
      return json(res,200,{affiliate:{...a,earnings},links,orders},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/affiliate/link') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const productId=cleanText(b.productId,100); const d=readDb(); let a=d.affiliates.find(x=>x.userId===u.id);
      if(!a){ a={id:id('aff'),userId:u.id,code:affiliateCode(),status:'active',commissionRate:0.05,clicks:0,conversions:0,earnings:0,createdAt:now()}; d.affiliates.push(a); }
      const p=d.products.find(x=>x.id===productId&&x.status==='approved'); if(!p) return json(res,404,{error:'Produto não encontrado.'},securityHeaders());
      let l=d.affiliateLinks.find(x=>x.affiliateId===a.id&&x.productId===p.id); if(!l){ l={id:id('al'),affiliateId:a.id,productId:p.id,clicks:0,createdAt:now()}; d.affiliateLinks.push(l); }
      writeDb(d); return json(res,200,{code:a.code,link:affiliateLink(req,a.code)+`?p=${encodeURIComponent(p.id)}`,product:p},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/search') {
      const q=cleanText(url.searchParams.get('q'),100).toLowerCase(), cat=url.searchParams.get('category')||'', loc=cleanText(url.searchParams.get('location'),80).toLowerCase();
      const products=publicProducts(db).filter(p=>(!q||`${p.title} ${p.description}`.toLowerCase().includes(q))&&(!cat||p.categoryId===cat)&&(!loc||p.location.toLowerCase().includes(loc)));
      const services=publicServices(db).filter(s=>(!q||`${s.title} ${s.description} ${s.category}`.toLowerCase().includes(q))&&(!loc||s.location.toLowerCase().includes(loc)));
      return json(res,200,{products,services},securityHeaders());
    }

    if(req.method==='GET' && route==='/api/admin/withdrawals') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const d=readDb();
      return json(res,200,{withdrawals:d.withdrawals.map(w=>({...w,user:d.users.find(x=>x.id===w.userId)?.name||'Utilizador',code:d.affiliates.find(a=>a.id===w.affiliateId)?.code||''})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/admin/withdrawal') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const b=await parseBody(req); const d=readDb(); const w=d.withdrawals.find(x=>x.id===b.id);
      if(!w) return json(res,404,{error:'Levantamento não encontrado.'},securityHeaders());
      const allowed=['approved','processing','paid','rejected']; if(!allowed.includes(b.status)) return json(res,400,{error:'Estado inválido.'},securityHeaders());
      w.status=b.status; w.adminNote=cleanText(b.adminNote,300); w.updatedAt=now(); if(b.status==='paid') w.paidAt=now();
      d.notifications.push({id:id('n'),userId:w.userId,type:'withdrawal',title:`Levantamento ${b.status==='paid'?'pago':b.status==='rejected'?'rejeitado':'atualizado'}`,message:`O seu levantamento de ${Number(w.amount).toLocaleString('pt-AO')} Kz foi atualizado.`,read:false,createdAt:now()}); writeDb(d);
      return json(res,200,{withdrawal:w},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/admin/payment') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const b=await parseBody(req); const d=ensureDbShape(readDb()); const pay=d.payments.find(x=>x.id===b.id);
      if(!pay) return json(res,404,{error:'Pagamento não encontrado.'},securityHeaders());
      const allowed=['pending','confirmed','failed','refunded']; if(!allowed.includes(b.status)) return json(res,400,{error:'Estado inválido.'},securityHeaders());
      pay.status=b.status; pay.updatedAt=now(); const o=d.orders.find(x=>x.id===pay.orderId); if(o&&b.status==='confirmed') o.status='paid'; if(o&&b.status==='failed') o.status='pending_payment';
      if(o&&b.status==='confirmed') d.notifications.push({id:id('n'),userId:o.buyerId,type:'payment',title:'Pagamento confirmado',message:`O pagamento da encomenda ${o.id} foi confirmado.`,read:false,createdAt:now()});
      writeDb(d); return json(res,200,{payment:pay,order:o},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/admin/stats') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const d=readDb(); return json(res,200,{users:d.users.length,products:d.products.length,services:d.services.length,reports:d.reports.filter(r=>r.status==='open').length,orders:d.orders.length,subscriptions:d.subscriptions.length,affiliates:d.affiliates.length,withdrawals:d.withdrawals.length,affiliateEarnings:d.orders.reduce((s,o)=>s+(Number(o.affiliateCommission)||0),0)},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/admin/business') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const d=readDb();
      const completed=d.orders.filter(o=>o.status==='completed');
      const gmv=completed.reduce((s,o)=>s+Number(o.total||0),0);
      const affiliateCost=completed.reduce((s,o)=>s+Number(o.affiliateCommission||0),0);
      const platformRate=Number(process.env.PLATFORM_COMMISSION_RATE||0.07);
      const platformGross=gmv*platformRate;
      const net=platformGross-affiliateCost;
      return json(res,200,{gmv,platformCommissionRate:platformRate,platformGross,affiliateCost,estimatedPlatformNet:net,completedOrders:completed.length,activeAffiliates:d.affiliates.filter(a=>a.status==='active').length,paidWithdrawals:d.withdrawals.filter(w=>w.status==='paid').reduce((s,w)=>s+Number(w.amount||0),0)},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/admin/pending') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const d=readDb(); return json(res,200,{products:d.products.filter(p=>p.status!=='approved'),services:d.services.filter(s=>s.status!=='approved'),reports:d.reports.filter(r=>r.status==='open')},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/admin/approve') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const b=await parseBody(req); const d=readDb(); const collection=b.type==='service'?d.services:d.products; const item=collection.find(x=>x.id===b.id); if(!item) return json(res,404,{error:'Item não encontrado.'},securityHeaders()); item.status=b.approved?'approved':'rejected'; item.moderatedAt=now(); item.moderatedBy=u.id; writeDb(d); return json(res,200,{item},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/products') {
      const q=cleanText(url.searchParams.get('q'),100).toLowerCase(), cat=url.searchParams.get('category')||'', loc=cleanText(url.searchParams.get('location'),80).toLowerCase();
      const products=publicProducts(db).filter(p=>(!q||`${p.title} ${p.description}`.toLowerCase().includes(q))&&(!cat||p.categoryId===cat)&&(!loc||p.location.toLowerCase().includes(loc)));
      return json(res,200,{products},securityHeaders());
    }
    if(req.method==='GET' && route.startsWith('/api/products/')) {
      const pid=decodeURIComponent(route.split('/').pop()); const p=db.products.find(x=>x.id===pid && x.status==='approved');
      if(!p) return json(res,404,{error:'Anúncio não encontrado.'},securityHeaders());
      const seller=db.users.find(u=>u.id===p.sellerId); return json(res,200,{product:{...p,categoryName:categoryName(db,p.categoryId),seller:seller?{id:seller.id,name:seller.name,verified:seller.verified}:null}},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/orders') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const p=db.products.find(x=>x.id===cleanText(b.productId,100)&&x.status==='approved');
      if(!p) return json(res,404,{error:'Produto não encontrado.'},securityHeaders());
      if(p.sellerId===u.id) return json(res,400,{error:'Não pode encomendar o seu próprio anúncio.'},securityHeaders());
      const qty=Math.max(1,Math.min(20,Number(b.quantity)||1)); const paymentMethod=['cash_delivery','bank_transfer','wallet'].includes(b.paymentMethod)?b.paymentMethod:'cash_delivery';
      const affCode=cleanText(b.affiliateCode,40).toUpperCase(); const aff=db.affiliates.find(a=>a.code===affCode&&a.status==='active'&&a.userId!==u.id); const affLink=aff?db.affiliateLinks.find(l=>l.affiliateId===aff.id&&l.productId===p.id):null; const commission=aff?Math.round(p.price*qty*Number(aff.commissionRate||0.05)):0;
      const order={id:id('ord'),buyerId:u.id,sellerId:p.sellerId,productId:p.id,quantity:qty,total:p.price*qty,paymentMethod,status:'pending_payment',affiliateId:aff?.id||null,affiliateLinkId:affLink?.id||null,affiliateCommission:commission,createdAt:now()}; if(affLink){affLink.clicks=Number(affLink.clicks)||0; aff.conversions=Number(aff.conversions)||0; }
      db.orders.push(order); db.notifications.push({id:id('n'),userId:p.sellerId,type:'order',title:'Nova intenção de compra',message:`Pedido ${order.id} para ${p.title}.`,read:false,createdAt:now()}); writeDb(db);
      return json(res,201,{order,notice:'Encomenda criada. O gateway de pagamento real deve ser ligado antes de produção.'},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/orders') {
      const u=requireAuth(req,res); if(!u) return; const orders=db.orders.filter(o=>o.buyerId===u.id||o.sellerId===u.id).map(o=>({...o,product:db.products.find(p=>p.id===o.productId)?.title||'Produto'}));
      return json(res,200,{orders},securityHeaders());
    }

    if(req.method==='GET' && route==='/api/admin/orders') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const d=readDb();
      return json(res,200,{orders:d.orders.map(o=>({...o,product:d.products.find(p=>p.id===o.productId)?.title||'Produto',buyer:d.users.find(x=>x.id===o.buyerId)?.name||'Utilizador',seller:d.users.find(x=>x.id===o.sellerId)?.name||'Vendedor'})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/admin/order') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const b=await parseBody(req); const d=readDb(); const o=d.orders.find(x=>x.id===b.id);
      if(!o) return json(res,404,{error:'Encomenda não encontrada.'},securityHeaders());
      const allowed=['pending_payment','paid','completed','cancelled']; if(!allowed.includes(b.status)) return json(res,400,{error:'Estado inválido.'},securityHeaders());
      const wasCompleted=o.status==='completed'; o.status=b.status; o.updatedAt=now();
      if(o.status==='completed'&&!wasCompleted&&o.affiliateId){const a=d.affiliates.find(x=>x.id===o.affiliateId); if(a) a.conversions=(Number(a.conversions)||0)+1;}
      d.notifications.push({id:id('n'),userId:o.buyerId,type:'order',title:'Estado da encomenda atualizado',message:`A encomenda ${o.id} está agora: ${o.status}.`,read:false,createdAt:now()}); writeDb(d);
      return json(res,200,{order:o},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/messages') {
      const u=requireAuth(req,res); if(!u) return; const msgs=db.messages.filter(m=>m.fromUserId===u.id||m.toUserId===u.id).map(m=>({...m,fromName:db.users.find(x=>x.id===m.fromUserId)?.name||'Utilizador',toName:db.users.find(x=>x.id===m.toUserId)?.name||'Utilizador'}));
      return json(res,200,{messages:msgs},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/messages') {
      const u=requireAuth(req,res); if(!u) return; const b=await parseBody(req); const toUserId=cleanText(b.toUserId,100), text=cleanText(b.text,1000); if(!text) return json(res,400,{error:'Mensagem vazia.'},securityHeaders());
      if(!db.users.some(x=>x.id===toUserId)) return json(res,404,{error:'Destinatário não encontrado.'},securityHeaders());
      const m={id:id('m'),fromUserId:u.id,toUserId,text,createdAt:now(),read:false}; db.messages.push(m); db.notifications.push({id:id('n'),userId:toUserId,type:'message',title:'Nova mensagem',message:`${u.name} enviou uma mensagem.`,read:false,createdAt:now()}); writeDb(db); return json(res,201,{message:m},securityHeaders());
    }
    if(req.method==='GET' && route==='/api/notifications') {
      const u=requireAuth(req,res); if(!u) return; return json(res,200,{notifications:db.notifications.filter(n=>n.userId===u.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,50)},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/admin/feature') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const b=await parseBody(req); const d=readDb(); const collection=b.type==='service'?d.services:d.products; const item=collection.find(x=>x.id===b.id); if(!item) return json(res,404,{error:'Item não encontrado.'},securityHeaders()); item.featured=!!b.featured; writeDb(d); return json(res,200,{item},securityHeaders());
    }
    if(req.method==='POST' && route==='/api/admin/resolve-report') {
      const u=requireAuth(req,res,'admin'); if(!u) return; const b=await parseBody(req); const d=readDb(); const r=d.reports.find(x=>x.id===b.id); if(!r) return json(res,404,{error:'Denúncia não encontrada.'},securityHeaders()); r.status='resolved'; r.resolvedAt=now(); r.resolvedBy=u.id; writeDb(d); return json(res,200,{report:r},securityHeaders());
    }
    return json(res,404,{error:'Rota não encontrada.'},securityHeaders());
  } catch(e) { console.error(e); return json(res,500,{error:'Erro interno do servidor.'},securityHeaders()); }
}

const server=http.createServer(async(req,res)=>{
  if(!['GET','POST','HEAD'].includes(req.method)) return json(res,405,{error:'Método não permitido'},securityHeaders());
  if(req.url.length>4096) return json(res,414,{error:'URI demasiado longa'},securityHeaders());
  if(req.method==='GET' && req.url.startsWith('/r/')) {
    const u=new URL(req.url,`http://${req.headers.host}`); const code=decodeURIComponent(u.pathname.split('/').pop()); const d=readDb(); const a=d.affiliates.find(x=>x.code===code&&x.status==='active');
    if(!a) return res.writeHead(302,{Location:'/'}).end();
    a.clicks=(Number(a.clicks)||0)+1; const pid=u.searchParams.get('p'); const link=d.affiliateLinks.find(x=>x.affiliateId===a.id&&(!pid||x.productId===pid)); if(link) link.clicks=(Number(link.clicks)||0)+1; writeDb(d);
    const target=pid?`/#market?product=${encodeURIComponent(pid)}`:'/#market'; return res.writeHead(302,{Location:target,'Cache-Control':'no-store'}).end();
  }

  if(req.url.startsWith('/api/')) return handleApi(req,res);
  let pathname=new URL(req.url,`http://${req.headers.host}`).pathname; if(pathname==='/') pathname='/index.html';
  const file=path.normalize(path.join(PUBLIC,pathname)); if(!file.startsWith(PUBLIC)) return json(res,403,{error:'Forbidden'},securityHeaders());
  fs.stat(file,(err,st)=>{ if(err||!st.isFile()) return sendFile(res,path.join(PUBLIC,'index.html')); sendFile(res,file); });
});
server.listen(PORT,()=>console.log(`Kamba Market em http://localhost:${PORT}`));
for (const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>server.close(()=>process.exit(0)));
