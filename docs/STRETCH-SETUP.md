# Stretch Setup — Bright Data (geo routing) + Bitrefill (real purchase)

The demo core runs without these (mock providers). Add them to go from *mock → real*.
All values go into `.env.local` (gitignored). The provider factory auto-switches to real once the vars are present.

---

## 1. Bright Data — real country-IP routing

> Replaces the Tavily geo-fallback with an actual request from inside the target country.

### Steps
1. Sign up: https://brightdata.com (free trial available).
2. Dashboard → **Proxies & Scraping** → **Add** → **Residential Proxies** (or **Datacenter** if you need it instantly without KYC).
3. Name the zone, e.g. `subpilot-resi`. Create it.
4. Open the zone → **Access parameters**. You get:
   - **Host:** `brd.superproxy.io`
   - **Port:** `33335`
   - **Username:** `brd-customer-<CUSTOMER_ID>-zone-subpilot-resi`
   - **Password:** `<zone password>`
5. (Residential only) Complete **KYC** if prompted — can take time; use the trial/Datacenter meanwhile.

### Country targeting
Append `-country-<cc>` to the **username** (ISO-2, lowercase):
```
brd-customer-<ID>-zone-subpilot-resi-country-in   # India
brd-customer-<ID>-zone-subpilot-resi-country-tr   # Turkey
```

### .env.local
```bash
BRIGHTDATA_HOST=brd.superproxy.io
BRIGHTDATA_PORT=33335
BRIGHTDATA_USERNAME=brd-customer-<ID>-zone-subpilot-resi
BRIGHTDATA_PASSWORD=<zone password>
```
(The app appends `-country-<cc>` per request — do **not** hardcode a country here.)

### Verify (terminal)
```bash
# India IP check — should report country IN
curl --proxy brd.superproxy.io:33335 \
  --proxy-user "brd-customer-<ID>-zone-subpilot-resi-country-in:<password>" \
  https://geo.brdtest.com/mygeo.json
```
Expect JSON with `"country":"IN"`. Then the geo-research agent fetches the real regional pricing page through this proxy.

---

## 2. Bitrefill — the one real gift-card purchase

> Buys a country-specific gift card (e.g. Spotify TR) with crypto and redeems it in-region — the legitimate geo-arbitrage path.

### Steps
1. Sign up: https://www.bitrefill.com
2. **Fund the account balance** with crypto: Account → **Balance** → deposit BTC / Lightning / ETH / USDT. Load enough for one gift card (~€5–10).
3. API access: https://www.bitrefill.com/account/dev-settings/ (a.k.a. "For Business" → API). Request/enable API → you get **API key** + **API secret** (HTTP Basic auth).
   - If approval isn't instant → use the **manual fallback** below for the live demo.
4. Product lookup: gift cards have per-country SKUs (e.g. `spotify_TR`, `netflix_IN`). The API lists products + countries.

### .env.local
```bash
BITREFILL_API_KEY=<key>
BITREFILL_API_SECRET=<secret>
```

### How a purchase works (API)
1. `GET /products` (or product detail) → confirm SKU + country + price.
2. Create an **invoice/order** for the SKU, paid from **account balance**.
3. Poll until `paid` → response contains the **redemption code / voucher**.
4. Redeem the code in the target service (account created behind the country IP).

### Manual fallback (if API approval is slow)
Do the real buy on the website: pick the country gift card → pay from balance → copy the code.
Paste the code into the app's **Execute** step — SubPilot records it in the audit trail. Demo still shows a *real* purchase.

---

## 3. End-to-end in SubPilot OS

Once the vars are in `.env.local`:

```
Upload CSV
  → Ingest detects subs
  → Interview (en-only? usage?)
  → RESEARCH: Daytona sandbox per sub×country, each routed via BRIGHT DATA country IP
               → real regional price (Tavily as cross-check/fallback)
  → Constraint + Optimizer → cheapest viable country + risk score
  → AWAITING_CONSENT  (you click the recommendation + confirm)
  → ACT: Daytona action sandbox
          → BITREFILL buys the country gift card (real, 1×) from crypto balance
          → redeem code / create in-region account
          → cancel old expensive plan (dry-run unless fully wired)
  → Report: €/month saved + full audit trail
```

### Smoke tests (from AGENT-BUILD-PROMPT WPs)
```bash
pnpm tsx scripts/smoke-search.ts "Spotify price India 2026"   # Tavily
pnpm tsx scripts/smoke-daytona.ts                              # 1 sandbox up/down
# after keys:
curl --proxy ... https://geo.brdtest.com/mygeo.json           # Bright Data country
```

### Safety
- Secrets only in `.env.local`. Never commit.
- Real action requires an explicit **consent token** (the Execute click). Everything else is dry-run.
- Surface the **risk score** for every geo option; prefer the gift-card path over raw VPN signup.
