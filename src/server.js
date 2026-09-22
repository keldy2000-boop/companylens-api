import 'dotenv/config';
import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { paymentMiddleware } from '@x402-avm/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402-avm/core/server';
import { ExactAvmScheme } from '@x402-avm/avm/exact/server';
import * as avm from '@x402-avm/avm';
import * as ext from '@x402-avm/extensions';
import { fetchCompanyProfile, scoreRisk } from './intelligence.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────────────────────────────
const WALLET = process.env.WALLET_ADDRESS;
const FACILITATOR = process.env.FACILITATOR_URL || 'https://facilitator.goplausible.xyz';
// Algorand mainnet CAIP-2 id and mainnet USDC ASA (fallbacks if the package doesn't export them)
const NETWORK = avm.ALGORAND_MAINNET_CAIP2 || 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=';
const USDC = avm.USDC_MAINNET_ASA_ID || 31566704;

if (!WALLET) {
  console.error('WALLET_ADDRESS is not set — refusing to start');
  process.exit(1);
}

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ── x402 resource server (verify + settle via GoPlausible) ───────────────────
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR });
const x402Server = new x402ResourceServer(facilitatorClient);
x402Server.register(NETWORK, new ExactAvmScheme());

let discovery;
try {
  if (ext.bazaarResourceServerExtension) {
    x402Server.registerExtension(ext.bazaarResourceServerExtension);
  }
  if (ext.declareDiscoveryExtension) {
    discovery = ext.declareDiscoveryExtension({
      output: {
        example: {
          company_number: '00445790',
          company_name: 'TESCO PLC',
          risk_score: 0,
          risk_level: 'low',
          flags: [{ type: 'ok', icon: '✓', text: 'Accounts filing up to date' }],
          recommendation: 'Proceed with standard commercial terms.',
        },
      },
    });
  }
} catch (e) {
  console.log('Bazaar discovery extension not enabled:', e.message);
}

app.use(
  paymentMiddleware(
    {
      'GET /company/*': {
        accepts: [
          {
            scheme: 'exact',
            price: '$0.50',
            network: NETWORK,
            payTo: WALLET,
            extra: { asset: USDC, tag: 'x402-global-challenge' },
          },
        ],
        description:
          'UK company risk profile: risk score 0-100, flags, ownership summary and recommendation from Companies House data.',
        mimeType: 'application/json',
        ...(discovery ? { extensions: discovery } : {}),
      },
    },
    x402Server,
  ),
);

// ── Paid endpoint (only reached after payment is verified) ───────────────────
app.get('/company/:number', async (req, res) => {
  const { number } = req.params;
  if (!/^[A-Z0-9]{6,8}$/i.test(number)) {
    return res.status(400).json({ error: 'Invalid company number e.g. 00445790' });
  }
  try {
    const raw = await fetchCompanyProfile(number.toUpperCase());
    raw._number = number.toUpperCase();
    const profile = await scoreRisk(raw);
    res.json(profile);
  } catch (err) {
    console.error(`Error processing ${number}:`, err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Free endpoints ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CompanyLens',
    version: '1.2.0',
    network: NETWORK,
    price: '0.50 USDC per lookup',
    wallet: `${WALLET.slice(0, 8)}...`,
    facilitator: FACILITATOR,
  });
});

app.get('/.well-known/x402.json', (req, res) => {
  res.json({
    name: 'CompanyLens',
    description: 'UK company risk intelligence — risk score, flags, ownership and recommendation per query.',
    endpoints: [{ path: '/company/{number}', method: 'GET', price: '0.50 USDC', network: NETWORK }],
    tag: 'x402-global-challenge',
  });
});

app.get('/llms.txt', (req, res) => {
  res.type('text/plain').send(`# CompanyLens
> UK company risk intelligence API

Payment: 0.50 USDC per request via x402 on Algorand mainnet. No API keys required.

## Endpoint
GET /company/{number}
Returns: risk_score (0-100), risk_level, flags, ownership, recommendation
`);
});

app.get('/', (req, res) => {
  try {
    res.type('html').send(readFileSync(join(__dirname, '../public/index.html'), 'utf8'));
  } catch {
    res.json({ service: 'CompanyLens', health: '/health', endpoint: '/company/:number' });
  }
});

app.listen(PORT, () => {
  console.log(`CompanyLens running on port ${PORT}`);
  console.log(`Network: ${NETWORK}`);
  console.log(`Wallet:  ${WALLET.slice(0, 8)}...`);
  console.log(`Facilitator: ${FACILITATOR}`);
});
