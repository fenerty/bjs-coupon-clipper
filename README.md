# BJ's Coupon Clipper Userscript

Version 2.0.1 runs inside Brave with Tampermonkey and supports BJ's `CLIP` buttons as well as the earlier `+ CLIP TO CARD` buttons. It only clips after you press `Clip Coupons`; loading the page does not start a run.

[Install the userscript](https://raw.githubusercontent.com/fenerty/bjs-coupon-clipper/main/bjs-coupons.user.js)

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Brave.
2. In Brave's extension settings, enable Tampermonkey's `Allow user scripts` setting and allow access to `www.bjs.com`. See [Tampermonkey's permission instructions](https://www.tampermonkey.net/faq.php?q=Q209).
3. Open the [userscript install link](https://raw.githubusercontent.com/fenerty/bjs-coupon-clipper/main/bjs-coupons.user.js). Tampermonkey should display an installation page; review the script and choose `Install`.
4. If the link displays plain text instead, open Tampermonkey, choose `Create a new script`, replace the template with [bjs-coupons.user.js](bjs-coupons.user.js), and save with `Ctrl+S`.
5. Make sure the script is enabled, then reload the BJ's tab. The `BJ's Coupon Clipper 2.0` panel should appear in the bottom-right corner. Do not install multiple copies of the script.

The script's update URLs point to this repository. Tampermonkey can check for later versions through its normal update controls. If you installed an older copy manually, replace that copy rather than creating a duplicate.

## Run

1. Open `https://www.bjs.com/myCoupons` in Brave and sign in normally.
2. Make sure you are on the Available coupons view.
3. Use the floating `BJ's Coupon Clipper` panel in the bottom-right corner.
4. Click `Clip Coupons`.

## What it does

- Uses the current page's coupon attributes, with an exact-label fallback for the older controls
- Loads more coupons only when needed
- Sends one clip at a time and waits for BJ's `Clipped` badge or a confirmed change in the clipped total
- Uses a minimum 450 ms between requests, replacing the previous fixed wait of about 2.5 seconds per coupon; slower responses automatically slow the run
- Shows live counts for `found`, `clicked`, `skipped`, and `failed`
- Offers a `Stop` button and a timestamped download log with coupon descriptions and response times

`found` counts available controls discovered during this run. `clicked` counts confirmed clips. `skipped` counts coupons that become clipped before the script sends a request. `failed` counts requests that throw or are not confirmed; the script stops on the first such request. The page's `Showing N Coupons` count is logged separately because it can include cards already clipped in the current view.

## Notes

- Keep the BJ's tab selected while running. If you select another tab or minimize Brave, the script pauses new requests until you return. Another foreground window does not necessarily hide the tab, so it may continue in that case.
- `Stop` lets an already-sent request finish before sending any more.
- The script never clicks `ADD TO CART` or `SHOP ALL ITEMS` and does not bypass access-denied or verification pages.
- It uses the account already signed in through your browser. It does not collect or save credentials, and it does not send coupon data to this repository or another service.
- Downloaded logs contain coupon descriptions and timestamps. Review them before sharing; do not upload browser profiles, cookies, session state, or screenshots containing account information.
- BJ's can still change their page markup, so selectors may need updates later.
- Changing filters, tabs, or coupons during a run can interrupt it. Wait for it to finish before making changes.
- This is an independent personal-use utility, not affiliated with or endorsed by BJ's Wholesale Club. Use it only on your own account and subject to the site's terms and coupon restrictions. Request pacing does not guarantee acceptance by the site.

## Regression Testing

With Node.js available:

```powershell
node --check bjs-coupons.user.js
node --check tests/serve-fixture.cjs
node tests/serve-fixture.cjs
```

Open the localhost URL printed by the server. This synthetic fixture starts automatically and never contacts BJ's or uses your account. It reports `PASS` or `FAIL` for each scenario selected through its `case` query parameter. Stop the server with `Ctrl+C`.

Available cases: `205`, `duplicate`, `legacy`, `removed`, `tab`, `disabled`, `background`, `timeout`, `rate-limit`, `stop`, `zero`, and `paced`.

Scenarios cover 205 lazily loaded coupons, duplicate descriptions, older labels, removed/replaced tiles, switching to Available, disabled controls, background pause, an unconfirmed request, a rate-limit notice, Stop, already-clipped coupons, and the production request interval. Test delays are accelerated except for the `paced` scenario; production settings are never modified.
