'use strict';
/**
 * Minimal PostgreSQL health/transaction helper for the production migration path.
 * The current demo server remains JSON-backed; use this module only after migrating
 * all application reads/writes to PostgreSQL and setting DATABASE_URL.
 */
const { Pool } = require('pg');
let pool;
function getPool(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
  if(!pool) pool = new Pool({connectionString:process.env.DATABASE_URL, max:Number(process.env.DB_POOL_MAX||10), ssl:process.env.DB_SSL==='false'?false:{rejectUnauthorized:false}});
  return pool;
}
async function health(){ const p=getPool(); const r=await p.query('SELECT 1 AS ok'); return r.rows[0].ok===1; }
async function transaction(fn){ const client=await getPool().connect(); try{await client.query('BEGIN'); const out=await fn(client); await client.query('COMMIT'); return out;}catch(e){await client.query('ROLLBACK'); throw e;}finally{client.release();} }
async function close(){if(pool){await pool.end();pool=null;}}
module.exports={getPool,health,transaction,close};
