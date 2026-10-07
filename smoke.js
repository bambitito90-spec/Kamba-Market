const http=require('http');
const {spawn}=require('child_process');
const path=require('path');
const cwd=path.join(__dirname,'..');
const port=3199;
const child=spawn(process.execPath,['server.js'],{cwd,env:{...process.env,PORT:String(port),NODE_ENV:'test',PAYMENT_PROVIDER:'mock'},stdio:'ignore'});
function req(pathname,opts={}){return new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port,path:pathname,...opts},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:d}));});r.on('error',reject); if(opts.body) r.write(opts.body); r.end();});}
(async()=>{
  for(let i=0;i<30;i++){try{if((await req('/api/health')).status===200)break;}catch{} await new Promise(r=>setTimeout(r,100));}
  const health=await req('/api/health'); if(health.status!==200) throw new Error('health failed');
  const ready=await req('/api/ready'); if(ready.status!==200) throw new Error('ready failed');
  const boot=await req('/api/bootstrap'); if(boot.status!==200) throw new Error('bootstrap failed');
  console.log('SMOKE OK', JSON.parse(boot.body).products.length, 'products');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>child.kill('SIGTERM'));
