import test from 'node:test';
import assert from 'node:assert/strict';
import { readLimitedTextBody } from '../http-utils.js';

function responseFromChunks(chunks) {
  let cancelled=false;
  let index=0;
  const response={
    async text(){return chunks.join('');},
    body:{
      getReader(){
        return {
          async read(){
            if(index>=chunks.length)return {done:true};
            const value=new TextEncoder().encode(chunks[index++]);
            return {done:false,value};
          },
          async cancel(){cancelled=true;},
          releaseLock(){}
        };
      }
    },
    wasCancelled:()=>cancelled
  };
  return response;
}

test('reads streamed UTF-8 content under the byte limit without truncation', async () => {
  const response=responseFromChunks(['Empresa ','São Paulo']);
  assert.equal(await readLimitedTextBody(response,100),'Empresa São Paulo');
  assert.equal(response.wasCancelled(),false);
});

test('cancels and throws instead of silently returning a truncated page', async () => {
  const response=responseFromChunks(['12345','67890']);
  await assert.rejects(()=>readLimitedTextBody(response,7),/excedeu o limite/);
  assert.equal(response.wasCancelled(),true);
});

test('checks fallback text responses when a stream reader is unavailable', async () => {
  const response={body:null,async text(){return 'texto grande';}};
  await assert.rejects(()=>readLimitedTextBody(response,4),/excedeu o limite/);
  assert.equal(await readLimitedTextBody({body:null,async text(){return 'ok';}},10),'ok');
});

test('rejects invalid byte limits and missing bodies', async () => {
  await assert.rejects(()=>readLimitedTextBody({async text(){return 'x';}},0),/Limite de leitura/);
  await assert.rejects(()=>readLimitedTextBody(null,10),/Resposta HTTP/);
});
