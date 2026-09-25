# Cloud work: provider regression coverage

First task: [issue #17](https://github.com/StoneHub/apple-fm-vscode/issues/17). Add deterministic coverage of the real inline completion Provider's request rules. This is portable test work; live inference, extension installation and release packaging remain Mac gates.

## Preflight

Record branch, commit and dirty state; check the issue and overlapping PRs. Preparation baseline: `5e27eb3` on 2026-09-25. Use the provisioned task branch. Read `package.json` and `package-lock.json`; use Node 22 or newer, Python 3, and Ruby 3.1 or newer for recorded-reply syntax scoring. Ruby may be selected with `APPLE_FM_RUBY` pointing to the runner's executable, never a developer's Mac path.

Run `npm ci` then `npm test` once. `scripts/dogfood-lib.js` explains validator detection: unavailable Ruby is `unchecked`, not a syntax pass, and can fail the golden baseline. Fix the declared runtime instead of rewriting expected scores. Capture the failing excerpt and exit status. Allow five minutes for preflight and one evidence-backed environment correction; checkpoint a repeated blocker. Use the environment's setup/cache for tools; avoid reinstalling everything during the task.

`npm run package` invokes `xcrun` to build a Mac helper. Do not run it on Linux, install Xcode there, replace the helper, or invoke `scripts/dogfood.js`. No provider keys, real `/usr/bin/fm`, VS Code executable or running editor are needed for this packet. Do not chase missing personal `/Users/...` instructions.

## Implementation packet

Start at `src/extension.ts` (`Provider`, `debounce`, activation/event handling), `scripts/regression-refactor.js` (stubbed vscode module), and `package.json`'s regression discovery. Add `scripts/regression-provider.js` that captures the registered actual provider, stubs the backend and drives controlled promises/timers. Avoid a copied implementation of the rules.

Prove selection, credential-like file, remote and web workspace rejection; automatic suppression after acceptance on the same line and after JS/TS semicolons; explicit requests where permitted; the 350 ms debounce; and stale-result rejection after document/cursor change or cancellation. Assert backend invocation counts and returned suggestions. Each claimed rule must fail its focused assertion when locally disabled, with the temporary mutation restored. Avoid wall-clock sleeps and live model calls.

Keep production changes to the smallest test seam if needed. No new framework, backend redesign, prompt unification or dependency upgrades. Existing `regression-*.js` discovery should pick up the new script.

## Completion

Run the focused compiled regression and `npm test`; inspect `git diff --check`. Return one scoped PR with actual commands, outcomes, base/final commits and unavailable checks. Local integrator owns review and merge; packaging or installed-editor claims require separate Mac proof. Local preparation passed compilation and all regressions, including 31 golden replies, with a supported Ruby. Hosted Linux baseline is still unverified.

Copy-ready launch:

> Implement issue #17 using docs/CLOUD-WORK.md. Run preflight and the baseline once, test the real Provider with mocked editor/backend/timers, and return one scoped PR. Stop and report a repeated environment blocker. Do not package or run live inference.
