# VS Code prototype status

## Current checkpoint: 0.1.5 installed

Monroe resumed installation. TypeScript compile, both focused regression scripts, and VSIX packaging passed. Version 0.1.5 is installed; installed JavaScript and both native helpers match the build. Existing windows still need Developer: Reload Window. The new overlay is ready for Monroe’s UI trial; no additional UI automation was performed during this installation.

Source changes prepared:
- Removed provider-explanation paragraphs, Copilot settings link, version/model disclaimer footer, and most help prose.
- Moved selection refactoring into a native Quick Input overlay: instruction, three alternatives, preview diff, explicit apply, more generations, stop, and edit instruction.
- Added a selection Code Action for the native lightbulb. Right-click, Command Palette, and side-panel entry points share that overlay.
- Kept the side panel for compact controls, runtime token meter, and expandable command/prompt diagnostics. Tab remains native inline acceptance.
- Corrected a local-only README link that stopped the final 0.1.4 packaging attempt; that packaging retry is also deferred.

Installed state: 0.1.5, with the compact panel and selection overlay. Running state depends on whether the existing window has been reloaded. Original demo/smoke unsaved work was preserved. The separate `fm-refactor-trial.js` window remains open; its apply test was undone.

Reinstall with `code --install-extension apple-fm-inline-completion-0.1.5.vsix --force`. Reload the VS Code window, select code, then run Apple FM: Refactor Selection.

## Earlier evidence, before the overlay change

- TypeScript compile and focused normalization/refactor regressions passed for 0.1.4. Refactor fixtures cover no edits during generation/diff, duplicate labels, changed-source rejection, a focus race, nine-result bound, and apply once.
- Three live CLI refactors succeeded. A simple function produced duplicate valid simplifications; variety is not guaranteed.
- Installed 0.1.4 side-panel trial: selected function, three alternatives, browse, native diff, apply, native Undo all worked.
- The live meter showed 192 input and 19 response-text tokens against an 8,192-token runtime capacity, source 60/6,000 characters. Tokenization excludes private system overhead/framing; it is not total session usage. Swift completion token counts are unavailable with the existing helper protocol.
- Restricted Mode stayed enabled. Earlier autocomplete checks include indented-prefix echoes, whitespace, suffix stripping, cancellation, Swift output handling, and native acceptance.

No project index, arbitrary shell tools, cloud fallback, or external model download was added. No server/watcher was started. Helpers exit after each request. No repositories were pushed or published.
