import { buildWhatsAppUrl } from './contact-utils.js';

const encoder = new TextEncoder();
const xmlEscape = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const COLUMNS = [
  { key: 'name', title: 'Nome do lead', width: 34 },
  { key: 'category', title: 'Categoria do lead', width: 25 },
  { key: 'phone', title: 'Telefone', width: 22 },
  { key: 'whatsappUrl', title: 'WhatsApp (wa.me)', width: 32 },
  { key: 'address', title: 'Endereço', width: 42 },
  { key: 'website', title: 'Site da empresa', width: 34 },
  { key: 'hasWebsite', title: 'Tem site?', width: 13 },
  { key: 'emails', title: 'E-mails encontrados', width: 34 },
  { key: 'hasEmail', title: 'Tem e-mail?', width: 14 },
  { key: 'emailStatus', title: 'Status do e-mail', width: 21 },
  { key: 'rating', title: 'Avaliação', width: 13 },
  { key: 'reviewCount', title: 'Nº avaliações', width: 15 },
  { key: 'city', title: 'Cidade / região', width: 23 },
  { key: 'latitude', title: 'Latitude', width: 16 },
  { key: 'longitude', title: 'Longitude', width: 16 },
  { key: 'coordinatesSource', title: 'Origem das coordenadas', width: 26 },
  { key: 'searchTerm', title: 'Termo pesquisado', width: 26 },
  { key: 'mapsUrl', title: 'Google Maps', width: 38 },
  { key: 'collectedAt', title: 'Data da coleta', width: 22 }
];

function cellValue(row, key) {
  switch (key) {
    case 'whatsappUrl': return row.whatsappUrl || buildWhatsAppUrl(row.phone);
    case 'hasWebsite': return row.website ? 'Sim' : 'Não';
    case 'emails': return (row.emails || []).join(' | ');
    case 'hasEmail': return row.emails?.length ? 'Sim' : 'Não localizado';
    case 'emailStatus': return row.emails?.length ? 'Encontrado' : (row.emailStatus || (row.website ? 'Não localizado' : 'Sem site'));
    case 'rating': return row.rating || '';
    case 'reviewCount': return row.reviewCount || '';
    default: return row[key] || '';
  }
}

function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function buildSheet(rows) {
  const output = [];
  output.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  output.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  output.push('<sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
  output.push('<sheetFormatPr defaultRowHeight="19"/>');
  output.push('<cols>' + COLUMNS.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('') + '</cols>');
  output.push('<sheetData>');
  const header = COLUMNS.map((column, index) => `<c r="${columnName(index)}1" s="1" t="inlineStr"><is><t>${xmlEscape(column.title)}</t></is></c>`).join('');
  output.push(`<row r="1" ht="30" customHeight="1">${header}</row>`);
  rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    const alternate = rowIndex % 2 === 1;
    const cells = COLUMNS.map((column, colIndex) => {
      const value = cellValue(row, column.key);
      const ref = `${columnName(colIndex)}${excelRow}`;
      const baseStyle = alternate ? 3 : 2;
      if (column.key === 'rating' && value !== '' && Number.isFinite(Number(value))) {
        return `<c r="${ref}" s="5"><v>${Number(value)}</v></c>`;
      }
      if (column.key === 'reviewCount' && value !== '' && Number.isFinite(Number(value))) {
        return `<c r="${ref}" s="${alternate ? 6 : 4}"><v>${Number(value)}</v></c>`;
      }
      return `<c r="${ref}" s="${baseStyle}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    output.push(`<row r="${excelRow}" ht="22" customHeight="1">${cells}</row>`);
  });
  output.push('</sheetData>');
  output.push(`<autoFilter ref="A1:${columnName(COLUMNS.length - 1)}${Math.max(1, rows.length + 1)}"/>`);
  output.push('<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>');
  output.push('</worksheet>');
  return output.join('');
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos Display"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD7E1EC"/></left><right style="thin"><color rgb="FFD7E1EC"/></right><top/><bottom style="thin"><color rgb="FFD7E1EC"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Leads Prospectra" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`;
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true); local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46); centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function createXlsx(rows) {
  const files = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', WORKBOOK],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES_XML],
    ['xl/worksheets/sheet1.xml', buildSheet(rows)]
  ];
  return makeZip(files);
}
