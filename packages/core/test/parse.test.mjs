import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, toRecord, setVar, unsetVar, formatValue, diffEnv } from '../dist/index.js';

test('parses dotenv syntax', () => {
  const text = [
    '# comment',
    'A=1',
    'export B = two',
    'C="multi',
    'line"',
    "D='literal \\n'",
    'E=value # trailing comment',
    'F="esc\\nnl"',
    'G=',
    'A=override',
    '# H=commented',
  ].join('\n');
  assert.deepEqual(toRecord(text), {
    A: 'override',
    B: 'two',
    C: 'multi\nline',
    D: 'literal \\n',
    E: 'value',
    F: 'esc\nnl',
    G: '',
  });
  const c = parseEnv(text).find((e) => e.key === 'C');
  assert.equal(c.start, 3);
  assert.equal(c.end, 4);
});

test('setVar edits in place and preserves comments', () => {
  const text = '# db\nDB=a\nC="x\ny"\n';
  assert.equal(setVar(text, 'DB', 'b'), '# db\nDB=b\nC="x\ny"\n');
  assert.equal(setVar(text, 'C', 'z'), '# db\nDB=a\nC=z\n');
  assert.equal(setVar(text, 'NEW', 'has space'), "# db\nDB=a\nC=\"x\ny\"\nNEW='has space'\n");
  assert.equal(setVar('', 'K', 'v'), 'K=v\n');
  assert.equal(unsetVar(text, 'C'), '# db\nDB=a\n');
});

test('preserves CRLF line endings', () => {
  assert.equal(setVar('A=1\r\nB=2\r\n', 'A', '3'), 'A=3\r\nB=2\r\n');
});

test('formatValue round-trips', () => {
  for (const v of ['plain', 'with space', "it's", 'say "hi"', 'line1\nline2', 'a#b', '', 'postgres://u:p@h:5432/db?x=1']) {
    assert.equal(toRecord(`K=${formatValue(v)}`).K, v, `value ${JSON.stringify(v)}`);
  }
});

test('diffEnv', () => {
  assert.deepEqual(diffEnv('A=1\nB=2\nC=3', 'A=1\nB=9\nD=4'), {
    added: ['D'],
    removed: ['C'],
    changed: ['B'],
    unchanged: ['A'],
  });
});
