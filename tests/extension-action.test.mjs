import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));

test('clicking the toolbar icon opens Google Maps and the Prospectra side panel',()=>{
  assert.match(worker,/chrome\.action\?\.onClicked\?\.addListener/);
  assert.match(worker,/chrome\.sidePanel\.open\(\{ windowId: tab\.windowId \}\)/);
  assert.match(worker,/chrome\.tabs\.create\(\{ url: 'https:\/\/www\.google\.com\/maps', active: true \}\)/);
  assert.ok(worker.indexOf('chrome.sidePanel.open({ windowId: tab.windowId })') < worker.indexOf("chrome.tabs.create({ url: 'https://www.google.com/maps'"));
  assert.match(worker,/openPanelOnActionClick: false/);
});

test('the refreshed toolbar icon uses the dedicated Prospectra action assets',()=>{
  assert.equal(manifest.action.default_icon['16'],'icons/icon16.png');
  assert.equal(manifest.action.default_icon['32'],'icons/icon32.png');
});
