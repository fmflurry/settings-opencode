import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './add.mjs';

test('add', () => {
  assert.equal(add(1, 2), 3);
});
