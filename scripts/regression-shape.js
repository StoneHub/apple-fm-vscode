#!/usr/bin/env node
// Verify one-line suggestions after code and block reindenting on an empty line.
const assert = require('node:assert/strict');
const { prepare, shapeCode, finish } = require('../dist/pipeline');

// Empty indented line: blocks are reindented whether the model returns relative or absolute indentation.
assert.equal(shapeCode('def full_name\n  "#{first} #{last}"\nend', '  ', ''), 'def full_name\n    "#{first} #{last}"\n  end');
assert.equal(shapeCode('  def full_name\n    "#{first} #{last}"\n  end', '  ', ''), 'def full_name\n    "#{first} #{last}"\n  end');
assert.equal(shapeCode('\n  def a\n  end\n', '  ', ''), 'def a\n  end');
assert.equal(shapeCode('    next();', '    ', ''), 'next();');
assert.equal(shapeCode('if x\n\n  y\nend', '', ''), 'if x\n\n  y\nend');
// After code or before existing text: first line only.
assert.equal(shapeCode('nd(id)\n  user.save', '  user = User.fi', ''), 'nd(id)');
assert.equal(shapeCode('id: 1\n)', 'User.where(', ')'), 'id: 1');
assert.equal(shapeCode('foo\nbar', '  ', 'existing'), '');
assert.equal(shapeCode('  true\n```ruby', '    status == ', ''), 'true');
assert.equal(shapeCode("  def index\n    @users = User.where(status: 'active')\n  end", '    @users = User.where(', ')', { before: 'class A\n  def index\n    @users = User.where(' }), "status: 'active'");

const text = 'class User\n  # Returns the full name\n  \nend\n';
const offset = text.indexOf('\n  \nend') + 3;
const prepared = prepare(text, offset, 'ruby', 'nearby');
assert.equal(prepared.linePrefix, '  ');
assert.equal(prepared.lineSuffix, '');
assert.match(prepared.request.context, /# Returns the full name$/);
assert.equal(finish('  def full_name\n    "#{first} #{last}"\n  end', prepared), 'def full_name\n    "#{first} #{last}"\n  end');
const inComment = prepare('x = 1 # sets ', 13, 'ruby', 'nearby');
assert.equal(inComment.request.mode, 'comment');
assert.equal(finish('# sets x to one\ny = 2', inComment), 'x to one');

// Block shapes (#1): relative, file columns, column 0, tabs, restated lines above, closers already below.
assert.equal(shapeCode('def full_name\n    1\n  end', '  ', ''), 'def full_name\n    1\n  end');
assert.equal(shapeCode('def full_name\n  1\nend', '  ', ''), 'def full_name\n    1\n  end');
assert.equal(shapeCode('  def full_name\n    1\n  end', '', ''), '  def full_name\n    1\n  end');
assert.equal(shapeCode('if x:\n    y()', '    ', '', { language: 'python' }), 'if x:\n        y()');
assert.equal(shapeCode('if x:\n        y()', '    ', '', { language: 'python' }), 'if x:\n        y()');
assert.equal(shapeCode('const a = 1;\n  return a;', '  ', '', { language: 'typescript' }), 'const a = 1;\n  return a;');
assert.equal(shapeCode('if x\n    y()\nend', '\t', '', { language: 'ruby' }), 'if x\n\t\ty()\n\tend');
assert.equal(shapeCode('const sum = 1;\nreturn sum;\n}', '  ', '', { language: 'typescript' }), 'const sum = 1;\n  return sum;');
assert.equal(shapeCode('def x\n  1\nend', '  ', '', { language: 'ruby' }), 'def x\n    1\n  end');
assert.equal(shapeCode('1\nend', '    ', '', { language: 'ruby' }), '1');
assert.equal(shapeCode('def index\n  load\nend\nnext', '  ', '', { before: 'class A\n  def index\n  ', language: 'ruby' }), 'load\n  end\n  next');

// One line (#2): closers, restatement, column 0, CRLF.
const inCall = prepare('x = foo()', 8, 'ruby', 'nearby');
assert.equal(finish('bar(1)', inCall), 'bar(1)');
assert.equal(finish('bar(1))', inCall), 'bar(1)');
for (const [prefix, reply, want] of [['  const ', 'sum = a + b;\n  const avg = sum / 2;', 'sum = a + b;'], ['  def ', 'total\n  def other', 'total'], ['  expect(', 'x).to eq(1)\n  expect(y)', 'x).to eq(1)'], ['  return ', 'a\n  return b', 'a']]) {
  const text = `function f() {\n${prefix}\n}`;
  assert.equal(finish(reply, prepare(text, text.indexOf(prefix) + prefix.length, 'typescript', 'nearby')), want);
}
const crlf = 'class A\r\n  x = foo()\r\nend\r\n';
assert.equal(finish('  x = foo(bar)', prepare(crlf, crlf.indexOf('foo(') + 4, 'ruby', 'nearby')), 'bar');
console.log('shape regressions: PASS');
