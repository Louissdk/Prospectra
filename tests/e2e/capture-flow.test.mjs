import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const contentScript = await readFile(new URL('../../content.js', import.meta.url), 'utf8');
const fixtureHtml = await readFile(new URL('../fixtures/maps-results.html', import.meta.url), 'utf8');
const fixtureDom = new JSDOM(fixtureHtml);
const resultsMarkup = fixtureDom.window.document.querySelector('main').innerHTML;
fixtureDom.window.close();

async function runFixture({ body, startMessage, simulateNavigation = false }) {
  const initialUrl = 'https://www.google.com/maps/search/clinicas+guarulhos';
  const dom = new JSDOM('<!doctype html><html><head><title>Maps fixture</title></head><body>' + body + '</body></html>', {
    url: initialUrl,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const sent = [];
  let onMessage;
  let completedResolve;
  const completed = new Promise((resolve) => { completedResolve = resolve; });
  window.HTMLElement.prototype.getClientRects = function () { return [{ width: 200, height: 60 }]; };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.chrome = {
    runtime: {
      onMessage: { addListener(fn) { onMessage = fn; } },
      sendMessage(message) {
        sent.push(message);
        if (message.type === 'PROSPECTRA_CAPTURE_COMPLETE') completedResolve(message);
        return Promise.resolve({ ok: true, saved: message.items?.length || 0 });
      }
    }
  };
  if (simulateNavigation) {
    window.document.addEventListener('click', (event) => {
      const anchor = event.target.closest('a[href*="/maps/place/"]');
      if (anchor) {
        event.preventDefault();
        window.history.pushState({}, '', anchor.href);
        window.document.querySelector('main').innerHTML =
          '<button aria-label="Back to results">Voltar para resultados</button>' +
          '<h1>Clínica Exemplo</h1>' +
          '<div>Clínica odontológica</div>';
        return;
      }
      const back = event.target.closest('button[aria-label="Back to results"]');
      if (back) {
        event.preventDefault();
        window.history.pushState({}, '', initialUrl);
        window.document.querySelector('main').innerHTML = resultsMarkup;
      }
    });
  }
  window.eval(contentScript);
  let acknowledgement;
  onMessage(startMessage, {}, (value) => { acknowledgement = value; });
  assert.equal(acknowledgement?.ok, true, 'the content script should acknowledge the task immediately');
  let timeoutId;
  try {
    const result = await Promise.race([
      completed,
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('capture fixture timed out')), 12000); })
    ]);
    return { result, sent };
  } finally {
    clearTimeout(timeoutId);
    dom.window.close();
  }
}

test('simulates opening a Maps card, reading its detail and returning to results', async () => {
  const { result, sent } = await runFixture({
    body: '<main role="main">' + resultsMarkup + '</main>',
    simulateNavigation: true,
    startMessage: { type:'PROSPECTRA_CAPTURE_START',taskId:'fixture-success',mode:'visible',limit:1,minRating:0,searchTerm:'clínicas',city:'Guarulhos' }
  });
  assert.equal(result.ok,true);
  assert.equal(result.requested,1);
  assert.match(result.stopReason,/Quantidade solicitada atingida/);
  const batches=sent.filter((message)=>message.type==='PROSPECTRA_CAPTURE_BATCH');
  assert.equal(batches.length,1);
  assert.equal(batches[0].items[0].name,'Clínica Exemplo');
  assert.ok(batches[0].items[0].placeId);
  const checkpoint=sent.find((message)=>message.type==='PROSPECTRA_SAVE_CHECKPOINT' && message.checkpoint?.status==='completed');
  assert.ok(checkpoint,'successful capture should persist a completed checkpoint');
  assert.equal(checkpoint.checkpoint.lastPlaceName,'Clínica Exemplo');
});

