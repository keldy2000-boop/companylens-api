# Global x402 Challenge — Competition Submission
## CompanyLens

---

### Project name
CompanyLens

### One-line description
UK company risk intelligence API — structured due diligence profiles, pay per query via x402 on Algorand.

---

### What the payment unlocks

A single HTTP request to `GET /company/{number}` returns a structured risk profile for any UK-registered company, sourced from live Companies House data and synthesised by Claude into:

- **Risk score** (0–100), deterministically computed from filing behaviour, director records, charges, and PSC data
- **Risk flags** — colour-coded signals (overdue accounts, director resignations, dissolution notices, no PSC, etc.)
- **Plain-English intelligence summary** — specific facts, not boilerplate
- **Ownership summary** — from PSC register
- **Actionable recommendation** — one direct sentence

Price: **0.50 USDC per request** on Algorand, settled via GoPlausible facilitator.

---

### Who is paying for it

The primary buyer is an **AI agent doing autonomous due diligence** — before executing a contract, onboarding a supplier, processing a payment, or approving a transaction, the agent calls CompanyLens to screen the counterparty. No API key, no account, no subscription required — the agent pays per query and gets a structured result it can feed directly into its decision pipeline.

Secondary buyer: a developer or analyst integrating company screening into an automated workflow, paying per call rather than committing to a subscription tier.

**Real-world scenarios:**
- A procurement agent checks a new supplier before raising a purchase order
- An accounts payable automation screens a company before releasing payment
- A legal agent verifies a counterparty before executing a contract
- A KYB (Know Your Business) pipeline calls the API as one step in an onboarding flow

---

### Entry type

**Standard** — one endpoint, one price, one clear capability.

---

### Technical implementation

**Stack:**
- Node.js + Express
- `@x402-avm/express` — x402 payment middleware
- GoPlausible facilitator — payment verification and on-chain settlement
- Companies House API — live UK company data (free)
- Anthropic Claude (claude-sonnet-4-6) — intelligence synthesis

**Algorand configuration:**
- Network: `ALGORAND_Mainnet_CAIP2`
- USDC ASA: `31566704`
- Facilitator: `https://facilitator.goplausible.xyz`
- Tag: `x402-global-challenge`

**Discovery:**
- `/.well-known/x402.json` — Bazaar descriptor
- `/llms.txt` — agent-readable service description
- OpenGraph metadata on landing page

**Scoring model:**
The risk score is computed deterministically from Companies House data before Claude sees it. Claude synthesises the output but cannot override the score. This separation means the score is reproducible and auditable — two calls to the same company at the same time return the same score.

---

### Why Algorand

UK company due diligence queries are high-frequency and low-value — the economics only work with sub-cent fees and instant finality. Algorand's fixed fee structure makes 0.50 USDC per call viable as a business model; on Ethereum mainnet, gas costs would eat the margin. The synchronous request-response pattern of x402 maps directly onto Algorand's deterministic finality — no waiting for block confirmations inside the API call.

---

### Long-term potential

The Companies House API covers 5 million+ active UK companies. Every agent-enabled procurement system, accounts payable automation, legal workflow, or KYB pipeline is a potential buyer. The per-call pricing model removes the barrier of subscription commitment — an agent can screen one company for a one-off deal or run 10,000 checks for a bulk onboarding without negotiating a contract.

Immediate extensions:
- Bulk lookup endpoint (multiple companies per payment)
- Director disqualification check (integrated with Insolvency Service API)
- Historical risk trend — compare current profile to 12 months ago
- Webhook endpoint — agent registers a company for ongoing monitoring, pays per change event

---

### Wallet address (payTo)
[Your Algorand mainnet USDC-opted wallet address]

### Live endpoint
https://api.companylens.xyz/company/{number}

### Demo
https://claude.ai/artifact/C5UdD2J4ghkCXwzdLnk52q

### GitHub repository
[Your repository URL — also submit to Electric Capital]

### Leaderboard
https://facilitator.goplausible.xyz/dashboard/leaderboards (filter: x402-global-challenge)
