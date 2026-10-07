'use strict';
const fs=require('fs'); const path=require('path'); const {Client}=require('pg');
const root=path.join(__dirname,'..'); const db=JSON.parse(fs.readFileSync(path.join(root,'data','db.json'),'utf8'));
const url=process.env.DATABASE_URL; if(!url){console.error('Defina DATABASE_URL.');process.exit(1)}
const client=new Client({connectionString:url,ssl:process.env.DB_SSL==='false'?false:{rejectUnauthorized:false}});
const q=async(sql,args=[])=>client.query(sql,args);
(async()=>{await client.connect(); try{
  await q('BEGIN');
  for(const c of db.categories||[]) await q('INSERT INTO categories(id,name,icon) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[c.id,c.name,c.icon||'•']);
  for(const u of db.users||[]) await q('INSERT INTO users(id,name,phone,email,password_hash,salt,role,verified,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[u.id,u.name,u.phone,u.email||null,u.passwordHash,u.salt,u.role||'user',!!u.verified,u.createdAt||new Date().toISOString()]);
  for(const p of db.products||[]) await q('INSERT INTO products(id,seller_id,category_id,title,description,price,location,condition,status,featured,image,phone,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO NOTHING',[p.id,p.sellerId,p.categoryId||null,p.title,p.description||'',p.price,p.location||'',p.condition||'usado',p.status||'pending',!!p.featured,p.image||null,p.phone||null,p.createdAt||new Date().toISOString()]);
  for(const s of db.services||[]) await q('INSERT INTO services(id,provider_id,title,category,description,price_from,location,phone,status,featured,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING',[s.id,s.providerId,s.title,s.category||'Outros',s.description||'',s.priceFrom||0,s.location||'',s.phone||null,s.status||'pending',!!s.featured,s.createdAt||new Date().toISOString()]);
  for(const a of db.affiliates||[]) await q('INSERT INTO affiliates(id,user_id,code,status,commission_rate,clicks,conversions,earnings,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING',[a.id,a.userId,a.code,a.status||'active',a.commissionRate||0.05,a.clicks||0,a.conversions||0,a.earnings||0,a.createdAt||new Date().toISOString()]);
  for(const al of db.affiliateLinks||[]) await q('INSERT INTO affiliate_links(id,affiliate_id,product_id,clicks,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[al.id,al.affiliateId,al.productId,al.clicks||0,al.createdAt||new Date().toISOString()]);
  await q('COMMIT'); console.log('Migração concluída.');
}catch(e){await q('ROLLBACK'); console.error(e); process.exitCode=1;} finally{await client.end();}})();
