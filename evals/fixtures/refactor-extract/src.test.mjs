import assert from 'node:assert/strict';
import test from 'node:test';
import { double } from './src.mjs';

test('doubles', () => {
  assert.equal(double(3), 6);
});
