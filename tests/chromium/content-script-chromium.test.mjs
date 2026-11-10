import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const chromePath = process.env.CHROME_BIN;
if (!chromePath) throw new Error('CHROME_BIN não foi configurado pelo job chromium-e2e.');

const contentScript = await readFile(new URL('../../content.js', import.meta.url), 'utf8');

test('runs the actual content script in Chromium and captures a Maps detail with exact coordinates', async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    const mapUrl = 'https://www.google.com/maps/place/Empresa+Teste/data=!3m1!1sChIJTESTPLACE123!3d-23.55052!4d-46.633308';
    const fixture = `<!doctype html>
      <html lang="pt-BR"><head><meta charset="utf-8"><title>Maps fixture Chromium</title></head>
      <body><main role="main">
        <h1>Empresa Teste Chromium</h1>
        <button data-item-id="address" aria-label="Endereço: Avenida Paulista, 100, Bela Vista, São Paulo - SP">Avenida Paulista, 100, Bela Vista, São Paulo - SP</button>
        <button data-item-id="phone:tel:+5511999999999" aria-label="Telefone: +55 11 99999-9999">+55 11 99999-9999</button>
        <a data-item-id="authority" aria-label="Website" href="https://empresa-teste.example/">Site oficial</a>
        <button jsaction="category">Escritório empresarial</button>
        <div>4,8 · 120 avaliações</div>
      </main></body></html>`;

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.url().startsWith('https://www.google.com/maps/')) {
        request.respond({status:200,contentType:'text/html; charset=utf-8',body:fixture}).catch(()=>{});
      } else {
        request.abort().catch(()=>{});
      }
    });
    await page.goto(mapUrl,{waitUntil:'domcontentloaded'});
    await page.evaluate(() => {
      window.__prospectraMessages = [];
      window.__prospectraListener = null;
      window.chrome = window.chrome || {};
      window.chrome.runtime = {
        onMessage: {
          addListener(handler) { window.__prospectraListener = handler; }
        },
        sendMessage(message) {
          window.__prospectraMessages.push(message);
          if (message.type === 'PROSPECTRA_CAPTURE_BATCH') {
            return Promise.resolve({ok:true,saved:message.items?.length||0,total:message.items?.length||0});
          }
          return Promise.resolve({ok:true});
        }
      };
    });
    await page.addScriptTag({content:contentScript});
    const result = await page.evaluate(() => new Promise((resolve,reject) => {
      const listener = window.__prospectraListener;
      if (typeof listener !== 'function') {
        reject(new Error('O content script não registrou chrome.runtime.onMessage.'));
        return;
      }
      const timer = setTimeout(() => reject(new Error('A captura não terminou dentro do prazo do teste.')),10000);
      const originalSendMessage = window.chrome.runtime.sendMessage;
      window.chrome.runtime.sendMessage = (message) => {
        const pending = originalSendMessage(message);
        if (message.type === 'PROSPECTRA_CAPTURE_COMPLETE') {
          pending.then(() => {
            clearTimeout(timer);
            resolve({
              acknowledgement: window.__prospectraAcknowledgement,
              completion: message,
              messages: window.__prospectraMessages
            });
          },reject);
        }
        return pending;
      };
      listener({
        type:'PROSPECTRA_CAPTURE_START',
        taskId:'chromium-open-business',
        mode:'open',
        searchTerm:'escritório',
        city:'São Paulo',
        minRating:0
      },{},(ack) => { window.__prospectraAcknowledgement = ack; });
    }));
    assert.equal(result.acknowledgement?.ok,true);
    assert.equal(result.completion.ok,true);
    const batch=result.messages.find((message)=>message.type==='PROSPECTRA_CAPTURE_BATCH');
    assert.ok(batch,'a real Chromium page should send a persisted lead batch');
    assert.equal(batch.items.length,1);
    const lead=batch.items[0];
    assert.equal(lead.name,'Empresa Teste Chromium');
    assert.equal(lead.latitude,-23.55052);
    assert.equal(lead.longitude,-46.633308);
    assert.equal(lead.coordinatesSource,'google_maps_place_url');
    assert.equal(lead.website,'https://empresa-teste.example/');
    assert.equal(String(lead.phone).replace(/\D/g,''),'5511999999999');
    const checkpoint=result.messages.find((message)=>message.type==='PROSPECTRA_SAVE_CHECKPOINT' && message.checkpoint?.status==='completed');
    assert.ok(checkpoint,'the completed capture should persist its checkpoint');
  } finally {
    await browser.close();
  }
});


