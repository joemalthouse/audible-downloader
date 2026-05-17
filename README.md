# Audible Downloader

Independent open-source web app for saving your own Audible books as
plain M4B files. It signs in through Amazon, loads the Audible library for
that account, and converts selected titles in the browser.

Live site: <https://audible-downloader.pages.dev/>

[![Buy me a coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=joemalthouse&button_colour=FFDD00&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/joemalthouse)

Not affiliated with Audible, Amazon, or any other vendor.

## Use

1. Open the live site in a current Chromium-based browser.
2. Sign in with the Amazon account used for Audible.
3. Load the library.
4. Click **Download** on a title.
5. Choose where to save the finished M4B file when the browser asks.

## What it does

- Shows the signed-in Audible library.
- Downloads the encrypted AAX/AAXC source for a selected title.
- Requests the matching Audible licence for that title.
- Converts the book to M4B in the browser with a trimmed `ffmpeg.wasm`
  build.
- Saves the completed M4B file locally, with chapters preserved.

The browser is the only place decrypted audio exists. Cloudflare Pages
Functions handle the small auth/API calls and the CloudFront byte relay
needed because those endpoints cannot be called directly from a static
page under normal browser CORS rules.

Only use this with Audible titles your account is allowed to access.

## Browser support

Use a current Chromium-based browser. The app depends on browser features
such as WebAssembly, `DecompressionStream`, and the File System Access API
for saving large files cleanly.

Firefox and Safari are not target browsers at the moment.

## Limitations

- The app needs a network connection to Amazon, Audible and Audible's CDN.
- The saved file is produced after the browser has downloaded and converted
  the source, so large books need time, memory and disk space.
- The sign-in flow depends on Amazon's current mobile-device auth endpoints.
  If Amazon changes that flow, the app may need updating.

## How it fits together

- **Static site** (`index.html`, `app.js`, `styles.css`, `_headers`) is
  served from Cloudflare Pages.
- **Pages Functions** under `functions/` are thin pass-throughs to
  Amazon's auth and Audible's API:
  - `auth/login/start.js`, `auth/login/finish.js` — Amazon OAuth + PKCE
    plus the device-registration handshake at `api.amazon.<tld>/auth/register`.
  - `auth/accounts.js` — reflects the identity sent by the browser.
  - `library.js`, `license/[asin].js` — sign per-request with the
    device key and forward `api.audible.<tld>` responses unchanged.
  - `source.js` — byte proxy for Audible CloudFront so the browser can
    read past the CDN's CORS policy.
- **`functions/_shared/audible.js`** — the auth + signing implementation
  shared by every Function (and the local helper).
- **`vendor/ffmpeg/`** — a trimmed `ffmpeg.wasm` core (765 KiB
  uncompressed, 344 KiB gzipped) that only contains the MOV demuxer
  with Audible's `audible_key` / `audible_iv` decryption path plus the
  `mp4` / `ipod` muxers and the `aac` parser.

## Local development

Install dependencies once:

```bash
npm ci
```

Run the local helper:

```bash
node helper-server.mjs
# http://127.0.0.1:5174
```

The helper serves the static files and re-implements the same Pages
Functions using `functions/_shared/audible.js`, so the local UI behaves
identically to the deployed site.

Run syntax checks:

```bash
npm run check
```

## Deploy

GitHub Actions deploys to Cloudflare Pages on every push to `main` via
`.github/workflows/deploy-cloudflare-pages.yml`.

Required GitHub configuration:

- Secret `CLOUDFLARE_API_TOKEN`
- Secret `CLOUDFLARE_ACCOUNT_ID`
- Optional variable `CLOUDFLARE_PAGES_PROJECT` if the Pages project is
  not named `audible-downloader`

Required Cloudflare Pages configuration (set once per project):

- Secret `SOURCE_PROXY_SECRET` — random 32+ byte value used by the
  Pages Functions to HMAC-sign CloudFront URLs handed to the
  `/source` proxy. Generate with `openssl rand -hex 32` and install
  via `npx wrangler pages secret put SOURCE_PROXY_SECRET --project-name=audible-downloader`.

For local development, put the same variable in a `.dev.vars` file at
the repo root (already gitignored):

```
SOURCE_PROXY_SECRET=<paste hex from openssl rand>
```

If `.dev.vars` is missing, the helper generates an ephemeral secret per
process boot; signed URLs from `/license` will stop working when the
helper restarts.

Build the Cloudflare Pages output locally:

```bash
npm run build
```

The build writes `dist/`, including the static app, Pages metadata and the
vendored ffmpeg assets.

## Rebuilding the ffmpeg core

```bash
bash scripts/build-ffmpeg-aaxc-core.sh
```

Prerequisites: `build/emsdk` (Emscripten 3.1.40) and `build/ffmpeg`
(FFmpeg n5.1.4). The script's header documents the exact layout it
expects.

The rebuilt core is committed under `vendor/ffmpeg/core/dist/esm/` so the
Cloudflare build does not need to compile ffmpeg.

## Privacy

- No database, KV namespace or R2 bucket is used.
- Audible identity data is stored in the browser's `localStorage`.
- Pages Functions do not store library, licence or audio responses.
- No analytics or telemetry are included.

## Support

If this project is useful, you can support development here:
<https://buymeacoffee.com/joemalthouse>

[![Buy me a coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=joemalthouse&button_colour=FFDD00&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/joemalthouse)

## Licence

MIT.
