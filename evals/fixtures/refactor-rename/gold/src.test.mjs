import assert from 'node:assert/strict';
import test from 'node:test';
import { bar } from './src.mjs';

test('increments', () => {
  assert.equal(bar(1), 2);
});