test('captures a visible result card in Chromium, opens the detail and returns to results', async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    const searchUrl = 'https://www.google.com/maps/search/escritorios+guarulhos';
    const detailUrl = 'https://www.google.com/maps/place/Empresa+Lista/data=!1sChIJVISIBLE12345!3d-23.4601!4d-46.5302';
    const resultsMarkup = `<div id="results" role="feed" aria-label="Resultados da pesquisa" style="height:420px;overflow:auto">
      <div role="article">
        <a href="${detailUrl}"><h3>Empresa Lista</h3><span aria-label="4.7 stars"></span><div>Escritório empresarial · Rua das Acácias, 50, Guarulhos</div></a>
      </div>
    </div>`;
    const detailMarkup = `<button aria-label="Back to results">Voltar para resultados</button>
      <h1>Empresa Lista</h1>
      <button data-item-id="address" aria-label="Endereço: Rua das Acácias, 50, Guarulhos - SP">Rua das Acácias, 50, Guarulhos - SP</button>
      <button data-item-id="phone:tel:+551132223333" aria-label="Telefone: +55 11 3222-3333">+55 11 3222-3333</button>
      <a data-item-id="authority" href="https://empresa-lista.example/">Site oficial</a>
      <button jsaction="category">Escritório empresarial</button><div>4,7 · 84 avaliações</div>`;
    const fixture = (markup) => '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Maps search fixture</title></head><body><main role="main">'+markup+'</main></body></html>';
    await page.setRequestInterception(true);
    page.on('request',(request)=>{
      if(request.isNavigationRequest() && request.url().startsWith('https://www.google.com/maps/')) {
        request.respond({status:200,contentType:'text/html; charset=utf-8',body:fixture(resultsMarkup)}).catch(()=>{});
      } else request.abort().catch(()=>{});
    });
    await page.goto(searchUrl,{waitUntil:'domcontentloaded'});
    await page.evaluate(({detailMarkup,searchUrl})=>{
      document.addEventListener('click',(event)=>{
        const anchor=event.target.closest('a[href*="/maps/place/"]');
        if(anchor) {
          event.preventDefault();
          history.pushState({},'',anchor.href);
          document.querySelector('main').innerHTML=detailMarkup;
          return;
        }
        const back=event.target.closest('button[aria-label="Back to results"]');
        if(back) {
          event.preventDefault();
          history.pushState({},'',searchUrl);
          document.querySelector('main').innerHTML=window.__resultsMarkup;
        }
      });
      window.__resultsMarkup=document.querySelector('main').innerHTML;
      window.__prospectraMessages=[];
      window.__prospectraListener=null;
      window.chrome=window.chrome||{};
      window.chrome.runtime={
        onMessage:{addListener(handler){window.__prospectraListener=handler;}},
        sendMessage(message){
          window.__prospectraMessages.push(message);
          if(message.type==='PROSPECTRA_CAPTURE_BATCH') return Promise.resolve({ok:true,saved:message.items?.length||0,total:message.items?.length||0});
          return Promise.resolve({ok:true});
        }
      };
    },{detailMarkup,searchUrl});
    await page.addScriptTag({content:contentScript});
    const result=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const listener=window.__prospectraListener;
      if(typeof listener!=='function') return reject(new Error('Listener do content script não registrado.'));
      const timer=setTimeout(()=>reject(new Error('A coleta visível excedeu o prazo do teste Chromium.')),15000);
      const original=window.chrome.runtime.sendMessage;
      window.chrome.runtime.sendMessage=(message)=>{
        const pending=original(message);
        if(message.type==='PROSPECTRA_CAPTURE_COMPLETE') {
          pending.then(()=>{clearTimeout(timer);resolve({completion:message,messages:window.__prospectraMessages});},reject);
        }
        return pending;
      };
      listener({
        type:'PROSPECTRA_CAPTURE_START',taskId:'chromium-visible-capture',
        mode:'visible',limit:1,minRating:0,searchTerm:'escritórios',city:'Guarulhos'
      },{},(ack)=>{window.__prospectraAcknowledgement=ack;});
    }));
    assert.equal(result.completion.ok,true);
    const batch=result.messages.find((message)=>message.type==='PROSPECTRA_CAPTURE_BATCH');
    assert.ok(batch,'the result card should be persisted');
    assert.equal(batch.items.length,1);
    assert.equal(batch.items[0].name,'Empresa Lista');
    assert.equal(batch.items[0].rating,'4.7');
    assert.equal(batch.items[0].placeId,'ChIJVISIBLE12345');
    assert.match(batch.items[0].mapsUrl,/maps\/place\/Empresa\+Lista/);
    assert.ok(result.messages.some((message)=>message.type==='PROSPECTRA_PROGRESS'));
  } finally {
    await browser.close();
  }
});
