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
// Block comments and docstrings (#13).
const { openBlockComment } = require('../dist/comments');
const { prepare, finish } = require('../dist/pipeline');
for (const [language, text] of [
  ['typescript', '/**\n * Returns the '], ['typescript', 'const x = 1; /* note '], ['c', 'int x; /* multi\n   line '],
  ['swift', '/* outer /* inner */ still '], ['rust', '/* a /* b */ c '], ['rust', "fn f<'a>() { /* note "],
  ['sql', 'SELECT 1; /* why '], ['css', '.a { color: red; } /* brand '],
  ['ruby', 'x = 1\n=begin\nFinds the '], ['ruby', '=begin notes '],
  ['python', 'def full_name(self):\n    """Returns the '], ['python', 'class User:\n    """\n    A person '],
  ['python', '#!/usr/bin/env python\n"""Module for '], ['python', "def f():  # helper\n    r'''Raw "]]) {
  assert.ok(openBlockComment(text, language) >= 0, `inside: ${language} ${JSON.stringify(text)}`);
}
for (const [language, text] of [
  ['typescript', '/* done */ const x = '], ['typescript', 'const s = "/*"; const t = '], ['typescript', 'const t = `/*`;\nconst u = '],
  ['typescript', '// see /* x\nconst y = '], ['javascript', '/* outer /* inner */ still '], ['php', '# old /* note\n$x = '],
  ['ruby', '=begin\nx\n=end\ny = '], ['ruby', '  =begin\nnot a block '], ['ruby', 'label = "=begin"\n'],
  ['python', 'query = """SELECT '], ['python', 'x = 1\n"""closed"""\ny = '], ['python', '# """ not a string\nz = '],
  ['python', 'x = 1\n"""\nnot a docstring '], ['markdown', '/* not code ']]) {
  assert.equal(openBlockComment(text, language), -1, `outside: ${language} ${JSON.stringify(text)}`);
}
const blockHint = completionHint('typescript', '   * Returns the ', [], true);
assert.deepEqual([blockHint.comment, blockHint.block], [true, true]);
assert.equal(commentInsertion('* Returns the full name', '   * Returns the ', 'typescript', true), 'full name');
assert.equal(commentInsertion('full name */', '   * Returns the ', 'typescript', true), 'full name');
assert.equal(commentInsertion('*/', '   * ', 'typescript', true), '');
assert.equal(commentInsertion(`Returns the user's full name."""`, '    """Returns the ', 'python', true), "user's full name.");
assert.equal(commentInsertion('Finds the user by email', 'Finds the ', 'ruby', true), 'user by email');
assert.equal(commentInsertion('=end', 'Finds the ', 'ruby', true), '');
// Through the pipeline: a JSDoc line gets a one-line comment suggestion; code after a closed docstring stays code.
const jsdoc = 'export class User {\n  /**\n   * Returns the ';
const prepared = prepare(jsdoc, jsdoc.length, 'typescript', 'nearby');
assert.deepEqual([prepared.request.mode, prepared.request.keep], ['comment', 'line']);
assert.equal(finish('* Returns the display name */', prepared), 'display name');
const code = 'def f():\n    """Doc."""\n    return ';
assert.equal(prepare(code, code.length, 'python', 'nearby').request.mode, undefined);
// Replies observed on the Mac: a partial fence and an echoed Ruby opener must abstain.
assert.equal(commentInsertion('```', ' * Returns the ', 'typescript', true), '');
assert.equal(commentInsertion('```typescript', ' * Returns the ', 'typescript', true), '');
assert.equal(commentInsertion('=begin', 'Finds the ', 'ruby', true), '');
assert.equal(commentInsertion('=begin Finds the user', 'Finds the ', 'ruby', true), 'user');
console.log('comment regressions: PASS');
