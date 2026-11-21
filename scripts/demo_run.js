// AgentDealCourt demo runner — GenLayer Studio Next (chain 61997).
//
// Deploys the court and runs the full demo dispute between two wallets:
//   buyer  = keystore eoa-testnet-1
//   seller = keystore eoa-testnet-2
// Keystores live in ~/.wallet-keystore/<name>.keystore (JSON with privateKey),
// the same pattern as the portal wizard tooling. Uses genlayer-js 2.0.0-rc.3.
//
// Usage (from ~/workspace/genlayer/next so genlayer-js resolves, or npm i here):
//   node scripts/demo_run.js deploy
//   node scripts/demo_run.js run <contractAddress>
//
// Env overrides:
//   EVIDENCE_URL  public URL of evidence/delivery.json in the published repo
//                 (default: the gedekalas/agent-deal-court raw GitHub URL —
//                 update it if the repo is published under another name).

const fs = require('fs');
const path = require('path');
const { createAccount, createClient, chains } = require('genlayer-js');

const CONTRACT_FILE = path.join(__dirname, '..', 'contracts', 'agent_deal_court.py');
const EVIDENCE_URL =
  process.env.EVIDENCE_URL ||
  'https://raw.githubusercontent.com/gedekalas/agent-deal-court/main/evidence/delivery.json';

const AGREEMENT =
  "Seller provides a BTC/ETH price feed as JSON with status 'ok' and numeric " +
  'btc_usd / eth_usd prices. Buyer pays 50 USDC via x402 on delivery. ' +
  'Both parties choose the AgentDealCourt (Internet Court on GenLayer) as judge.';
const BUYER_CLAIM =
  'I paid 50 USDC via x402 and the feed returned an error (feed_offline, data null). ' +
  'I received no prices at all. Full refund.';
const SELLER_CLAIM =
  'The endpoint was delivered as agreed; the error came from the buyer-side network. ' +
  'The payment should be released to me.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadAccount(name) {
  const ks = JSON.parse(
    fs.readFileSync(path.join(process.env.HOME, '.wallet-keystore', name + '.keystore'), 'utf8')
  );
  const pk = ks.privateKey.startsWith('0x') ? ks.privateKey : '0x' + ks.privateKey;
  return createAccount(pk);
}

async function ensureFunds(client, address) {
  const bal = await client.getBalance({ address });
  console.log('balance', address, bal.toString());
  if (bal < 2n * 10n ** 18n) {
    const tx = await client.request({ method: 'sim_fundAccount', params: [address, 10 * 1e18] });
    console.log('sim_fundAccount tx:', tx);
    await sleep(4000);
  }
}

async function write(client, address, functionName, args) {
  let fees;
  try {
    const est = await client.estimateTransactionFeesForWrite({ address, functionName, args });
    fees = { distribution: est.distribution, feeValue: est.feeValue };
  } catch (e) {
    console.log('fee estimate skipped:', e.message.slice(0, 80));
  }
  const hash = await client.writeContract({ address, functionName, args, value: 0n, ...(fees ? { fees } : {}) });
  console.log(functionName, 'tx:', hash);
  return hash;
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  const buyer = loadAccount('eoa-testnet-1');
  const seller = loadAccount('eoa-testnet-2');
  const buyerClient = createClient({ chain: chains.studioDevnet, account: buyer });
  const sellerClient = createClient({ chain: chains.studioDevnet, account: seller });
  console.log('buyer :', buyer.address);
  console.log('seller:', seller.address);
  await ensureFunds(buyerClient, buyer.address);
  await ensureFunds(sellerClient, seller.address);

  if (cmd === 'deploy') {
    const code = fs.readFileSync(CONTRACT_FILE, 'utf8');
    const hash = await buyerClient.deployContract({ code, args: [] });
    console.log('deploy tx:', hash);
    const receipt = await buyerClient.waitForTransactionReceipt({
      hash,
      waitUntil: 'finalized',
      fullTransaction: true,
    });
    console.log('receipt:', JSON.stringify(receipt, null, 1).slice(0, 2000));
    const addr =
      receipt.contract_address || receipt.contractAddress ||
      (receipt.data && (receipt.data.contract_address || receipt.data.contractAddress));
    console.log('CONTRACT ADDRESS:', addr || '(find contract_address in the receipt above)');
    return;
  }

  if (cmd === 'run') {
    const court = arg;
    if (!court) throw new Error('usage: node scripts/demo_run.js run <contractAddress>');
    await write(buyerClient, court, 'open_case', [seller.address, AGREEMENT, EVIDENCE_URL, '50 USDC (x402)']);
    const count = await buyerClient.readContract({ address: court, functionName: 'get_case_count', args: [] });
    const caseId = String(count);
    console.log('case id:', caseId);
    await write(buyerClient, court, 'submit_claim', [caseId, BUYER_CLAIM]);
    await write(sellerClient, court, 'submit_claim', [caseId, SELLER_CLAIM]);
    let c = await buyerClient.readContract({ address: court, functionName: 'get_case', args: [caseId] });
    console.log('case before ruling:', JSON.stringify(c).slice(0, 400));
    await write(buyerClient, court, 'rule', [caseId]);
    for (let i = 0; i < 40; i++) {
      await sleep(15000);
      try {
        c = await buyerClient.readContract({ address: court, functionName: 'get_case', args: [caseId] });
        if (c && c.status === 'ruled') {
          console.log('VERDICT:', JSON.stringify(c.verdict, null, 1));
          return;
        }
        if (i % 4 === 0) console.log('poll', i, 'status:', c && c.status);
      } catch (e) {
        if (i % 4 === 0) console.log('poll', i, e.message.slice(0, 100));
      }
    }
    console.log('TIMEOUT waiting for verdict — check the explorer and re-read get_case.');
    return;
  }

  console.log('usage: node scripts/demo_run.js deploy | run <contractAddress>');
})().catch((e) => {
  console.error('FATAL:', e.message.slice(0, 400));
  process.exit(1);
});
