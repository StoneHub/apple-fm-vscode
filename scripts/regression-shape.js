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
// Window edges keep surrogate pairs whole, and a long comment above leaves room for code (#5).
const lone = s => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
for (let offset = 6990; offset <= 7010; offset++) {
  const r = prepare('b'.repeat(4000) + '😀'.repeat(20) + 'a'.repeat(4000), offset, 'ruby', 'nearby').request;
  assert.ok(!lone(r.before) && !lone(r.after), `lone surrogate at offset ${offset}`);
}
const longComment = Array.from({ length: 20 }, (_, i) => `# ${String(i).padEnd(308, 'x')}`).join('\n');
const big = 'x = 1\n'.repeat(1200) + longComment + '\n';
const withIntent = prepare(big, big.length, 'ruby', 'nearby').request;
assert.ok(withIntent.before.length > 2000, 'before keeps its half of the window');
assert.ok(withIntent.context.length <= 1100, 'intent is capped');
assert.ok(withIntent.before.length + withIntent.after.length + withIntent.context.length <= 6000, 'request fits the helper limit');
// A block that restates the line below the cursor loses that line, but a new block keeps its own end (#1).
assert.equal(shapeCode('return 0\n    return sum(values) / len(values)', '        ', '', { after: '\n    return sum(values) / len(values)\n', language: 'python' }), 'return 0');
assert.equal(shapeCode('def x\n  1\nend', '  ', '', { after: '\nend\n', language: 'ruby' }), 'def x\n    1\n  end');
// Inside an open bracket, a new statement is dropped but arguments are kept (#15).
assert.equal(shapeCode('  def format_price(amount)', '    format_price(', ')', { language: 'ruby' }), '');
assert.equal(shapeCode('return `Hello, ${name}!`;', '  console.log(', ');', { language: 'typescript' }), '');
assert.equal(shapeCode('item.price)', '    format_price(', ')', { language: 'ruby' }), 'item.price');
assert.equal(shapeCode('`Hello, ${name}!`', '  console.log(', ');', { language: 'typescript' }), '`Hello, ${name}!`');
assert.equal(shapeCode('  true', '    status == ', '', { language: 'ruby' }), 'true');
// A reply that repeats the end of the typed line loses the repeat.
assert.equal(shapeCode('User.where(id: params[:id])', '    @users = User.where(', ')', { language: 'ruby' }), 'id: params[:id]');
assert.equal(shapeCode('where(id: 1)', '    @users = User.where(', ')', { language: 'ruby' }), 'id: 1');
assert.equal(shapeCode('sers.count', '    @users = @u', '', { language: 'ruby' }), 'sers.count');
const inBracket = prepare('x = foo(', 8, 'ruby', 'nearby');
assert.match(inBracket.request.context, /inside an open bracket/);
assert.equal(prepare('x = foo()', 9, 'ruby', 'nearby').request.context, undefined);
console.log('shape regressions: PASS');
