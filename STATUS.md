# VS Code prototype status

## Current checkpoint: 0.1.6 installed and running

Selection refactoring now uses a native editor-anchored widget beneath the first selected line. Enter an instruction, Generate 3, browse alternatives with arrows, switch between changes and replacement, and Apply explicitly. The selection workflow opens no separate diff tabs. This uses the stable Comments API, not Copilot inline chat or its agent loop.

TypeScript compile, focused regression scripts, and VSIX packaging passed. Installed JavaScript and both native helpers match the build (nine files verified). The existing VS Code window was reloaded into 0.1.6, preserving its unsaved source.

Live UI proof: the anchored prompt generated three alternatives; next changed 1/3 to 2/3; the view toggle showed syntax-highlighted replacement code in the same widget. No candidate was applied. The model changed behavior despite a preserve-behavior request, so these are reviewable drafts, not validated refactors. VS Code automatically opened its Comments panel on the first result; it was closed for the trial. The widget remains available in fm-refactor-trial.js.

The side panel retains compact controls, runtime context meter, and command/prompt diagnostics. Tab remains native autocomplete acceptance.

Reinstall with `code --install-extension apple-fm-inline-completion-0.1.6.vsix --force`. Reload the window, highlight code, and run Apple FM: Refactor Selection.

The release prototype is for Apple Silicon Macs on macOS 27 or later. `bin/apple-fm-helper` reports a macOS 15 minimum; `bin/apple-fm-info` reports a macOS 27 minimum from `otool -l`. Public release artifacts are unsigned developer previews without notarization proof. `scripts/copy-swift-helper.sh` uses a sibling Swift build when available and otherwise retains the tracked helper, so a standalone clone can package without `/Users/monroe/Developer/GitRepos/FM/swift`.

## Earlier evidence, before the overlay change

- TypeScript compile and focused normalization/refactor regressions passed for 0.1.4. Refactor fixtures cover no edits during generation/diff, duplicate labels, changed-source rejection, a focus race, nine-result bound, and apply once.
- Three live CLI refactors succeeded. A simple function produced duplicate valid simplifications; variety is not guaranteed.
- Installed 0.1.4 side-panel trial: selected function, three alternatives, browse, native diff, apply, native Undo all worked.
- The live meter showed 192 input and 19 response-text tokens against an 8,192-token runtime capacity, source 60/6,000 characters. Tokenization excludes private system overhead/framing; it is not total session usage. Swift completion token counts are unavailable with the existing helper protocol.
- Restricted Mode stayed enabled. Earlier autocomplete checks include indented-prefix echoes, whitespace, suffix stripping, cancellation, Swift output handling, and native acceptance.

No project index, arbitrary shell tools, cloud fallback, or external model download was added. No server/watcher was started. Helpers exit after each request. No repositories were pushed or published.