test('stops safely when Maps presents a traffic verification screen', async () => {
  const { result, sent } = await runFixture({
    body:'<main><h1>Unusual traffic detected</h1><p>Our systems have detected unusual traffic from your computer network.</p></main>',
    startMessage:{type:'PROSPECTRA_CAPTURE_START',taskId:'fixture-blocked',mode:'visible',limit:5,minRating:0}
  });
  assert.equal(result.ok,false);
  assert.match(result.error,/verificação|limitação/i);
  assert.equal(sent.some((message)=>message.type==='PROSPECTRA_CAPTURE_BATCH'),false);
  assert.ok(sent.some((message)=>message.type==='PROSPECTRA_SAVE_CHECKPOINT' && message.checkpoint?.status==='interrupted'));
});


test('reports search results as ready before enabling visible collection', async () => {
  const dom=new JSDOM('<!doctype html><html><head><title>Maps readiness fixture</title></head><body><main role="main">'+resultsMarkup+'</main></body></html>',{
    url:'https://www.google.com/maps/search/clinicas+guarulhos',
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const {window}=dom;
  let listener=null;
  window.HTMLElement.prototype.getClientRects=function(){return [{width:240,height:60}];};
  window.chrome={runtime:{
    onMessage:{addListener(fn){listener=fn;}},
    sendMessage(){return Promise.resolve({ok:true});}
  }};
  window.eval(contentScript);
  let readiness=null;
  listener({type:'PROSPECTRA_MAPS_READINESS'},{},(value)=>{readiness=value;});
  assert.equal(readiness?.ok,true);
  assert.equal(readiness?.isMaps,true);
  assert.equal(readiness?.ready,true);
  assert.equal(readiness?.pageType,'search');
  assert.ok(readiness.businessLinks>0);
  dom.window.close();
});

test('recognizes an open Maps business detail separately from a search result list', async () => {
  const dom=new JSDOM('<!doctype html><html><head><title>Empresa Exemplo</title></head><body><main role="main"><h1>Empresa Exemplo</h1><button data-item-id="address">Rua das Flores, 10</button></main></body></html>',{
    url:'https://www.google.com/maps/place/Empresa+Exemplo/data=!4m2',
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const {window}=dom;
  let listener=null;
  window.HTMLElement.prototype.getClientRects=function(){return [{width:240,height:60}];};
  window.chrome={runtime:{
    onMessage:{addListener(fn){listener=fn;}},
    sendMessage(){return Promise.resolve({ok:true});}
  }};
  window.eval(contentScript);
  let readiness=null;
  listener({type:'PROSPECTRA_MAPS_READINESS'},{},(value)=>{readiness=value;});
  assert.equal(readiness?.ready,true);
  assert.equal(readiness?.pageType,'detail');
  assert.equal(readiness?.businessName,'Empresa Exemplo');
  dom.window.close();
});


test('recognizes valid business links on a Maps search route when feed roles are unavailable', async () => {
  const dom=new JSDOM('<!doctype html><html><head><title>Maps results without feed role</title></head><body><main><a href="https://www.google.com/maps/place/Empresa+Visivel"><span>Empresa Visível</span></a></main></body></html>',{
    url:'https://www.google.com/maps/search/?api=1&query=clinicas+guarulhos',
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const {window}=dom;
  let listener=null;
  window.HTMLElement.prototype.getClientRects=function(){return [];};
  window.chrome={runtime:{
    onMessage:{addListener(fn){listener=fn;}},
    sendMessage(){return Promise.resolve({ok:true});}
  }};
  window.eval(contentScript);
  let readiness=null;
  listener({type:'PROSPECTRA_MAPS_READINESS'},{},(value)=>{readiness=value;});
  assert.equal(readiness?.isMaps,true);
  assert.equal(readiness?.ready,true);
  assert.equal(readiness?.pageType,'search');
  assert.equal(readiness?.businessLinks,1);
  assert.equal(readiness?.visibleContainers,0);
  dom.window.close();
});
