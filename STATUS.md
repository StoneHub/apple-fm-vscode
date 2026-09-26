# VS Code status

## Current checkpoint: 0.1.9

Block comments and Python docstrings now use comment shaping. Provider regression coverage checks request refusal, cancellation, debounce and stale results; all 18 deliberate mutations were caught on the Mac. PRs #22 and #23 are merged. Real-model trials found two additional shaping defects, now covered by regressions: a standalone Markdown fence and an echoed Ruby `=begin` opener are suppressed inside blocks.

On macOS 27.2 (26B5086k), `npm test` passed including all 31 golden replies. Synthetic JSDoc, Python and Ruby block examples were tested on CLI and Swift: all six preserved valid syntax and returned single-line insertions with no closing delimiters. This measures shaping, not semantic usefulness; the Ruby model prose was still weak. Partial snippets without closing delimiters can abstain. The bundled Swift helper was rebuilt from apple-fm-swift `5e6bbea`.

The 0.1.9 VSIX was installed on this Mac. Installed comment/provider/pipeline JavaScript and both native helpers match the packaged bytes; the manifest matches apart from VS Code installation metadata. A fresh VS Code window in Restricted Mode generated `full name of the person.` inside a synthetic Python docstring. Tab inserted exactly that text and the status bar confirmed Apple FM acceptance. Existing windows and their unsaved documents were left open; reload those windows when convenient to load the update.

VSIX SHA-256: `1f9f2b685a848d24cd512b20524babeeb0b0922f097fbe01115925c54db336e6`. No public release was created. Long-block truncation (#20), prompt unification (#16) and large-file quality (#18) remain follow-ups.

## Current checkpoint: 0.1.8

The editor now sends the line or block reply budget to the Swift helper, bundled from apple-fm-swift `983b327`. Comment shaping stays in the editor. Code and terminal prompts are preserved after live testing caught a regression from broadening the helper prompt change.

`npm test` passed the five regression scripts, including 31 golden replies. Three live runs of 13 Swift fixtures produced 33 good, 6 empty, 0 bad and 0 unchecked, with no baseline verdict regression. The 19-file VSIX packaged successfully and was installed on this Mac. Actual VS Code activated it with the Swift backend in a synthetic workspace; Tab acceptance still needs to be checked in the editor.

The known long-block truncation bug remains tracked in #20. Prompt unification (#16), Provider-rule coverage (#17), and large-file quality (#18) remain open. No public release was created.

## Earlier verification

Selection refactoring now uses a native editor-anchored widget beneath the first selected line. Enter an instruction, Generate 3, browse alternatives with arrows, switch between changes and replacement, and Apply explicitly. The selection workflow opens no separate diff tabs. This uses the stable Comments API, not Copilot inline chat or its agent loop.

TypeScript compile, focused regression scripts, and VSIX packaging passed. Installed JavaScript and both native helpers match the build (nine files verified). The existing VS Code window was reloaded into 0.1.6, preserving its unsaved source.

Live UI proof: the anchored prompt generated three alternatives; next changed 1/3 to 2/3; the view toggle showed syntax-highlighted replacement code in the same widget. No candidate was applied. The model changed behavior despite a preserve-behavior request, so these are reviewable drafts, not validated refactors. VS Code automatically opened its Comments panel on the first result; it was closed for the trial. The widget remains available in fm-refactor-trial.js.

The side panel retains compact controls, runtime context meter, and command/prompt diagnostics. Tab remains native autocomplete acceptance.

Reinstall with `code --install-extension apple-fm-inline-completion-0.1.6.vsix --force`. Reload the window, highlight code, and run Apple FM: Refactor Selection.

The release prototype is for Apple Silicon Macs on macOS 27 or later. `bin/apple-fm-helper` reports a macOS 14 minimum; `bin/apple-fm-info` reports a macOS 27 minimum from `otool -l`. Public release artifacts are unsigned developer previews without notarization proof. `scripts/copy-swift-helper.sh` uses a sibling Swift build when available and otherwise retains the tracked helper, so a standalone clone can package without a sibling `apple-fm-swift` checkout.

## Earlier evidence, before the overlay change

- TypeScript compile and focused normalization/refactor regressions passed for 0.1.4. Refactor fixtures cover no edits during generation/diff, duplicate labels, changed-source rejection, a focus race, nine-result bound, and apply once.
- Three live CLI refactors succeeded. A simple function produced duplicate valid simplifications; variety is not guaranteed.
- Installed 0.1.4 side-panel trial: selected function, three alternatives, browse, native diff, apply, native Undo all worked.
- The live meter showed 192 input and 19 response-text tokens against an 8,192-token runtime capacity, source 60/6,000 characters. Tokenization excludes private system overhead/framing; it is not total session usage. Swift completion token counts are unavailable with the existing helper protocol.
- Restricted Mode stayed enabled. Earlier autocomplete checks include indented-prefix echoes, whitespace, suffix stripping, cancellation, Swift output handling, and native acceptance.

No project index, arbitrary shell tools, cloud fallback, or external model download was added. No server/watcher was started. Helpers exit after each request. No repositories were pushed or published.
