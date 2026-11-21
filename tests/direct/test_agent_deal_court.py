"""Direct-mode tests for AgentDealCourt — web + LLM mocked, no Studio needed.

Run: pytest tests/direct/ -v
"""

import json

from tests.direct.conftest import to_hex

EVIDENCE_URL = "https://feeds.example.test/delivery.json"
AGREEMENT = (
    "Seller provides a BTC/ETH price feed as JSON with status 'ok' and "
    "numeric btc_usd / eth_usd prices. Buyer pays 50 USDC via x402 on delivery."
)
DELIVERY_BODY = '{"status": "error", "error": "feed_offline", "data": null}'


def _setup_court_mocks(vm):
    """The delivered feed is an error page; the judge rules for the buyer."""
    vm.mock_web(
        r".*feeds\.example\.test.*",
        {"status": 200, "body": DELIVERY_BODY},
    )
    vm.mock_llm(
        r".*Internet Court.*",
        json.dumps(
            {
                "winner": "buyer",
                "seller_share_bps": 0,
                "reasoning": "The evidence shows an error response instead of "
                "the promised price feed, so the buyer is refunded in full.",
            }
        ),
    )


def _open_case_with_claims(contract, direct_vm, alice, bob):
    direct_vm.sender = alice
    contract.open_case(to_hex(bob), AGREEMENT, EVIDENCE_URL, "50 USDC (x402)")
    contract.submit_claim(
        "1", "I paid via x402 and the feed returned an error. No data at all."
    )
    direct_vm.sender = bob
    contract.submit_claim(
        "1", "The feed was delivered; the outage was on the buyer's network."
    )
    direct_vm.sender = alice


def test_full_case_buyer_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_deal_court.py")
    _open_case_with_claims(contract, direct_vm, direct_alice, direct_bob)

    case = contract.get_case("1")
    assert case["status"] == "claimed"
    assert case["buyer"] == to_hex(direct_alice)
    assert case["seller"] == to_hex(direct_bob)

    _setup_court_mocks(direct_vm)
    contract.rule("1")

    case = contract.get_case("1")
    assert case["status"] == "ruled"
    verdict = case["verdict"]
    assert verdict["winner"] == "buyer"
    assert verdict["seller_share_bps"] == 0
    assert verdict["buyer_share_bps"] == 10000
    assert verdict["pay_to"] == "buyer"
    assert contract.get_verdict("1")["winner"] == "buyer"
    assert contract.get_case_count() == 1


def test_rule_requires_both_claims(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_deal_court.py")
    direct_vm.sender = direct_alice
    contract.open_case(to_hex(direct_bob), AGREEMENT, EVIDENCE_URL, "50 USDC (x402)")

    with direct_vm.expect_revert("both claims required"):
        contract.rule("1")


def test_single_claim_keeps_case_open(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_deal_court.py")
    direct_vm.sender = direct_alice
    contract.open_case(to_hex(direct_bob), AGREEMENT, EVIDENCE_URL, "50 USDC (x402)")

    contract.submit_claim("1", "buyer claim")
    case = contract.get_case("1")
    assert case["buyer_claim"] == "buyer claim"
    assert case["seller_claim"] == ""
    assert case["status"] == "open"


def test_double_rule_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_deal_court.py")
    _open_case_with_claims(contract, direct_vm, direct_alice, direct_bob)
    _setup_court_mocks(direct_vm)
    contract.rule("1")

    with direct_vm.expect_revert("case already ruled"):
        contract.rule("1")
