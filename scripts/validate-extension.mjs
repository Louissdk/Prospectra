import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = async (path) => {
  try { await access(path, constants.R_OK); return true; } catch { return false; }
};
const errors = [];
const manifest = await readJson('manifest.json');
const pkg = await readJson('package.json');
const html = await readFile('sidepanel.html', 'utf8');
const styles = await readFile('sidepanel.css', 'utf8');
const sidepanel = await readFile('sidepanel.js', 'utf8');
const worker = await readFile('service-worker.js', 'utf8');

if (!pkg.devDependencies?.['fake-indexeddb']) errors.push('fake-indexeddb deve estar listado nas dependências de desenvolvimento para testar o banco local.');
if (!(await exists('tests/db-indexeddb.test.mjs'))) errors.push('Teste de persistência IndexedDB ausente.');
if (manifest.manifest_version !== 3) errors.push('A extensão precisa usar Manifest V3.');
if (manifest.version !== pkg.version) errors.push('A versão do package.json deve ser igual à versão do manifest.json.');
if (!manifest.background?.service_worker || manifest.background.type !== 'module') errors.push('Service worker ES module não configurado.');
if (!manifest.side_panel?.default_path) errors.push('Painel lateral não configurado.');
if (!manifest.permissions?.includes('storage')) errors.push('Permissão storage ausente.');
if (!/color-scheme:\s*light/i.test(styles)) errors.push('A interface precisa usar o esquema claro da identidade visual.');
for (const [name, color] of Object.entries({verde:'#018D3E',creme:'#FDF7E6',vermelho:'#E71506'})) {
  if (!styles.toUpperCase().includes(color)) errors.push('Cor institucional ausente no CSS: '+name+' '+color);
}
if (!/name="theme-color"\s+content="#FDF7E6"/i.test(html)) errors.push('A cor de tema do painel deve usar o creme institucional #FDF7E6.');
if (!manifest.optional_permissions?.includes('notifications') || !manifest.optional_permissions?.includes('alarms')) errors.push('Permissões opcionais de lembrete ausentes.');
if ((worker.match(/chrome\.runtime\.onMessage\.addListener/g) || []).length !== 1) errors.push('Esperado exatamente um listener principal no service worker.');

const requiredFiles = [
  'content.js','service-worker.js','sidepanel.js','sidepanel.html','sidepanel.css',
  'db.js','crm-utils.js','capture-utils.js','checkpoint-utils.js','contact-utils.js','cloud-utils.js','permission-utils.js','queue-utils.js','sync-utils.js','geo-utils.js','workbook.js','spreadsheet-import.js',
  'PRIVACY.md','LICENSE.md','CHANGELOG.md','README.md'
];
for (const file of requiredFiles) if (!(await exists(file))) errors.push('Arquivo obrigatório ausente: ' + file);

for (const [size, file] of Object.entries(manifest.icons || {})) {
  if (!(await exists(file))) {
    errors.push('Ícone ' + size + ' não encontrado: ' + file);
    continue;
  }
  if (String(file).toLowerCase().endsWith('.png')) {
    const icon = await readFile(file);
    const signature = icon.subarray(0, 8).toString('hex');
    if (signature !== '89504e470d0a1a0a') errors.push('Ícone PNG inválido: ' + file);
    else if (icon.readUInt32BE(16) !== Number(size) || icon.readUInt32BE(20) !== Number(size)) {
      errors.push('Dimensão do ícone ' + file + ' não corresponde a ' + size + 'x' + size + '.');
    }
  }
}
if (!(await exists(manifest.action?.default_icon || 'icons/icon48.png')) && manifest.action?.default_icon) {
  errors.push('Ícone padrão da ação não encontrado.');
}
if (!(await exists(manifest.side_panel.default_path))) errors.push('Arquivo do painel lateral não encontrado.');
if (!(await exists(manifest.background.service_worker))) errors.push('Service worker referenciado no manifest não encontrado.');

const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
const selectors = [...sidepanel.matchAll(/\$\(['"]#([A-Za-z][\w-]*)['"]\)/g)].map((match) => match[1]);
const runtimeGeneratedIds = new Set(['footerVersion','showMoreButton']);
const missing = [...new Set(selectors)].filter((id) => !htmlIds.has(id) && !runtimeGeneratedIds.has(id));
for (const id of missing) errors.push('O sidepanel.js referencia #'+id+' mas o elemento não existe no sidepanel.html.');

for (const file of ['content.js','service-worker.js','sidepanel.js','db.js','crm-utils.js','capture-utils.js','checkpoint-utils.js','cloud-utils.js','permission-utils.js','queue-utils.js','sync-utils.js','geo-utils.js']) {
  const source = await readFile(file, 'utf8');
  if (/service_role/i.test(source)) errors.push('Possível segredo service_role encontrado no código executável: '+file);
}

const readme = await readFile('README.md','utf8');
for (const localPath of ['docs/assets/banner.svg','docs/assets/interface-preview.svg','docs/IDENTIDADE-VISUAL.md','docs/GUIA-RAPIDO.md','docs/ARQUITETURA.md','docs/SOLUCAO-DE-PROBLEMAS.md','docs/PRIVACIDADE-E-LGPD.md','docs/integrations/google-sheets.md','docs/integrations/supabase.md','docs/supabase/schema.sql','docs/ROADMAP.md','docs/MATERIAIS-COMERCIAIS.md','docs/RELEASE-CHECKLIST.md']) {
  if (!(await exists(localPath))) errors.push('Documento/asset referenciado no README ausente: '+localPath);
}

if (errors.length) {
  console.error('Validação Prospectra: FALHOU');
  for (const error of errors) console.error(' - '+error);
  process.exitCode = 1;
} else {
  console.log('Validação Prospectra: OK');
  console.log('- Manifest V3, versão '+manifest.version);
  console.log('- Arquivos essenciais e ícones presentes');
  console.log('- IDs da interface conferidos');
  console.log('- Listener único no service worker');
  console.log('- Documentação e assets do README presentes');
}
