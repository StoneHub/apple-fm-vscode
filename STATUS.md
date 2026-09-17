# VS Code prototype status

## Current checkpoint: 0.1.5 source, verification deferred

Monroe requested a batch of UX edits and explicitly asked to save testing until the edits are finished. No new compile, tests, packaging, installation, or UI checks were run after that instruction.

Source changes prepared:
- Removed provider-explanation paragraphs, Copilot settings link, version/model disclaimer footer, and most help prose.
- Moved selection refactoring into a native Quick Input overlay: instruction, three alternatives, preview diff, explicit apply, more generations, stop, and edit instruction.
- Added a selection Code Action for the native lightbulb. Right-click, Command Palette, and side-panel entry points share that overlay.
- Kept the side panel for compact controls, runtime token meter, and expandable command/prompt diagnostics. Tab remains native inline acceptance.
- Corrected a local-only README link that stopped the final 0.1.4 packaging attempt; that packaging retry is also deferred.

Installed/running state: the earlier 0.1.4 trial build is installed. It still uses the larger side-panel refactor UI. It does not contain the pending 0.1.5 cleanup/overlay. Original demo/smoke unsaved work was preserved. The separate `fm-refactor-trial.js` window remains open; its apply test was undone.

When Monroe finishes sending edits: review the final source, compile, run the two existing focused regression scripts, package, install 0.1.5 (or next version), compare installed artifacts, and verify one overlay refactor flow in the disposable trial. No broad test expansion is requested. Use `npm run package` and `code --install-extension apple-fm-inline-completion-0.1.5.vsix --force`. Existing windows need Developer: Reload Window.

## Earlier evidence, before the overlay change

- TypeScript compile and focused normalization/refactor regressions passed for 0.1.4. Refactor fixtures cover no edits during generation/diff, duplicate labels, changed-source rejection, a focus race, nine-result bound, and apply once.
- Three live CLI refactors succeeded. A simple function produced duplicate valid simplifications; variety is not guaranteed.
- Installed 0.1.4 side-panel trial: selected function, three alternatives, browse, native diff, apply, native Undo all worked.
- The live meter showed 192 input and 19 response-text tokens against an 8,192-token runtime capacity, source 60/6,000 characters. Tokenization excludes private system overhead/framing; it is not total session usage. Swift completion token counts are unavailable with the existing helper protocol.
- Restricted Mode stayed enabled. Earlier autocomplete checks include indented-prefix echoes, whitespace, suffix stripping, cancellation, Swift output handling, and native acceptance.

No project index, arbitrary shell tools, cloud fallback, or external model download was added. No server/watcher was started. Helpers exit after each request. No repositories were pushed or published.
