# Apple FM Inline Completion

Experimental inline completion using the on-device Apple Foundation Model on this Mac. Context comes from the live, unsaved document and is bounded to 6,000 characters. Tab accepts through VS Code's normal inline completion behavior; Escape dismisses. No branding is added to ghost text.

## Try

Click **Apple FM** in the status bar to open its side panel. Controls enable/pause the provider, toggle suggestions while typing, select CLI or Swift, and choose nearby or bounded current-file context. **Request suggestion** requests explicitly, including when automatic suggestions are off.

The panel shows the latest request's model, executable/arguments, full submitted input, elapsed milliseconds, and input/output character counts. This is latest-request data held in memory, not saved history. Apple exposes the system model, not an exact model release identifier. Output counts describe raw backend output, before insertion normalization.

The status bar spins while generating and turns blue when Apple FM returns a suggestion. A brief teal gutter dot confirms an accepted Apple FM suggestion. When several inline providers are enabled, VS Code selects the displayed preview: “ready” does not prove which provider is visible. The panel links to Copilot's inline settings; this extension does not disable other providers.

Version 0.1.3 replaces the previous menu with the side panel, strips echoed line prefixes even when the model drops existing indentation, and suppresses repeated automatic requests at an unchanged cursor or immediately after acceptance on that line. Explicit requests remain available. Suggestions can still be semantically wrong; this is a local prototype.

## Build and install

```sh
npm install
cd ../swift && swift build -c release && cd ../vscode
npm run package
code --install-extension apple-fm-inline-completion-0.1.3.vsix --force
```

For an already-open window, run **Developer: Reload Window** to load the installed update. The panel footer shows its running version.

Commands: `Apple FM: Request Suggestion`, `Apple FM: Enable`, `Apple FM: Disable`, and `Apple FM: Open Control Panel`. Set `appleFm.backend` to `swift` for the bundled helper. The optional application-scoped `appleFm.swiftHelperPath` selects an absolute helper path.

This package targets this Apple Silicon Mac. Local files and untitled documents work in trusted or Restricted Mode windows; remote and browser workspaces are excluded. Credential-like filenames are skipped.

Remove with `code --uninstall-extension local.apple-fm-inline-completion`.
