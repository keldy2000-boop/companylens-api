# CompanyLens

Risk profiles for UK companies, built from live Companies House data, for AI agents that need to check a counterparty before they act. Paid per lookup: **0.50 USDC via x402 on Algorand MainNet**. No account or API key.

Built for the [Algorand Global x402 Challenge](https://algorand.co/global-x402-challenge).

## Endpoint

```
GET https://companylens-api-production.up.railway.app/company/{number}
```

`{number}` is a Companies House registration number, e.g. `00445790` (Tesco PLC).

1. Without payment the endpoint returns **HTTP 402** with the price and payment details.
2. An x402 client pays 0.50 USDC on Algorand. The [GoPlausible facilitator](https://facilitator.goplausible.xyz) verifies and settles it and covers the network fee.
3. The paid request returns the risk profile as JSON.

If the company doesn't exist (404) or Companies House can't be reached (503), the request fails and the payment is not settled.

## Response

Real response for `00445790`, trimmed:

```json
{
  "company_number": "00445790",
  "company_name": "TESCO PLC",
  "risk_score": 0,
  "risk_level": "low",
  "flags": [{ "type": "ok", "icon": "✓", "text": "Company status: Active" }],
  "recommendation": "Proceed with confidence for standard commercial engagement...",
  "_source": "companies-house"
}
```

Full responses also include `status`, `incorporated`, `sic_codes`, `registered_address`, `health_summary`, `data` and `ownership`.

## How the score works

The score (0–100) is calculated by fixed rules in `src/intelligence.js` from the Companies House profile, officers, filing history, charges and PSC register. Claude then writes the summary and recommendation from that data, but cannot change the score. If Claude is unavailable, the score and flags are still returned.

| Signal | Points |
| --- | --- |
| Dissolved | +50 |
| Liquidation, receivership or administration | +45 |
| Gazette or dissolution notice | +30 |
| Accounts overdue > 60 days | +25 |
| No active directors | +20 |
| Incorporated < 12 months | +20 |
| Other non-active status | +20 |
| Accounts overdue 1–60 days | +15 |
| No PSC recorded (and not exempt or declared) | +15 |
| Incorporated 1–2 years | +12 |
| 3+ director resignations in 12 months | +12 |
| Confirmation statement overdue | +10 |
| More than 8 outstanding charges | +8 |
| Incorporated 2–5 years | +6 |

Low 0–29, medium 30–59, high 60–100.

## Stack

- Node.js + Express
- x402: `@x402-avm/express`, `@x402-avm/core`, `@x402-avm/avm`, `@x402-avm/extensions` (Bazaar discovery)
- Settlement: GoPlausible facilitator, USDC (ASA 31566704) on Algorand MainNet
- Data: [Companies House REST API](https://developer.company-information.service.gov.uk)
- Summaries: Anthropic Claude

## Run your own

```
npm install
```

Set these environment variables (see `.env.example`):

- `CH_API_KEY`: Companies House **REST** API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `WALLET_ADDRESS`: Algorand MainNet address opted in to USDC (ASA 31566704)
- `FACILITATOR_URL`: `https://facilitator.goplausible.xyz`

```
npm start
```

Free routes: `/health`, `/llms.txt`, `/.well-known/x402.json`.

Data from Companies House. Not financial or legal advice.
