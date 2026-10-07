const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const checks=[
  ['No hard-coded production secret', !fs.readFileSync(path.join(root,'server.js'),'utf8').match(/sk_live_|AKIA[0-9A-Z]{16}|password\s*=\s*['"][^'\"]{8,}/i)],
  ['Passwords use scrypt', fs.readFileSync(path.join(root,'server.js'),'utf8').includes('crypto.scryptSync')],
  ['Security headers enabled', fs.readFileSync(path.join(root,'server.js'),'utf8').includes("Strict-Transport-Security")],
  ['Upload size limited', fs.readFileSync(path.join(root,'server.js'),'utf8').includes('3*1024*1024')],
];
let bad=0; for(const [name,ok] of checks){ console.log((ok?'PASS ':'FAIL ')+name); if(!ok) bad++; }
process.exitCode=bad?1:0;
