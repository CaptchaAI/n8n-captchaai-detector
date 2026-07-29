# Changelog

## 0.1.0

Initial release.

- Detect-only CaptchaAI Detect node: reCAPTCHA v2 (standard/invisible/enterprise), reCAPTCHA v3
  (standard/enterprise), Cloudflare Turnstile, GeeTest v3, FriendlyCaptcha, CaptchaFox, Lemin,
  reCAPTCHA image grids, BLS, and Normal Image (OCR, including BotDetect-style widgets).
- All-frame DOM scanning with a top-frame-only JS hook (grecaptcha/turnstile/initGeetest),
  matching the source extension's own content-script scope split.
- Bundled Playwright + Chromium, with a postinstall download and a runtime fallback message.
- Apache License 2.0 + attribution addendum (see `LICENSE.md`, `NOTICE`).
