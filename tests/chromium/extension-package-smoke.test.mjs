import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const chromePath=process.env.CHROME_BIN;
const extensionDir=process.env.EXTENSION_DIR;
if(!chromePath) throw new Error('CHROME_BIN não foi configurado.');
if(!extensionDir) throw new Error('EXTENSION_DIR não foi configurado.');

test('installs and opens the packaged Prospectra extension in a clean Chrome profile', async () => {
  const browser=await puppeteer.launch({
    executablePath:chromePath,
    headless:false,
    args:[
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions-except='+extensionDir,
      '--load-extension='+extensionDir
    ]
  });
  const pageErrors=[];
  try {
    const workerTarget=await browser.waitForTarget(
      (target)=>target.type()==='service_worker' && target.url().startsWith('chrome-extension://'),
      {timeout:15000}
    );
    const extensionId=new URL(workerTarget.url()).hostname;
    assert.match(extensionId,/^[a-p]{32}$/,'O Chrome deve registrar um ID de extensão válido.');

    const page=await browser.newPage();
    page.on('pageerror',(error)=>pageErrors.push(error.message));
    await page.goto('chrome-extension://'+extensionId+'/sidepanel.html',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.app-shell',{timeout:10000});
    await page.waitForSelector('#statusMessage',{timeout:10000});

    const app=await page.evaluate(()=>{
      const manifest=chrome.runtime.getManifest();
      return {
        name:manifest.name,
        version:manifest.version,
        manifestVersion:manifest.manifest_version,
        title:document.title,
        navTabs:Array.from(document.querySelectorAll('[data-view-target]')).map((node)=>node.dataset.viewTarget)
      };
    });
    assert.equal(app.version,'2.0.0');
    assert.equal(app.manifestVersion,3);
    assert.match(app.name,/Prospectra/);
    assert.match(app.title,/Prospectra/);
    assert.deepEqual(app.navTabs,['overview','leads','pipeline','research','settings']);

    await page.click('[data-view-target="leads"]');
    await page.waitForFunction(()=>document.querySelector('[data-view="leads"]')?.classList.contains('active'));
    assert.deepEqual(pageErrors,[],'A página empacotada não deve lançar erros JavaScript.');
  } finally {
    await browser.close();
  }
});
