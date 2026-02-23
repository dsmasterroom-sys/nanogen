# Current Status (2026-02-23)

## Scope
This document summarizes the current implementation status of Prompt Agent, Image Generator, and Video Generator in this repository.

## What Was Changed

### 1) Prompt Agent behavior
- Prompt Agent now supports synthesis of:
  - node prompt text
  - upstream text references
  - reference images
- Prompt Agent can infer `video` intent from prompt keywords and send `media_type: video` automatically in workflow execution path.
- Prompt Agent supports `N outputs` parsing (e.g. `4 outputs`) for video-oriented prompt composition.

### 2) Prompt Assistant input validation fix
- Removed strict requirement that local node text must exist for prompt generation.
- If local prompt is empty, the first upstream text is used as primary prompt.
- Remaining upstream texts are treated as secondary references.

### 3) Image Generator robustness improvements
- Added image-focused prompt extraction before image generation.
- Non-image-oriented sections are ignored during image generation input shaping, including:
  - Dialogue
  - Background sound/audio cues
  - timeline/shot markers
  - multi-shot sequencing language
- For multi-scenario prompt blocks, first scenario is used for single-image generation.
- Inpainting path now uses the same focused prompt shaping.

### 4) Video Generator robustness improvements
- Added fallback and retry strategy for video generation:
  - model fallback
  - prompt compression fallback
  - with-reference / without-reference attempts
- Added richer failure detail when operation completes without returned video.

### 5) Workflow execution: multi-scenario video sequencing
- Added scenario splitter in frontend workflow runtime.
- Multi-scenario video prompts are split and generated sequentially (1/N -> 2/N -> ...).
- Result node stores multi-video outputs (`generatedVideoUrls`) and keeps backward-compatible `generatedVideoUrl` (first item).

### 6) Diagnostics for image generation failures
- Image generation path now captures and surfaces additional diagnostics when no image is returned:
  - finish reasons
  - prompt feedback
  - safety snippets (if present)

## Known Behavior and Limits
- Prompt Agent may still produce structured text that is better suited for video than single-image generation. Image path now tries to sanitize this automatically.
- External UI products (e.g., Nanobanana) may still succeed with the same text due to different internal request settings/model routing; API behavior here can differ.
- If a model returns text-only or filtered outputs, generation can still fail after retries.

## Files Updated in This Work
- `nanogen/services.py`
- `nanogen/static/nanogen/js/app.js`

## Operational Notes
- Untracked local files currently present and intentionally not included in commit:
  - `drawflow.min.js.tmp`
  - `nanogen/workflow_store.json`

## Suggested Verification Checklist
1. Prompt Agent with two text nodes and one image reference runs without local-prompt-required error.
2. Image Generator receives structured prompt and still returns image (or returns richer diagnostics on failure).
3. Video Generator with multi-scenario prompt generates sequentially and stores multiple results.
4. Existing single-video and single-image flows still function.
