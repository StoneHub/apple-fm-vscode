# VS Code prototype status

Parent Astra reviewed version 0.1.3; packaged, installed, and observed running in the separate `fm-smoke.js` VS Code window. Use `git rev-parse HEAD` for the current local checkpoint.

Artifact: `apple-fm-inline-completion-0.1.3.vsix`. Install with `code --install-extension apple-fm-inline-completion-0.1.3.vsix --force`; reload existing windows. Remove with `code --uninstall-extension local.apple-fm-inline-completion`.

## Current behavior

- Clicking the status bar opens a webview side panel with provider controls and latest prompt, command, model, latency, and character counts. The previous QuickPick menu is removed. Tab remains native acceptance.
- Exact echoed prefixes are removed, including the reported indented `const ` case where the model omits indentation. Existing same-line suffixes are also removed from echoed output.
- Automatic requests are suppressed on a just-accepted line, for an unchanged request location, and for JavaScript/TypeScript lines ending in a semicolon. Editing resumes normal automatic behavior; explicit requests are available.
- Status activity indicates Apple FM work; the acceptance callback briefly flashes a teal gutter dot. Ready status does not claim ownership of another provider's visible preview.

## Evidence

- TypeScript compile and VSIX packaging passed.
- `node scripts/regression-normalize.js` passed the reported indented-prefix regression, preserved indentation-only context, suffix stripping, and empty-echo cases.
- Earlier parent backend checks passed whitespace preservation, unsafe Swift insertion rejection, three concurrent requests resolving cancelled/cancelled/ok, missing-executable cleanup, and a live bundled Swift completion.
- Live 0.1.3 panel showed its version, CLI system model, exact input/argv, and a 671 ms successful request. At an indented `const ` cursor the visible ghost text was `result = previous + 5;`, without a repeated declaration. Subsequent live editor state contained `const result = previous + 5;`, and the Apple FM acceptance callback had fired.
- Restricted Mode remained enabled during that trial. No workspace trust change was needed.
- Original `demo.js` unsaved edits were preserved; its existing window may require Reload Window to load the update.

Still for the user trial: suggestion quality, comfort of the side panel, and coexistence with Copilot. No claim that the Apple model always produces valid code. No cloud inference or persistent inference server is used. The scratch VS Code window is intentionally left open for Monroe.
