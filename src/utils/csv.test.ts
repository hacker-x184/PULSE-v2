import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCsvCell, generateCsv } from './csv.ts';

test('sanitizeCsvCell escapes quotes and wraps in quotes when comma or newline is present', () => {
  assert.equal(sanitizeCsvCell('Hello World'), 'Hello World');
  assert.equal(sanitizeCsvCell('Hello, World'), '"Hello, World"');
  assert.equal(sanitizeCsvCell('He said "Hi"'), '"He said ""Hi"""');
  assert.equal(sanitizeCsvCell('Line 1\nLine 2'), '"Line 1\nLine 2"');
});

test('sanitizeCsvCell guards against spreadsheet formula injection', () => {
  assert.equal(sanitizeCsvCell('=1+1'), "'=1+1");
  assert.equal(sanitizeCsvCell('+cmd|...'), "'+cmd|...");
  assert.equal(sanitizeCsvCell('@SUM(A1:A10)'), "'@SUM(A1:A10)");
});

test('generateCsv formats standard RFC 4180 rows', () => {
  const headers = ['Task ID', 'Title', 'Priority', 'Status'];
  const rows = [
    ['T-101', 'Setup Database', 'High', 'Done'],
    ['T-102', 'Write Tests, Mocks', 'Medium', 'In Progress'],
  ];

  const csv = generateCsv(headers, rows);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'Task ID,Title,Priority,Status');
  assert.equal(lines[1], 'T-101,Setup Database,High,Done');
  assert.equal(lines[2], 'T-102,"Write Tests, Mocks",Medium,In Progress');
});
