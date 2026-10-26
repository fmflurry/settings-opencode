import assert from 'node:assert/strict';
import test from 'node:test';
import { foo } from './src.mjs';

test('increments', () => {
  assert.equal(foo(1), 2);
});
