import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../docs/supabase/schema.sql', import.meta.url), 'utf8');

test('Supabase schema supports soft deletion for existing and new projects', () => {
  assert.match(schema,/deleted_at timestamptz/i);
  assert.match(schema,/add column if not exists deleted_at timestamptz/i);
  assert.match(schema,/prospectra_leads_user_deleted_idx/i);
});
test('Supabase schema keeps user isolation and identity uniqueness', () => {
  assert.match(schema,/enable row level security/i);
  assert.match(schema,/auth\.uid\(\) = user_id/i);
  assert.match(schema,/prospectra_leads_user_identity_uidx/i);
});
