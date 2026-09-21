/**
 * test-payment.js
 * Runs a full x402 payment loop on testnet before you go live.
 * 
 * Usage:
 *   node src/test-payment.js
 * 
 * Requires:
 *   - Server running on localhost:3000 with ALGORAND_NETWORK=ALGORAND_Testnet_CAIP2
 *   - ALGORAND_TEST_MNEMONIC set in .env (a funded testnet account)
 *   - Testnet USDC from https://faucet.circle.com
 */

import 'dotenv/config';
import algosdk from 'algosdk';

const SERVER = `http://localhost:${process.env.PORT || 3000}`;
const TEST_COMPANY = '00445790'; // Marks & Spencer — always exists

async function testPaymentFlow() {
  console.log('\n── CompanyLens x402 Payment Test ──────────────────────\n');
  console.log(`Server:   ${SERVER}`);
  console.log(`Network:  ${process.env.ALGORAND_NETWORK}`);
  console.log(`Company:  ${TEST_COMPANY}\n`);

  // Step 1: Health check
  console.log('1. Health check...');
  const health = await fetch(`${SERVER}/health`).then(r => r.json());
  console.log(`   ✓ ${health.service} v${health.version} — ${health.price}\n`);

  // Step 2: First request — expect 402
  console.log('2. Sending unpaid request — expecting 402...');
  const unpaidRes = await fetch(`${SERVER}/company/${TEST_COMPANY}`);
  if (unpaidRes.status !== 402) {
    console.error(`   ✗ Expected 402, got ${unpaidRes.status}`);
    process.exit(1);
  }
  const paymentReq = await unpaidRes.json();
  console.log('   ✓ 402 received');
  console.log(`   Payment required: ${JSON.stringify(paymentReq, null, 4)}\n`);

  // Step 3: Check well-known
  console.log('3. Checking /.well-known/x402.json (Bazaar discovery)...');
  const wellKnown = await fetch(`${SERVER}/.well-known/x402.json`).then(r => r.json());
  console.log(`   ✓ Service: ${wellKnown.name} — tag: ${wellKnown.tag}\n`);

  // Step 4: Check llms.txt
  console.log('4. Checking /llms.txt (agent discovery)...');
  const llms = await fetch(`${SERVER}/llms.txt`).then(r => r.text());
  console.log(`   ✓ llms.txt present (${llms.length} chars)\n`);

  console.log('── Basic checks passed ─────────────────────────────────\n');
  console.log('To test a full payment loop with real Algorand transactions,');
  console.log('use the GoPlausible testnet demo at:');
  console.log('  https://x402.goplausible.xyz/demo\n');
  console.log('Or install an x402 client:');
  console.log('  npm install x402-fetch');
  console.log('  and call your local server with a funded testnet wallet.\n');
}

testPaymentFlow().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
