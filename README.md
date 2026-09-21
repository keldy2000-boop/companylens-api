# CompanyLens

**UK company risk intelligence — pay per query via x402 on Algorand**

Returns a structured risk profile (score 0–100, flags, ownership summary, recommendation) from live Companies House data, synthesised by Claude. No API keys, subscriptions, or accounts required — payment is 0.50 USDC per request via the x402 protocol on Algorand.

Built for the [Algorand Global x402 Challenge](https://algorand.co/global-x402-challenge).

---

## Quick start

### 1. Get your API keys

| Key | Where |
|---|---|
| Companies House API key | [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk) — free |
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com) |
| Algorand wallet address | Any Algorand wallet (Pera, MyAlgo) — must be opted into USDC ASA `31566704` |

### 2. Install and configure

```bash
git clone <your-repo>
cd companylens-api
npm install
cp .env.example .env
# Edit .env with your keys
```

### 3. Run on testnet first

```bash
# In .env, set:
# ALGORAND_NETWORK=ALGORAND_Testnet_CAIP2
# USDC_ASA_ID=10458941

npm run dev
node src/test-payment.js
```

Get testnet USDC from [faucet.circle.com](https://faucet.circle.com) to test the full payment loop.

### 4. Switch to mainnet

```bash
# In .env, change:
# ALGORAND_NETWORK=ALGORAND_Mainnet_CAIP2
# USDC_ASA_ID=31566704
```

---

## Deploy

### Render (recommended — simplest)

1. Push to GitHub
2. New Web Service → connect repo
3. Set env vars in Render dashboard
4. Use `deploy/render.yaml` as reference

### Railway

1. Push to GitHub  
2. New Project → Deploy from GitHub repo
3. Set env vars in Railway dashboard
4. Uses `deploy/railway.toml`

### Manual (any VPS)

```bash
npm install
node src/server.js
# Recommend: pm2 start src/server.js --name companylens
```

---

## API

### `GET /company/:number`

**Payment required:** 0.50 USDC via x402 on Algorand

**Parameters:**
- `number` — Companies House number (6–8 chars, e.g. `00445790`, `SC070460`)

**Response:**
```json
{
  "company_number": "00445790",
  "company_name": "MARKS AND SPENCER PLC",
  "status": "active",
  "incorporated": "1926-09-26",
  "risk_score": 12,
  "risk_level": "low",
  "health_summary": "Long-established FTSE-listed retailer...",
  "flags": [
    { "type": "ok", "icon": "✓", "text": "Accounts filed on time" }
  ],
  "data": [
    { "label": "Incorporated", "value": "26 Sep 1926" }
  ],
  "ownership": "Publicly listed — PSC reflects institutional nominee arrangements",
  "recommendation": "Low risk. Proceed with standard commercial terms."
}
```

### `GET /health` — Free

### `GET /.well-known/x402.json` — Bazaar discovery descriptor

### `GET /llms.txt` — Agent discovery

---

## How x402 payment works

1. Agent calls `GET /company/00445790` with no auth
2. Server returns `402 Payment Required` with payment terms
3. Agent signs 0.50 USDC Algorand transaction, submits to GoPlausible facilitator
4. Facilitator returns signed payment proof
5. Agent retries request with `X-Payment` header
6. Middleware verifies proof → Companies House data fetched → Claude synthesises → JSON returned

---

## Scoring model

The risk score (0–100) is computed deterministically before Claude:

| Signal | Weight |
|---|---|
| Dissolved | +50 |
| Liquidation / administration | +45 |
| Gazette / dissolution notice | +30 |
| Accounts overdue >60 days | +25 |
| No active directors | +20 |
| Incorporated <12 months | +20 |
| Non-active status (other) | +20 |
| No PSC recorded | +15 |
| Accounts overdue 1–60 days | +15 |
| Incorporated 1–2 years | +12 |
| 3+ director resignations in 12 months | +12 |
| Confirmation statement overdue | +10 |
| Incorporated 2–5 years | +6 |
| 1–2 director resignations in 12 months | +4 |
| 8+ outstanding charges | +8 |

Claude synthesises the summary and recommendation but cannot change the score.

---

## Competition

This project is entered in the [Algorand Global x402 Challenge](https://algorand.co/global-x402-challenge).

- All payments route through GoPlausible facilitator at `facilitator.goplausible.xyz`
- Tag `x402-global-challenge` set on the endpoint
- Submission deadline: **30 September 2026**
- GitHub repo submitted to [Electric Capital](https://github.com/electric-capital/open-dev-data)
