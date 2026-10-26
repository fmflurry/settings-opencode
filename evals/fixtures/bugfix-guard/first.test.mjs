import assert from 'node:assert/strict';
import test from 'node:test';
import { first } from './first.mjs';

test('first trims the head and is empty-safe', () => {
  assert.equal(first([' a ']), 'a');
  assert.equal(first([]), undefined);
});
