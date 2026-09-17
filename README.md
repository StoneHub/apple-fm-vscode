# Apple FM Inline Completion

An experimental VS Code inline completion provider using the on-device Apple Foundation Model through `/usr/bin/fm`. It reads the live unsaved document and cursor, and sends at most 6,000 characters of nearby or current-file context. Suggestions are plain insertion text and VS Code retains normal accept and dismiss behavior.

## Build and install

```sh
npm install
cd ../swift && swift build -c release && cd ../vscode
npm run package
code --install-extension apple-fm-inline-completion-0.1.0.vsix
```

Use `Apple FM: Request Suggestion` from the Command Palette for an explicit request. `Apple FM: Enable` and `Apple FM: Disable` control the provider. The status bar identifies `Apple FM · CLI` or `Apple FM · Swift`. Set `appleFm.backend` to `swift` to use the bundled helper. An optional absolute `appleFm.swiftHelperPath` in user settings selects your own helper.

This first package targets this Apple Silicon Mac. Local files and untitled documents are supported. Remote workspaces and browser VS Code are excluded. Other inline providers can compete for the same preview; none are disabled by this extension.

Remove with `code --uninstall-extension local.apple-fm-inline-completion`.
