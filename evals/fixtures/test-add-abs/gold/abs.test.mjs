import assert from 'node:assert/strict';
import test from 'node:test';
import { abs } from './abs.mjs';

test('abs of a negative and a positive', () => {
  assert.equal(abs(-2), 2);
  assert.equal(abs(2), 2);
});
