import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQueueOutcome, summarizeQueueOutcomes } from '../queue-utils.js';

test('classifies complete, partial and interrupted queue items', () => {
  assert.equal(classifyQueueOutcome({requested:50,collected:50,stopReason:'Quantidade solicitada atingida.'}),'done');
  assert.equal(classifyQueueOutcome({requested:50,collected:23,stopReason:'O Maps não apresentou novos cartões.'}),'partial');
  assert.equal(classifyQueueOutcome({requested:50,collected:8,stopReason:'Coleta cancelada pelo usuário.'}),'interrupted');
  assert.equal(classifyQueueOutcome({error:'Falha ao ler a tabela.'}),'failed');
});
test('summarizes all queue outcomes without reporting a false success', () => {
  assert.deepEqual(summarizeQueueOutcomes(['done','done','partial','interrupted','failed']),{
    total:5,done:2,partial:1,interrupted:1,failed:1
  });
});
test('does not classify unlimited available-results searches as partial', () => {
  assert.equal(classifyQueueOutcome({requested:0,collected:87,stopReason:'A lista não apresentou novos cartões.'}),'done');
});
