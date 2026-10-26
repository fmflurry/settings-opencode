import assert from 'node:assert/strict';
import test from 'node:test';
import { slugify } from './slug.mjs';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});
