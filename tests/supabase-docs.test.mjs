import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guide = await readFile(new URL('../docs/integrations/supabase.md', import.meta.url), 'utf8');
const privacy = await readFile(new URL('../PRIVACY.md', import.meta.url), 'utf8');

test('Supabase guide explains current Data API grants and schema exposure', () => {
  assert.match(guide,/Data API/i);
  assert.match(guide,/schema \`public\`/i);
  assert.match(guide,/grant select, insert, update, delete on public\.prospectra_leads to authenticated/i);
  assert.match(guide,/notify pgrst, 'reload schema'/i);
  assert.match(guide,/Não conceda acesso à role \`anon\`/i);
});

test('privacy policy describes Supabase and Sheets deletions consistently', () => {
  assert.match(privacy,/marcadores lógicos de exclusão/);
  assert.match(privacy,/coluna \`deleted_at\`/);
  assert.match(privacy,/removidas da aba gerenciada pelo Apps Script/);
  assert.doesNotMatch(privacy,/não propaga exclusões/i);
  assert.doesNotMatch(privacy,/não possui exclusão remota automática/i);
  assert.doesNotMatch(privacy,/deleted_at\),/);
});
