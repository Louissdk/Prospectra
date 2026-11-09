import test from 'node:test';
import assert from 'node:assert/strict';
import { readSupabaseLeadRows, upsertSupabaseLeadRows } from '../supabase-sync-client.js';

function jsonResponse(rows,contentRange,status=200) {
  return {
    ok:status>=200&&status<300,
    status,
    headers:{get(name){return name.toLowerCase()==='content-range'?contentRange:null;}},
    async json(){return rows;},
    async text(){return JSON.stringify(rows);}
  };
}

test('reads all Supabase pages and stops at the exact reported total', async () => {
  const records=Array.from({length:2450},(_,index)=>({id:'id-'+index}));
  const calls=[];
  const result=await readSupabaseLeadRows({
    projectUrl:'https://project.supabase.co',
    headers:{Authorization:'Bearer test'},
    fetchImpl:async(url,options)=>{
      calls.push({url,range:options.headers.Range});
      const start=Number(options.headers.Range.split('-')[0]);
      const page=records.slice(start,start+1000);
      return jsonResponse(page,Math.min(start+999,records.length-1)+'/'+records.length);
    }
  });
  assert.equal(result.rows.length,2450);
  assert.equal(result.total,2450);
  assert.deepEqual(calls.map(call=>call.range),['0-999','1000-1999','2000-2999']);
  assert.ok(calls.every(call=>call.url.includes('deleted_at')));
});

test('cancels remote reads when exact total exceeds the configured cap', async () => {
  let reads=0;
  await assert.rejects(()=>readSupabaseLeadRows({
    projectUrl:'https://project.supabase.co',maxRecords:20000,
    fetchImpl:async()=>{reads+=1;return jsonResponse([],'0-999/20001');}
  }),/acima do limite/);
  assert.equal(reads,1);
});

test('rejects incomplete pages when PostgREST reports an exact total', async () => {
  let page=0;
  await assert.rejects(()=>readSupabaseLeadRows({
    projectUrl:'https://project.supabase.co',
    fetchImpl:async()=>{
      page+=1;
      return page===1
        ? jsonResponse(Array.from({length:1000},(_,i)=>({id:String(i)})),'0-999/1500')
        : jsonResponse([],'1000-1499/1500');
    }
  }),/Leitura incompleta/);
});

test('reports clear schema migration errors for missing deleted_at', async () => {
  await assert.rejects(()=>readSupabaseLeadRows({
    projectUrl:'https://project.supabase.co',
    fetchImpl:async()=>({ok:false,async text(){return 'column prospectra_leads.deleted_at does not exist';}})
  }),/coluna deleted_at/);
});

test('upserts rows in bounded idempotent batches and reports progress', async () => {
  const rows=Array.from({length:451},(_,index)=>({id:String(index)}));
  const batches=[];
  const progress=[];
  const sent=await upsertSupabaseLeadRows({
    projectUrl:'https://project.supabase.co',
    rows,
    fetchImpl:async(url,options)=>{
      batches.push({url,body:JSON.parse(options.body),headers:options.headers});
      return {ok:true,status:204,async text(){return '';}}
    },
    onProgress:(current,total)=>progress.push([current,total])
  });
  assert.equal(sent,451);
  assert.deepEqual(batches.map(item=>item.body.length),[200,200,51]);
  assert.ok(batches.every(item=>item.url.includes('on_conflict=user_id,identity_key')));
  assert.ok(batches.every(item=>item.headers.Prefer.includes('merge-duplicates')));
  assert.deepEqual(progress,[[200,451],[400,451],[451,451]]);
});

test('stops on the first failed Supabase upsert without claiming the remaining rows', async () => {
  let calls=0;
  await assert.rejects(()=>upsertSupabaseLeadRows({
    projectUrl:'https://project.supabase.co',
    rows:Array.from({length:401},(_,index)=>({id:String(index)})),
    fetchImpl:async()=>{
      calls+=1;
      return calls===2
        ? {ok:false,status:500,async text(){return 'RLS denied';}}
        : {ok:true,status:204,async text(){return '';}}
    }
  }),/Falha ao enviar lote 2/);
  assert.equal(calls,2);
});
