# Cloud work: keep capped block suggestions complete

Next task: [issue #20](https://github.com/StoneHub/apple-fm-vscode/issues/20). A reply longer than the 12-line budget can currently be cut inside an open block. Return the last complete prefix within the budget, or abstain. Provider coverage (#17, PR #22) and block-comment detection (#13, PR #23) are merged and installed locally as 0.1.9; do not repeat those assignments.

## Preflight

Record branch, commit and dirty state; check issue #20 and overlapping PRs. Start from current remote main. Use Node 22 or newer, Python 3, and Ruby 3.1 or newer for recorded-reply syntax scoring. Set `APPLE_FM_RUBY` to the runner's executable when needed, never to a Mac path. Read the manifests and run `npm ci`, then `npm test` once.

Unavailable Ruby is `unchecked`, not a syntax pass. The Linux baseline's old refactor platform-stub problem is already fixed in PR #22. Allow five minutes for preflight and one evidence-backed environment correction. On a repeated blocker, save the failing command and excerpt, checkpoint the branch, and stop. Use the environment setup/cache rather than repeatedly installing tools. Do not chase missing personal `/Users/...` instruction files.

`npm run package` invokes `xcrun`. Do not run it on Linux, install Xcode, replace bundled native binaries, or invoke `scripts/dogfood.js`. No real model, provider key, editor installation or live inference is needed.

## Implementation packet

Inspect `MAX_BLOCK_LINES`, `shapeCode`, and `stopWhen` in `src/pipeline.ts`, the streaming behavior in `src/backend.ts`, and `scripts/regression-shape.js` / `scripts/dogfood-lib.js`. Reproduce the over-cap failure through the actual `prepare` / `finish` pipeline with deterministic replies. Cover complete blocks below and above the limit, nested blocks crossing the limit, a complete prefix followed by an unfinished block, comments/strings containing delimiter-like text, and line-mode behavior remaining unchanged.

Keep the implementation conservative and bounded: a complete prefix or an empty suggestion is acceptable. Do not build a general shell or multi-language parser, introduce synchronous subprocesses into the editor hot path, or change model prompts/dependencies. Preserve cancellation, streaming deadlines, context bounds and insertion-only acceptance. Use a focused seam only if the current interface prevents testing actual behavior.

Label new reply fixtures as authored unless they are genuine recorded model output. Do not manufacture model measurements or relabel existing goldens. Assert that the inserted result parses using the available fixture validators, or is empty; include a regression that fails on the original implementation. If a language cannot be validated confidently, abstention is preferable to claiming balanced delimiters prove valid syntax. A parser-backed result is still not a semantic-correctness claim.

## Completion and Mac boundary

Run focused regressions, `npm test`, and `git diff --check`. Return one scoped PR with original failing evidence, base/final commits, actual command outcomes and remaining limitations. No polling or scheduled wakeups; finish the packet once and hand it back. The local coordinator reviews and merges checked work, builds the VSIX, installs it and runs real-model/editor acceptance. Leave public release and installation to that coordinator.

The local Mac gate is a synthetic long-block example on both CLI and Swift backends, plus installed-editor preview and Tab acceptance or explicit abstention. Never execute generated code to assess quality. Mac validation can add genuine recorded replies after the cloud fixtures exist.

Copy-ready launch:

> Implement issue #20 using docs/CLOUD-WORK.md on current main. Reproduce the long-block truncation through the real completion pipeline, add explicitly authored over-cap fixtures, and return a complete bounded prefix or abstain. Run baseline/preflight once and one justified environment correction at most. Preserve existing goldens, request cancellation and line mode. Return one scoped PR with evidence; no packaging, live inference, native binaries, release, polling or automatic follow-up jobs.
