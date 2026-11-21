# AgentDealCourt — Internet Court on GenLayer, with x402

**An Internet Court adjudication contract for agent-to-agent commerce, built on GenLayer, demonstrated on an x402 payment dispute.**

Two AI agents make a deal and agree up front who judges it if something goes
wrong. That is the [Internet Court](https://github.com/internet-court/internet-court-skill)
pattern: payments let agents transact, **adjudication makes them accountable**.
`AgentDealCourt` is that judge — a GenLayer Intelligent Contract that takes a
case, hears both sides, fetches the delivery evidence from the web itself, and
rules under GenLayer's equivalence principle.

> Demo dispute: a buyer agent paid **50 USDC via x402** for a BTC/ETH price
> feed. The feed returned `{"status": "error", "data": null}`. The seller says
> "delivered". The buyer says "broken". The court fetches the feed, reads it,
> and rules — on-chain, in one transaction.

## Why this is an Internet Court integration

Internet Court's stack has six layers; layer 6 — **verification & disputes** —
is the one the consortium exists to add, and GenLayer is its judgment layer
(see `integrations/genlayer-intelligent-contracts/` in the Internet Court
skill repo). This project implements that layer as a working contract:

| Internet Court concept | In this repo |
| --- | --- |
| Deal with a pre-agreed judge | `open_case()` records the agreement text and names this contract as judge |
| Evidence schema | Parties + a public `evidence_url` (the delivery itself); claims as structured case fields |
| Adjudication | `rule()` — the contract fetches the evidence (`gl.nondet.web`) and judges it (`gl.nondet.exec_prompt`) |
| Equivalence principle | Validators independently re-fetch and re-judge; consensus is required on the operative outcome (`winner`, `seller_share_bps`), never on the reasoning wording |
| Decision output | A settlement instruction: `{winner, seller_share_bps, buyer_share_bps, pay_to, reasoning}` stored on-chain |
| Effect path | The deal's payment holder (x402 facilitator / escrow) executes the settlement instruction — the separation the Internet Court GenLayer connector specifies: *GenLayer judges, a controller consumes the decision* |

Partner protocols in the demo: **x402** (the payment rail the deal ran on) —
with the same contract usable as the arbitrator for Alkahest-style escrows or
as the decision source for an ERC-7710 revocation controller.

## Contract API — `contracts/agent_deal_court.py`

| Method | Type | Description |
| --- | --- | --- |
| `open_case(seller, agreement, evidence_url, amount)` | write | Caller is the buyer. Creates case `1, 2, 3, …` with the deal terms and the evidence URL. |
| `submit_claim(case_id, claim)` | write | Buyer or seller files their side of the story. Case becomes `claimed` once both are in. |
| `rule(case_id)` | write | Court session: fetch evidence → judge → consensus → verdict + settlement instruction stored. |
| `get_case(case_id)` | view | Full case file, including the verdict once ruled. |
| `get_verdict(case_id)` | view | Just the verdict / settlement instruction. |
| `get_case_count()` | view | Number of cases opened. |

Safety properties:

- **Prompt-injection hardened** — agreement, claims and web evidence are
  wrapped as untrusted data; the judge prompt forbids treating them as
  instructions.
- **Deterministic operative outcome** — winner/share are normalized
  (a full win always means a full share) so validator consensus turns on the
  decision, not on phrasing.
- **A malformed LLM response can never brick the court** — it degrades to a
  neutral split verdict instead of an error.

## Quick start

Requirements (same as the GenLayer project boilerplate): Python ≥ 3.12,
GenLayer CLI (`npm install -g genlayer`), `genlayer-js` 2.0.0-rc.3 for the
demo script.

```bash
# 1. Lint the contract
genvm-lint check contracts/agent_deal_court.py

# 2. Direct-mode tests (in-memory, web/LLM mocked — no Studio needed)
pip install -r requirements.txt   # if present in your boilerplate setup
pytest tests/direct/ -v

# 3. Deploy to GenLayer Studio Next (chain 61997) and run the demo dispute
#    Uses keystore wallets ~/.wallet-keystore/eoa-testnet-1.keystore (buyer)
#    and eoa-testnet-2.keystore (seller); test GEN via sim_fundAccount.
node scripts/demo_run.js deploy
node scripts/demo_run.js run <contractAddress>
```

The demo script opens the case as the buyer, files both claims from the two
wallets, calls `rule()`, and polls `get_case()` until the verdict is final.
The evidence it judges is this repo's own
[`evidence/delivery.json`](evidence/delivery.json) — set `EVIDENCE_URL` if the
repo is published under a different owner/name.

## The demo scenario, step by step

1. **The deal** — buyer and seller agree: *"Seller provides a BTC/ETH price
   feed as JSON with status 'ok' and numeric prices. Buyer pays 50 USDC via
   x402 on delivery. Both parties choose the AgentDealCourt as judge."*
2. **The delivery** — the seller's endpoint returns
   `{"status": "error", "error": "feed_offline", "data": null}`
   (see `evidence/delivery.json`).
3. **The dispute** — buyer: *"I paid and received no data. Full refund."*
   Seller: *"Delivered as agreed; the outage was on the buyer's network."*
4. **The ruling** — validators fetch the delivery, compare it with the
   agreement, and rule: **buyer wins, full refund** (`pay_to: "buyer"`,
   `seller_share_bps: 0`), with the reasoning stored on-chain.
5. **Settlement** — the x402 facilitator / escrow holding the 50 USDC reads
   `get_verdict()` and pays out per the instruction.

## Roadmap

- ERC-7710 effect path: a revocation/settlement controller on Base Sepolia
  consuming verdicts via the Internet Court `genlayer-erc7710-connector`.
- Alkahest escrow adapter so the court's `pay_to` executes against a real
  escrow instead of an off-chain facilitator.
- Appeals: a ruled case can be re-opened as a new case referencing the prior
  verdict (larger validator set on appeal), mirroring Internet Court's
  escalation path.

## License

MIT — see [LICENSE](LICENSE).
