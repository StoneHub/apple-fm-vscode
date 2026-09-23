#!/usr/bin/env node
// Verify comment-only suggestions on comment lines and comment intent for the code below.
const assert = require('node:assert/strict');
const { commentStart, completionHint, commentInsertion } = require('../dist/comments');

assert.equal(commentStart('  # loads the user', 'ruby'), 2);
assert.equal(commentStart('name = "a#b" # trailing', 'ruby'), 13);
assert.equal(commentStart('puts "#{name}"', 'ruby'), -1);
assert.equal(commentStart('const url = "http://x"; // note', 'typescript'), 24);
assert.equal(commentStart('# not a comment here', 'markdown'), -1);

assert.equal(completionHint('ruby', '  # finds the ', []).comment, true);
assert.equal(completionHint('ruby', 'user = find(id) # ', []).comment, true);
assert.equal(completionHint('ruby', 'user = find(id) ', []).comment, false);
assert.equal(completionHint('ruby', '', ['# Returns active users', '# sorted by name']).context,
  'The comment directly above the cursor describes the code to write next:\n# Returns active users\n# sorted by name');
assert.equal(completionHint('ruby', '  def ', ['class User', '  # Full display name']).context.endsWith('\n# Full display name'), true);
assert.equal(completionHint('ruby', '', ['# stale note', 'x = 1']).context, undefined);

assert.equal(commentInsertion('user by email\n  def find_by_email(email)', '  # finds the ', 'ruby'), 'user by email');
assert.equal(commentInsertion('# finds the user', '  # ', 'ruby'), 'finds the user');
assert.equal(commentInsertion(' finds the user', '  #', 'ruby'), ' finds the user');
assert.equal(commentInsertion('#123 for details', '# see ', 'ruby'), '#123 for details');
assert.equal(commentInsertion('# Returns the', '  # Returns the ', 'ruby'), '');
assert.equal(commentInsertion('# Returns the full name', '  # Returns the ', 'ruby'), 'full name');
assert.equal(commentInsertion('Returns the full name', '  # Returns the ', 'ruby'), 'full name');
assert.equal(commentInsertion('the full name of the user', '  # Returns the ', 'ruby'), 'full name of the user');
assert.equal(commentInsertion('theme colors', '  # Returns the ', 'ruby'), 'theme colors');
// # and % start a comment only at the start of a word (#3).
for (const [language, line] of [['shellscript', 'if [ $# -eq 0 ]; then '], ['shellscript', '(( ${#x} > 1 )) '], ['shellscript', 'n=${v##*/}'],
  ['ruby', 'label = "#{name}#{c > 1 ? " (x#{c})" : ""}" '], ['yaml', 'url: http://x/#top'], ['php', '#[Route("/users")] '], ['latex', 'costs 50\\% more ']]) {
  assert.equal(commentStart(line, language), -1, `${language}: ${line}`);
}
assert.equal(commentStart('x = 1  # note', 'python'), 7);
assert.equal(commentStart('ls -la # list', 'shellscript'), 7);
assert.equal(commentStart('echo hi;# done', 'shellscript'), 8);
assert.equal(commentStart('% a latex comment', 'latex'), 0);

// Mid-word cursor and doubled markers (#4).
assert.equal(commentInsertion('Returns the full name', '  # Returns the fu', 'ruby'), 'll name');
assert.equal(commentInsertion('full name', '  # Returns the fu', 'ruby'), 'll name');
assert.equal(commentInsertion('/// full name', '/// Returns the ', 'swift'), 'full name');
assert.equal(commentInsertion('## full name', '## Returns the ', 'ruby'), 'full name');
console.log('comment regressions: PASS');
