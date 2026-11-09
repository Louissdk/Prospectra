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
    assert.match(String(lead.phone),/11999999999/);
    const checkpoint=result.messages.find((message)=>message.type==='PROSPECTRA_SAVE_CHECKPOINT' && message.checkpoint?.status==='completed');
    assert.ok(checkpoint,'the completed capture should persist its checkpoint');
  } finally {
    await browser.close();
  }
});
