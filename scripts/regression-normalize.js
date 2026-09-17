#!/usr/bin/env node
const assert = require('node:assert/strict');
const { normalizeInsertion } = require('../dist/backend');

const before = 'function demo() {\n  const previous = 1;\n  const ';
const raw = 'const greeting = selectedInput.value.toUpperCase();';
assert.equal(normalizeInsertion(raw, before, ';'), 'greeting = selectedInput.value.toUpperCase()');
assert.equal(normalizeInsertion('    next();', '    ', '\n'), '    next();');
assert.equal(normalizeInsertion('value;', 'const value = ', ';'), 'value');
assert.equal(normalizeInsertion('const x = 1;', 'const x = 1;', ''), '');
console.log('normalize regressions: PASS');
