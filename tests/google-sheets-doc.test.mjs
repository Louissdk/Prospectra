import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const docs = await readFile(new URL('../docs/integrations/google-sheets.md', import.meta.url), 'utf8');

function getAppsScriptSource() {
  const match = docs.match(/~~~javascript\n([\s\S]*?)\n~~~/);
  assert.ok(match, 'O exemplo completo do Apps Script deve existir.');
  return match[1];
}

test('Google Sheets template exports exact coordinates and protects against formula injection', () => {
  assert.match(docs,/'Latitude', 'Longitude', 'Origem das coordenadas'/);
  assert.match(docs,/lead\.latitude \?\? ''/);
  assert.match(docs,/lead\.longitude \?\? ''/);
  assert.match(docs,/row\.map\(safeCell\)/);
  assert.match(docs,/return \/\^\[\\s\]\*\[=\+\\-@\]\/\.test\(value\)/);
});

test('Apps Script expands narrow sheets and neutralizes formula-like strings', () => {
  assert.ok(docs.includes('sheet.getMaxColumns() < headers.length'));
  assert.ok(docs.includes('sheet.insertColumnsAfter(sheet.getMaxColumns()'));
  assert.match(docs,/return \/\^\[\\s\]\*\[=\+\\-@\]\/\.test\(value\)/);
});

test('Google Sheets integration receives deletion tombstones and removes them by identity', async () => {
  const panel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
  assert.match(panel,/deletedLeadKeys:deletedBatch/);
  assert.match(panel,/const deletions=Array\.isArray\(state\.deletedLeadKeys\)/);
  assert.match(docs,/const deletedLeadKeys = payload\.deletedLeadKeys/);
  assert.match(docs,/byIdentity\.delete\(identityKey\)/);
  assert.match(docs,/deleted: deletedLeadKeys\.length/);
});

test('Apps Script is valid JavaScript and authenticates before taking the shared lock', () => {
  const source=getAppsScriptSource();
  assert.doesNotThrow(() => new vm.Script(source), 'O Apps Script deve ter sintaxe JavaScript válida.');
  assert.match(source,/LockService\.getScriptLock\(\)/);
  assert.match(source,/lock\.waitLock\(30000\)/);
  assert.match(source,/lock\.releaseLock\(\)/);
  const actionCheck=source.indexOf("if (payload.action !== 'upsert')");
  const tokenCheck=source.indexOf("if (!expected || received !== expected)");
  const lockWait=source.indexOf("lock.waitLock(30000)");
  assert.ok(actionCheck>=0 && tokenCheck>actionCheck && lockWait>tokenCheck);
});

test('Apps Script validates credentials before using the lock and safely upserts/deletes sheet rows', () => {
  const source=getAppsScriptSource();
  const rows=[];
  let lockWaits=0;
  let lockReleases=0;
  let spreadsheetLookups=0;
  const sheet={
    getMaxColumns(){return 28;},
    insertColumnsAfter(){},
    getLastRow(){return rows.length;},
    getRange(row,column,numRows,numColumns){
      return {
        getValues(){
          return Array.from({length:numRows},(_,r)=>Array.from({length:numColumns},(_,c)=>rows[row-1+r]?.[column-1+c]??''));
        },
        setValues(values){
          values.forEach((valuesRow,r)=>{rows[row-1+r]=valuesRow.slice();});
          return this;
        },
        setFontWeight(){return this;},
        setBackground(){return this;},
        setFontColor(){return this;}
      };
    },
    clearContents(){rows.length=0;},
    setFrozenRows(){},
    autoResizeColumns(){}
  };
  const context=vm.createContext({
    LockService:{
      getScriptLock(){return {
        waitLock(){lockWaits+=1;},
        releaseLock(){lockReleases+=1;}
      };}
    },
    PropertiesService:{getScriptProperties(){return {getProperty(name){return name==='PROSPECTRA_TOKEN'?'test-token':'';}};}},
    SpreadsheetApp:{flush(){},getActiveSpreadsheet(){
      spreadsheetLookups+=1;
      return {
        getSheetByName(name){return name==='Prospectra Leads'?sheet:null;},
        insertSheet(){return sheet;}
      };
    }},
    ContentService:{
      MimeType:{JSON:'application/json'},
      createTextOutput(value){return {text:String(value),setMimeType(){return this;}};}
    },
    console
  });
  new vm.Script(source).runInContext(context);
  const call=(payload)=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(payload)}}).text);

  const rejected=call({action:'upsert',token:'wrong',leads:[],deletedLeadKeys:[]});
  assert.equal(rejected.ok,false);
  assert.equal(lockWaits,0);
  assert.equal(spreadsheetLookups,0);

  const inserted=call({
    action:'upsert',token:'test-token',leads:[{
      id:'lead-1',identityKey:'place:ChIJ-1',name:'=SUM(1,1)',category:'Serviço',
      phones:[],emails:[],tags:[],socialProfiles:{}
    }],deletedLeadKeys:[]
  });
  assert.equal(inserted.ok,true);
  assert.equal(inserted.received,1);
  assert.equal(inserted.total,1);
  assert.equal(rows.length,2);
  assert.equal(rows[1][2],"'=SUM(1,1)");

  const updated=call({
    action:'upsert',token:'test-token',leads:[{
      id:'lead-1',identityKey:'place:ChIJ-1',name:'Empresa Atualizada',
      phones:[],emails:[],tags:[],socialProfiles:{}
    }],deletedLeadKeys:[]
  });
  assert.equal(updated.ok,true);
  assert.equal(updated.total,1);
  assert.equal(rows.length,2);
  assert.equal(rows[1][2],'Empresa Atualizada');

  const deleted=call({
    action:'upsert',token:'test-token',leads:[],
    deletedLeadKeys:[{identityKey:'place:ChIJ-1'}]
  });
  assert.equal(deleted.ok,true);
  assert.equal(deleted.deleted,1);
  assert.equal(deleted.total,0);
  assert.equal(rows.length,1);
  assert.equal(lockWaits,3);
  assert.equal(lockReleases,3);
});
