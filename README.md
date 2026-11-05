# n8n-nodes-captchaai-detect

A **detect-only** [n8n](https://n8n.io/) community node that finds CAPTCHA widgets on a page -
reCAPTCHA (v2, v2 invisible, v2 enterprise, v3, v3 enterprise), Cloudflare Turnstile, GeeTest v3,
FriendlyCaptcha, CaptchaFox, Lemin, reCAPTCHA image grids, BLS challenges, and Normal Image (OCR)
captchas including BotDetect-style widgets - and returns their identifying parameters
(sitekey, action, `gt`/`challenge`, an inline base64 image, and so on) as workflow items.

**This node never solves a CAPTCHA.** It never injects a token, never submits a form, and never
calls any CaptchaAI (or other) solving API. It is a pure detector: point it at a URL, get back a
structured description of what CAPTCHA widgets are on the page and what a solve call for each of
them would need.

It is ported from the detection logic inside the CaptchaAI browser extension, running against a
bundled headless Chromium (via [Playwright](https://playwright.dev/)) instead of as a browser
extension - see "How it works" below for the frame-scanning and hook model this implies.

---

## Install

Through n8n's UI: **Settings → Community Nodes → Install**, package name `n8n-nodes-captchaai-detect`.

Or with npm, inside your n8n installation:

```bash
npm install n8n-nodes-captchaai-detect
```

### Chromium

This package bundles Playwright and downloads its own Chromium build automatically on install
(`postinstall` runs `playwright install chromium`). Two things to know:

- **If your environment runs `npm install --ignore-scripts`** (common in some Docker/CI setups),
  the automatic download is skipped. Run it manually once inside the package directory:

  ```bash
  npx playwright install chromium
  ```

  The node's own error message repeats this exact command if it ever fails to launch the browser.

- **Chromium itself needs OS-level shared libraries** to run headless on Linux (fonts, `libnss3`,
  `libatk`, etc.). If you are running n8n in Docker, the official
  [Playwright Docker images](https://playwright.dev/docs/docker) already have these; on a bare
  Debian/Ubuntu host you can install them with:

  ```bash
  npx playwright install-deps chromium
  ```

### Not eligible for n8n's verified marketplace

This package bundles an external dependency (Playwright + a downloaded Chromium binary) and
writes to the filesystem, which disqualifies it from n8n's verified community-node program (that
program requires zero external dependencies and no filesystem access). This is a deliberate,
accepted trade-off for a node whose entire job is driving a real browser - it is not something a
future update is expected to "fix". Install it as a standard (unverified) community node.

---

## How it works

1. Launches the bundled Chromium and navigates to the given URL (`networkidle`, falling back to
   `domcontentloaded` + a fixed settle delay for pages that never truly go idle).
2. Walks **every frame** on the page and runs every enabled DOM detector in each of them - this
   mirrors the source extension's own `all_frames: true` content script.
3. A **separate, top-frame-only** init script hooks `grecaptcha.render`/`execute`,
   `turnstile.render`, and `initGeetest`, purely to observe their call parameters - it always
   calls through to the real function and never blocks or mocks page behavior. This, too,
   mirrors the source extension: its own hook script has no `all_frames` flag and therefore only
   ever runs in the top frame. A same-origin iframe that renders its own Turnstile widget or
   calls its own `grecaptcha.execute()` is still found by the DOM walk in step 2, just without
   the extra parameters (action, `cData`, etc.) that only exist in the JS call arguments.
4. If you set **Trigger Selector**, it is clicked once after the page settles, then the hook
   store is re-read on a short bounded poll (with one final full DOM re-walk), since some widgets
   (reCAPTCHA v3, GeeTest v3, CaptchaFox) only produce their parameters after an interaction.
5. Every detection is deduplicated by `(type, sitekey, frameUrl, action)` - the same sitekey
   found in two different frames is reported as two separate items, since a solve call for a
   widget nested in an iframe needs to know which frame it lives in.

### Two intentional, documented exceptions to "detection only"

Everything above is passive - in particular, the reCAPTCHA v2 checkbox is **never** clicked to
force a grid challenge open; a grid is only reported if it is already visible. Two things do
interact with the page, though, both because there is no other way to see the data at all:

- **Closed shadow roots are widened to open.** The top-frame hook init script patches
  `Element.prototype.attachShadow` so a `mode: 'closed'` request becomes `mode: 'open'` (still
  calling through to the real implementation) - Turnstile can render into a closed shadow root,
  and there is no way to inspect it otherwise.
- **CaptchaFox is clicked once.** CaptchaFox's sitekey is never present in the DOM - it only
  appears as a path segment on a network request that fires when the widget is interacted with.
  If a CaptchaFox container is found and enabled, this node clicks it once (top frame only) and
  waits briefly for that request.

---

## Node parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| **URL** | string | — | Required. The page to load and scan. |
| **CAPTCHA Types** | multi-select | all types | Restrict which CAPTCHA types to look for. |
| **Timeout (ms)** | number | `30000` | Overall page-load budget. |
| **Trigger Selector** | string | — | Optional CSS selector to click once after load, then poll briefly for interaction-only types (reCAPTCHA v3, GeeTest v3, CaptchaFox). |
| **Image Selector** | string | — | Optional CSS selector for a specific Normal Image CAPTCHA image, when heuristic auto-detection isn't reliable enough. |
| **Input Selector** | string | — | Optional CSS selector for the Normal Image answer field, used to locate the matching image when Image Selector isn't set. |

## Output

One item per detected (and deduplicated) widget:

```jsonc
{
  "type": "recaptcha_v2",
  "pageurl": "https://example.com/signup",   // always the top-level page URL
  "frameUrl": "https://example.com/signup",  // the frame the widget was found in
  "source": "dom",                           // dom | hook | script-tag | network
  "sitekey": "6Lc...",
  "invisible": false,
  "enterprise": false,
  "solveParams": {                           // the exact params a solve API call would need
    "method": "userrecaptcha",
    "googlekey": "6Lc...",
    "pageurl": "https://example.com/signup"
  }
}
```

`pageurl` is always the top-level navigation URL; `frameUrl` is the specific frame the widget was
found in (these differ for widgets nested inside an iframe). Image-based types
(Normal Image, Grid Image) additionally carry `imageBase64` at the top level for convenience.
**BLS** returns **one item** with **`imagesBase64`** (nine raw base64 strings, empty string
for missing cells) and matching **`blsImage1`…`blsImage9`** fields for the
[CaptchaAI](https://github.com/CaptchaAI/n8n-nodes-captchaai) solve node. Wire the solve node with
CAPTCHA Type **BLS** and expressions such as `{{ $json.blsImage1 }}` … `{{ $json.blsImage9 }}`,
`{{ $json.instructions }}`. `solveParams` still uses full JPEG data URIs as
`image_base64_1`…`image_base64_9` for direct API use.

A zero-detection run is not an error - it returns an empty item array. The node only throws on
navigation failure, a browser-launch failure, or hitting the overall timeout (subject to n8n's
"Continue On Fail").

### GeeTest v4 is out of scope

The source extension has GeeTest v4 support disabled (`GEETEST_V4_ENABLED = false`); this node
carries that forward exactly - there is no GeeTest v4 hook, detector, or output field.

---

## Example workflow

See [`examples/detect-workflow.json`](examples/detect-workflow.json) - a Manual Trigger feeding
a CaptchaAI Detect node, with its output passed to a Set node for inspection. Import it via
**Workflows → Import from File** in n8n.

---

## License & attribution

Licensed under the Apache License, Version 2.0, plus a short set of additional terms (attribution
in your own README/NOTICE, a 30-day cure period on attribution defects, a trademark/logo
carve-out, and a modification-disclosure requirement for forks). See [`LICENSE.md`](LICENSE.md)
for the full text and [`NOTICE`](NOTICE) for the attribution notice to carry forward if you
redistribute this project.
