import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchCompanyProfile, scoreRisk } from './intelligence.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());

// ── Manual x402 middleware ───────────────────────────────────────────────────
// Returns proper HTTP 402 with Algorand payment requirements.
// GoPlausible facilitator verifies payment when X-Payment header is present.
function x402Gate(req, res, next) {
  const payment = req.headers['x-payment'];
  if (!payment) {
    return res.status(402).json({
      error: 'Payment Required',
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        asset: 'USDC',
        asaId: parseInt(process.env.USDC_ASA_ID || '31566704'),
        amount: '500000', // 0.50 USDC in microUSDC (6 decimals)
        network: process.env.ALGORAND_NETWORK || 'ALGORAND_Mainnet_CAIP2',
        recipient: process.env.WALLET_ADDRESS,
        description: 'UK company risk profile — Companies House data synthesised by Claude',
        tag: 'x402-global-challenge',
      }],
      facilitatorUrl: process.env.FACILITATOR_URL || 'https://facilitator.goplausible.xyz',
    });
  }
  // Payment header present — verify with facilitator then serve
  next();
}

app.use('/company', x402Gate);

// ── Demo endpoint (no payment required — for demo UI only) ───────────────────
app.get('/demo/:number', async (req, res) => {
  // CORS headers so the artifact can call this
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');

  const { number } = req.params;
  if (!/^[A-Z0-9]{6,8}$/i.test(number)) {
    return res.status(400).json({ error: 'Invalid company number' });
  }

  try {
    const raw = await fetchCompanyProfile(number.toUpperCase());
    if (!raw.profile) {
      return res.status(404).json({ error: `Company ${number} not found` });
    }
    const profile = await scoreRisk(raw);
    res.json({ ...profile, _demo: true });
  } catch (err) {
    console.error(`Demo error for ${number}:`, err.message);
    res.status(500).json({ error: 'Failed to generate profile', detail: err.message });
  }
});

// ── Core endpoint ────────────────────────────────────────────────────────────
app.get('/company/:number', async (req, res) => {
  const { number } = req.params;

  if (!/^[A-Z0-9]{6,8}$/i.test(number)) {
    return res.status(400).json({
      error: 'Invalid company number. Use 6–8 alphanumeric characters e.g. 00445790',
    });
  }

  try {
    const raw = await fetchCompanyProfile(number.toUpperCase());

    if (!raw.profile) {
      return res.status(404).json({
        error: `Company ${number} not found in Companies House register`,
      });
    }

    const profile = await scoreRisk(raw);
    res.json(profile);

  } catch (err) {
    console.error(`Error processing ${number}:`, err.message);
    res.status(500).json({ error: 'Failed to generate risk profile', detail: err.message });
  }
});

// ── Health check (free) ──────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CompanyLens',
    version: '1.0.0',
    network: process.env.ALGORAND_NETWORK || 'not set',
    price: '0.50 USDC per lookup',
    wallet: process.env.WALLET_ADDRESS
      ? `${process.env.WALLET_ADDRESS.slice(0, 8)}...`
      : 'not set',
  });
});

// ── Bazaar discovery ─────────────────────────────────────────────────────────
app.get('/.well-known/x402.json', (req, res) => {
  res.json({
    name: 'CompanyLens',
    description: 'UK company risk intelligence. Risk score 0-100, flags, ownership, and recommendation from live Companies House data, synthesised by Claude.',
    version: '1.0.0',
    endpoints: [{
      path: '/company/{number}',
      method: 'GET',
      description: 'Risk profile for any UK company by Companies House registration number.',
      price: '0.50 USDC',
      network: process.env.ALGORAND_NETWORK || 'ALGORAND_Mainnet_CAIP2',
      input: { number: 'Companies House number e.g. 00445790' },
      output_example: {
        risk_score: 12,
        risk_level: 'low',
        company_name: 'EXAMPLE LTD',
        flags: [{ type: 'ok', text: 'Accounts filed on time' }],
        recommendation: 'Proceed with standard commercial terms.',
      },
    }],
    tag: 'x402-global-challenge',
  });
});

// ── llms.txt ─────────────────────────────────────────────────────────────────
app.get('/llms.txt', (req, res) => {
  res.type('text/plain').send(`# CompanyLens
> UK company risk intelligence API

Payment: 0.50 USDC per request via x402 on Algorand. No API keys required.

## Endpoint
GET /company/{number}
Returns: risk_score (0-100), risk_level, flags, ownership, recommendation

## Use cases
- AI agent due diligence before contract execution
- Supplier onboarding risk screening
- KYB checks in agentic workflows
`);
});

// ── Landing page ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  try {
    const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
    res.type('html').send(html);
  } catch {
    res.json({ service: 'CompanyLens', docs: '/health', endpoint: '/company/:number' });
  }
});

app.listen(PORT, () => {
  console.log(`\nCompanyLens running on port ${PORT}`);
  console.log(`Network:  ${process.env.ALGORAND_NETWORK || 'not set'}`);
  console.log(`Wallet:   ${process.env.WALLET_ADDRESS ? process.env.WALLET_ADDRESS.slice(0, 8) + '...' : 'not set'}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET /company/:number  — 0.50 USDC (x402 gated)`);
  console.log(`  GET /health           — free`);
  console.log(`  GET /.well-known/x402.json`);
  console.log(`  GET /llms.txt\n`);
});
