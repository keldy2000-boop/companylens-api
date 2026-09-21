import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fetchCompanyProfile, scoreRisk } from './intelligence.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── x402 payment middleware ──────────────────────────────────────────────────
// Dynamically load @x402-avm/express — falls back to manual 402 if not available
let paymentMiddleware = null;
try {
  const mod = await import('@x402-avm/express');
  paymentMiddleware = mod.paymentMiddleware;
  console.log('x402-avm/express loaded successfully');
} catch (e) {
  console.log('x402-avm/express not available — using manual 402 flow');
}

// Manual 402 middleware fallback (works without x402 package)
function manual402(req, res, next) {
  const payment = req.headers['x-payment'];
  if (!payment) {
    return res.status(402).json({
      error: 'Payment Required',
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        asset: 'USDC',
        amount: '0.50',
        network: process.env.ALGORAND_NETWORK || 'ALGORAND_Mainnet_CAIP2',
        recipient: process.env.WALLET_ADDRESS,
        description: 'UK company risk profile from Companies House data',
        tag: 'x402-global-challenge',
      }],
      facilitatorUrl: process.env.FACILITATOR_URL || 'https://facilitator.goplausible.xyz',
    });
  }
  next();
}

// Apply x402 middleware — use real package if available, manual fallback otherwise
if (paymentMiddleware && process.env.WALLET_ADDRESS) {
  try {
    app.use('/company/:number', paymentMiddleware(
      process.env.WALLET_ADDRESS,
      {
        '/company/:number': {
          price: '$0.50',
          network: process.env.ALGORAND_NETWORK || 'ALGORAND_Mainnet_CAIP2',
          config: {
            description: 'UK company risk profile: risk score 0–100, structured flags, ownership summary, and actionable recommendation from live Companies House data.',
            tag: 'x402-global-challenge',
          },
        },
      },
      {
        facilitatorUrl: process.env.FACILITATOR_URL || 'https://facilitator.goplausible.xyz',
      }
    ));
    console.log('x402 payment middleware active');
  } catch (e) {
    console.log('x402 middleware setup failed, using manual fallback:', e.message);
    app.use('/company/:number', manual402);
  }
} else {
  app.use('/company/:number', manual402);
}

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

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CompanyLens',
    version: '1.0.0',
    network: process.env.ALGORAND_NETWORK || 'not set',
    price: '0.50 USDC per lookup',
    wallet: process.env.WALLET_ADDRESS ? `${process.env.WALLET_ADDRESS.slice(0,8)}...` : 'not set',
  });
});

// ── Well-known x402 descriptor (Bazaar discovery) ────────────────────────────
app.get('/.well-known/x402.json', (req, res) => {
  res.json({
    name: 'CompanyLens',
    description: 'UK company risk intelligence. Returns a structured risk profile — score 0-100, flags, ownership summary, and recommendation — from live Companies House data, synthesised by Claude.',
    version: '1.0.0',
    endpoints: [{
      path: '/company/{number}',
      method: 'GET',
      description: 'Risk profile for a UK company by Companies House registration number.',
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

// ── llms.txt (agent discovery) ───────────────────────────────────────────────
app.get('/llms.txt', (req, res) => {
  res.type('text/plain').send(`# CompanyLens
> UK company risk intelligence API — pay per query, no subscription

CompanyLens returns structured risk profiles for UK companies from Companies House data.
Payment: 0.50 USDC per request via x402 on Algorand. No API keys or accounts required.

## Endpoint
GET /company/{number}
- number: Companies House number e.g. 00445790
- Returns: risk_score, risk_level, flags, ownership, recommendation

## Use cases
- AI agent due diligence before contract execution
- Automated supplier onboarding risk screening
- KYB checks within agentic workflows
`);
});

// ── Serve landing page ───────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  try {
    const html = readFileSync(join(__dirname, '../public/index.html'), 'utf8');
    res.type('html').send(html);
  } catch {
    res.redirect('https://claude.ai/artifact/C5UdD2J4ghkCXwzdLnk52q');
  }
});

app.listen(PORT, () => {
  console.log(`\nCompanyLens running on port ${PORT}`);
  console.log(`Network:  ${process.env.ALGORAND_NETWORK || 'not set'}`);
  console.log(`Wallet:   ${process.env.WALLET_ADDRESS ? process.env.WALLET_ADDRESS.slice(0,8) + '...' : 'not set'}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET /company/:number  — 0.50 USDC (x402 gated)`);
  console.log(`  GET /health           — free`);
  console.log(`  GET /.well-known/x402.json`);
  console.log(`  GET /llms.txt\n`);
});
