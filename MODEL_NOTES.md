# Apple FM capacity and next steps

Verified locally on September 16, 2026, macOS 27.0 (26A428), Xcode 27.0: `SystemLanguageModel.default.contextSize` returns **8192**. `sysctl hw.memsize` returns 68,719,476,736 bytes (64 GiB). The installed `/usr/bin/fm respond --help` lists only `system` as its model.

The extension's `fm` and `swift` choices are interfaces to the same on-device Apple system model. They are not model sizes. There is no memory allocation or context expansion control in this integration. Apple selects and manages the system model. Extra RAM does not change the reported context window through a setting here.

## What the meter means

- Blue measures submitted prompt and instruction text with Apple's tokenCount API.
- Green measures the returned text with the same tokenizer. It is a text-token measurement, not full session usage accounting; private system overhead and transcript framing are excluded.
- The separate 6,000-character source cap is an extension limit. It is not 6,000 tokens. Instructions and answers need room in the model's total window.
- Alternatives are independent requests. Three alternatives do not consume one accumulating conversation window.
- The CLI request can be measured from its exact submitted text. The current Swift helper does not expose its full internal prompt to this meter, so that path explicitly reports unavailable counts rather than tokenizing its transport JSON.
- Only the current file context or captured selection is submitted. There is no project indexing in this prototype.

## Available capabilities

The local CLI exposes greedy/default sampling, system use cases (general/content-tagging), structured output schemas, text/image inputs, streaming, and built-in OCR/barcode tools. The extension uses a narrow subset. Inline CLI completion uses greedy sampling; refactor alternatives omit greedy and ask for individually sampled solutions. Duplicate alternatives are possible and labeled.

The native framework exposes temperature, sampling modes with optional seeds, output token limits, structured generation, custom tools, and new dynamic session profiles. Apple also documents Private Cloud Compute and other local model adapters. PCC is a separate cloud path with its own entitlement/availability; this extension never routes there.

A plausible next step is a bounded local coding workflow: search project symbols/files, retrieve a few relevant sections, propose a diff, then run a selected check. The whole repository can be searchable without fitting in one prompt. Reliability on broad autonomous project work has not been established by the short completion/refactor trial.

For using more of the Mac's RAM, an explicitly selected MLX model is a separate path. Model weights, quantization, context cache, OS/app headroom, and measured speed determine the fit; 64 GiB alone does not establish a specific model's suitability. No other model was downloaded or installed.

Sources:
- [Apple WWDC26 framework overview: context, tools, model choices](https://developer.apple.com/videos/play/wwdc2026/241/)
- [Generation options](https://developer.apple.com/documentation/FoundationModels/GenerationOptions)
- [MLX-LM](https://github.com/ml-explore/mlx-lm)

Older Apple documents still describe a 4,096-token context window. This prototype reads the runtime model capacity instead of hard-coding that older number.
