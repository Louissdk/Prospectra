import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const palette = ['#018D3E', '#FDF7E6', '#E71506'];

test('applies the approved three-color identity to the extension interface', async () => {
  const css = await readFile(new URL('../sidepanel.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
  assert.match(css, /color-scheme:\s*light/i);
  assert.match(css, /--bg:\s*#FDF7E6/i);
  assert.match(css, /--blue:\s*#018D3E/i);
  assert.match(css, /--red:\s*#E71506/i);
  assert.match(html, /name="theme-color"\s+content="#FDF7E6"/i);
  assert.doesNotMatch(css, /#(?:73aaff|72dec9|6ed8ae|6ea8fa|ff8792|f1c477)\b/i);
});

test('keeps banner, preview and vector mark within the approved palette', async () => {
  for (const file of ['../docs/assets/banner.svg','../docs/assets/interface-preview.svg','../icons/prospectra-logo.svg']) {
    const svg = await readFile(new URL(file, import.meta.url), 'utf8');
    for (const color of palette) assert.ok(svg.toUpperCase().includes(color), file + ' is missing ' + color);
    assert.doesNotMatch(svg, /#(?:73aaff|72dec9|6ed8ae|6ca8f7|71d7c7|74b3fc|77b2fb|091321|12253f|4684cf)\b/i, file + ' still contains legacy accent colors');
  }
});

test('ships valid PNG icons in all Manifest V3 sizes', async () => {
  for (const size of [16,32,48,128]) {
    const png = await readFile(new URL('../icons/icon' + size + '.png', import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a', 'icon ' + size + ' PNG signature');
    assert.equal(png.readUInt32BE(16),size,'icon ' + size + ' width');
    assert.equal(png.readUInt32BE(20),size,'icon ' + size + ' height');
  }
});
