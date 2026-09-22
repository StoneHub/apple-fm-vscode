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
assert.equal(shapeCode('foo\nbar', '  ', 'existing'), 'foo');
assert.equal(shapeCode('  true\n```ruby', '    status == ', ''), 'true');
assert.equal(shapeCode("  def index\n    @users = User.where(status: 'active')\n  end", '    @users = User.where(', ')'), "status: 'active'");

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
console.log('shape regressions: PASS');
