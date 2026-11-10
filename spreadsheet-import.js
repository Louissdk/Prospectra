const decodeXml = (value = '') => String(value)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));

function attr(attributes, name) {
  const match = String(attributes || '').match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"', 'i'));
  return match?.[1] || '';
}
function columnIndex(reference = '') {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let index = 0;
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}
async function inflateZipEntry(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('Este arquivo XLSX usa um método de compactação não suportado.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Este Chrome não oferece descompactação nativa para abrir XLSX.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function readZipEntries(input) {
  const bytes = new Uint8Array(input);
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error('O arquivo XLSX excede o limite de 25 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  let endOffset = -1;
  const lowerBound = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (u32(offset) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error('Arquivo ZIP/XLSX inválido: diretório central não encontrado.');
  const entryCount = u16(endOffset + 10);
  let cursor = u32(endOffset + 16);
  const entries = new Map();
  const decoder = new TextDecoder();
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(cursor) !== 0x02014b50) throw new Error('Estrutura ZIP inválida ao ler o diretório central.');
    const flags = u16(cursor + 8);
    const method = u16(cursor + 10);
    const compressedSize = u32(cursor + 20);
    const uncompressedSize = u32(cursor + 24);
    totalUncompressed += uncompressedSize;
    if (uncompressedSize > 40 * 1024 * 1024 || totalUncompressed > 80 * 1024 * 1024) {
      throw new Error('O XLSX excede o limite de expansão segura para importação.');
    }
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const localOffset = u32(cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith('/')) continue;
    if (flags & 1) throw new Error('O arquivo XLSX está protegido por senha. Remova a proteção antes de importar.');
    if (u32(localOffset) !== 0x04034b50) throw new Error('Cabeçalho ZIP local inválido.');
    const localNameLength = u16(localOffset + 26);
    const localExtraLength = u16(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) throw new Error('Arquivo XLSX incompleto ou corrompido.');
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    entries.set(name, await inflateZipEntry(compressed, method));
  }
  return entries;
}
function resolveWorkbookTarget(target = '') {
  if (!target) return 'xl/worksheets/sheet1.xml';
  const normalized = target.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return normalized.replace(/^\/+/, '');
  const parts = ['xl', ...normalized.split('/')];
  const output = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') output.pop();
    else output.push(part);
  }
  return output.join('/');
}
function parseSharedStrings(xml = '') {
  const values = [];
  for (const match of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const runs = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => decodeXml(item[1]));
    values.push(runs.join(''));
  }
  return values;
}
function parseWorksheet(xml = '', sharedStrings = []) {
  const rows = [];
  for (const rowMatch of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells = [];
    let sequentialIndex = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attributes = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const type = attr(attributes, 't');
      const reference = attr(attributes, 'r');
      const index = reference ? columnIndex(reference) : sequentialIndex;
      sequentialIndex = index + 1;
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => decodeXml(item[1])).join('');
      } else {
        const raw = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i) || [])[1] || '';
        if (type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else value = decodeXml(raw);
      }
      cells[index] = value;
    }
    rows.push(cells.map((value) => value ?? ''));
  }
  return rows;
}
export async function parseXlsxRows(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Arquivo XLSX inválido.');
  const entries = await readZipEntries(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const readText = (path) => entries.has(path) ? decoder.decode(entries.get(path)) : '';
  const workbook = readText('xl/workbook.xml');
  const relationships = readText('xl/_rels/workbook.xml.rels');
  let worksheetPath = 'xl/worksheets/sheet1.xml';
  const sheetMatch = workbook.match(/<sheet\b([^>]*)\/?>/i);
  const relationshipId = attr(sheetMatch?.[1] || '', 'r:id');
  if (relationshipId) {
    for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
      if (attr(match[1], 'Id') === relationshipId) {
        worksheetPath = resolveWorkbookTarget(attr(match[1], 'Target'));
        break;
      }
    }
  }
  const worksheet = readText(worksheetPath);
  if (!worksheet) throw new Error('Nenhuma planilha legível foi encontrada no arquivo XLSX.');
  const sharedStrings = parseSharedStrings(readText('xl/sharedStrings.xml'));
  const rows = parseWorksheet(worksheet, sharedStrings);
  if (!rows.length) throw new Error('A primeira planilha XLSX está vazia.');
  return rows;
}
