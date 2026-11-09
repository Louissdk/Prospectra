import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const API = process.env.POSTGREST_URL || 'http://127.0.0.1:3000';
const JWT_SECRET = process.env.PGRST_JWT_SECRET || 'prospectra-ci-test-only-secret-32-chars';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function jwtFor(subject) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg:'HS256', typ:'JWT' });
  const payload = encode({
    role:'authenticated',
    sub:subject,
    aud:'authenticated',
    exp:Math.floor(Date.now()/1000)+600
  });
  const signingInput = header+'.'+payload;
  const signature = createHmac('sha256',JWT_SECRET).update(signingInput).digest('base64url');
  return signingInput+'.'+signature;
}

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization','Bearer '+token);
  const response = await fetch(API+path,{...options,headers});
  const body = await response.text();
  let json=null;
  try { json=body ? JSON.parse(body) : null; } catch {}
  return {response,body,json};
}

const tokenA=jwtFor(USER_A);
const tokenB=jwtFor(USER_B);

// Anonymous requests must not gain access to the table just because the schema is public.
const anonymous=await request('/prospectra_leads?select=id');
assert.ok(!anonymous.response.ok,'A role anon sem GRANT não deve ler prospectra_leads.');

// User A sees the legacy row migrated from the old schema.
const ownRead=await request('/prospectra_leads?select=id,identity_key,payload&order=id.asc',{token:tokenA});
assert.equal(ownRead.response.status,200,ownRead.body);
assert.equal(ownRead.json.length,1);
assert.equal(ownRead.json[0].identity_key,'place:legacy-1');

// User B cannot see User A's row.
const foreignRead=await request('/prospectra_leads?select=id',{token:tokenB});
assert.equal(foreignRead.response.status,200,foreignRead.body);
assert.deepEqual(foreignRead.json,[]);

// The conflict target and merge-duplicates behavior used by Prospectra must work.
const upsertPath='/prospectra_leads?on_conflict=user_id,identity_key';
const upsertHeaders={
  'Content-Type':'application/json',
  Prefer:'resolution=merge-duplicates,return=representation'
};
const row={
  id:'api-own',
  identity_key:'place:api-own',
  user_id:USER_A,
  payload:{identityKey:'place:api-own',name:'Lead via PostgREST'},
  updated_at:'2026-11-09T15:00:00.000Z',
  deleted_at:null
};
const inserted=await request(upsertPath,{
  token:tokenA,method:'POST',headers:upsertHeaders,body:JSON.stringify([row])
});
assert.ok(inserted.response.ok,inserted.body);
assert.equal(inserted.json.length,1);
assert.equal(inserted.json[0].identity_key,'place:api-own');

// A client cannot insert another user's rows by forging user_id.
const foreignInsert=await request(upsertPath,{
  token:tokenA,method:'POST',headers:upsertHeaders,
  body:JSON.stringify([{...row,id:'forged',identity_key:'place:forged',user_id:USER_B}])
});
assert.ok(!foreignInsert.response.ok,'RLS deve bloquear INSERT com user_id alheio.');

// The extension uses PATCH/UPSERT through PostgREST; own-row updates must work.
const updated=await request('/prospectra_leads?id=eq.api-own',{
  token:tokenA,method:'PATCH',
  headers:{'Content-Type':'application/json',Prefer:'return=representation'},
  body:JSON.stringify({payload:{identityKey:'place:api-own',name:'Lead atualizado'}})
});
assert.equal(updated.response.status,200,updated.body);
assert.equal(updated.json.length,1);
assert.equal(updated.json[0].payload.name,'Lead atualizado');

// User B remains unable to see or change the row after the update.
const foreignAfter=await request('/prospectra_leads?id=eq.api-own',{token:tokenB});
assert.equal(foreignAfter.response.status,200,foreignAfter.body);
assert.deepEqual(foreignAfter.json,[]);

const deleted=await request('/prospectra_leads?id=eq.api-own',{
  token:tokenA,method:'DELETE',headers:{Prefer:'return=representation'}
});
assert.equal(deleted.response.status,200,deleted.body);
assert.equal(deleted.json.length,1);

const afterDelete=await request('/prospectra_leads?id=eq.api-own',{token:tokenA});
assert.equal(afterDelete.response.status,200,afterDelete.body);
assert.deepEqual(afterDelete.json,[]);

process.stdout.write('PostgREST OK: grants, auth, RLS, upsert, update e delete.\n');
