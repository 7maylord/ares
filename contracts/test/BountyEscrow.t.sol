// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {BountyPool} from "../src/BountyPool.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";
import {ReputationLedger} from "../src/ReputationLedger.sol";

/// @title BountyEscrowTest
/// @notice Tests the full verification flow: submit → verify/reject → payout/reputation update.
contract BountyEscrowTest is Test {
    BountyPool public pool;
    BountyEscrow public escrow;
    ReputationLedger public ledger;

    address admin = makeAddr("admin");
    address verifier = makeAddr("verifier");
    address protocolOwner = makeAddr("protocolOwner");
    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");
    address vulnContract = makeAddr("vulnContract");

    uint256 constant REWARD = 1 ether;
    uint256 constant FUND = 5 ether;
    uint256 constant DEADLINE = 1 days;

    function setUp() public {
        vm.startPrank(admin);

        ledger = new ReputationLedger(admin);
        pool = new BountyPool(admin, address(ledger));
        escrow = new BountyEscrow(admin, address(pool));

        pool.setEscrow(address(escrow));
        ledger.grantRole(ledger.JUDGE_ROLE(), address(pool));
        escrow.grantRole(escrow.VERIFIER_ROLE(), verifier);

        ledger.registerAgent(agent1);
        ledger.registerAgent(agent2);

        vm.stopPrank();

        vm.deal(protocolOwner, 100 ether);
        vm.deal(agent1, 1 ether);
        vm.deal(agent2, 1 ether);
    }

    // ─────────── Helpers ───────────

    function _createBountyAndSubmit(address agent) internal returns (uint256 bountyId, uint256 findingId) {
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        bountyId = pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        vm.prank(agent);
        findingId = pool.submitFinding(
            bountyId,
            hex"deadbeef",
            "Reentrancy in withdraw()",
            BountyPool.Severity.High
        );
    }

    // ══════════════════════════════════════════════
    //  VERIFICATION (HAPPY PATH)
    // ══════════════════════════════════════════════

    function test_VerifyFinding_PaysAgent() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        uint256 agentBalanceBefore = agent1.balance;

        vm.prank(verifier);
        escrow.verify(findingId);

        // Agent received reward
        assertEq(agent1.balance, agentBalanceBefore + REWARD);

        // Finding marked as verified
        BountyPool.Finding memory f = pool.getFinding(findingId);
        assertEq(uint256(f.status), uint256(BountyPool.FindingStatus.Verified));
    }

    function test_VerifyFinding_UpdatesReputation() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        uint256 repBefore = ledger.reputationScore(agent1);

        vm.prank(verifier);
        escrow.verify(findingId);

        assertGt(ledger.reputationScore(agent1), repBefore);
        assertEq(ledger.successfulSubmissions(agent1), 1);
    }

    function test_VerifyFinding_DeductsFundsFromBounty() public {
        (uint256 bountyId, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(verifier);
        escrow.verify(findingId);

        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertEq(b.totalFunds, FUND - REWARD);
    }

    function test_VerifyFinding_DeactivatesBounty_WhenFundsExhausted() public {
        // Create bounty with exactly 1 reward worth of funds
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: REWARD}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        vm.prank(agent1);
        uint256 findingId = pool.submitFinding(bountyId, hex"aa", "vuln", BountyPool.Severity.High);

        vm.prank(verifier);
        escrow.verify(findingId);

        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertFalse(b.active);
    }

    function test_VerifyFinding_EmitsEvents() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(verifier);
        vm.expectEmit(true, false, false, true);
        emit BountyEscrow.VerificationPassed(findingId);
        escrow.verify(findingId);
    }

    // ══════════════════════════════════════════════
    //  REJECTION
    // ══════════════════════════════════════════════

    function test_RejectFinding() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(verifier);
        escrow.reject(findingId);

        BountyPool.Finding memory f = pool.getFinding(findingId);
        assertEq(uint256(f.status), uint256(BountyPool.FindingStatus.Rejected));
    }

    function test_RejectFinding_DecrementsReputation() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        uint256 repBefore = ledger.reputationScore(agent1);

        vm.prank(verifier);
        escrow.reject(findingId);

        assertLt(ledger.reputationScore(agent1), repBefore);
        assertEq(ledger.failedSubmissions(agent1), 1);
    }

    function test_RejectFinding_DoesNotPayAgent() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        uint256 agentBalanceBefore = agent1.balance;

        vm.prank(verifier);
        escrow.reject(findingId);

        assertEq(agent1.balance, agentBalanceBefore);
    }

    function test_RejectFinding_DoesNotDeductFunds() public {
        (uint256 bountyId, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(verifier);
        escrow.reject(findingId);

        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertEq(b.totalFunds, FUND);
    }

    // ══════════════════════════════════════════════
    //  ERROR CASES
    // ══════════════════════════════════════════════

    function test_RevertWhen_VerifyingTwice() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(verifier);
        escrow.verify(findingId);

        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyProcessed.selector, findingId));
        escrow.verify(findingId);
    }

    function test_RevertWhen_RejectingTwice() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(verifier);
        escrow.reject(findingId);

        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyProcessed.selector, findingId));
        escrow.reject(findingId);
    }

    function test_RevertWhen_VerifyAfterReject() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(verifier);
        escrow.reject(findingId);

        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyProcessed.selector, findingId));
        escrow.verify(findingId);
    }

    function test_RevertWhen_NonVerifierVerifies() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(agent1);
        vm.expectRevert();
        escrow.verify(findingId);
    }

    function test_RevertWhen_NonVerifierRejects() public {
        (, uint256 findingId) = _createBountyAndSubmit(agent1);

        vm.prank(agent1);
        vm.expectRevert();
        escrow.reject(findingId);
    }

    // ══════════════════════════════════════════════
    //  FULL END-TO-END FLOW
    // ══════════════════════════════════════════════

    function test_E2E_MultipleSubmissions_MixedVerdict() public {
        // Create a bounty
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        // Agent1 submits a valid finding
        vm.prank(agent1);
        uint256 f1 = pool.submitFinding(bountyId, hex"aa", "Reentrancy", BountyPool.Severity.High);

        // Agent2 submits a false positive
        vm.prank(agent2);
        uint256 f2 = pool.submitFinding(bountyId, hex"bb", "Not a real bug", BountyPool.Severity.Medium);

        uint256 agent1BalBefore = agent1.balance;
        uint256 agent2BalBefore = agent2.balance;

        // Verify agent1's finding
        vm.prank(verifier);
        escrow.verify(f1);

        // Reject agent2's finding
        vm.prank(verifier);
        escrow.reject(f2);

        // Agent1 got paid, agent2 did not
        assertEq(agent1.balance, agent1BalBefore + REWARD);
        assertEq(agent2.balance, agent2BalBefore);

        // Agent1 rep up, agent2 rep down
        assertEq(ledger.reputationScore(agent1), 550); // 500 + 50
        assertEq(ledger.reputationScore(agent2), 400); // 500 - 100

        // Bounty still active with remaining funds
        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertTrue(b.active);
        assertEq(b.totalFunds, FUND - REWARD);
    }

    function test_E2E_BountyExhausted_AfterMultiplePayouts() public {
        // Create a bounty with exactly 2 rewards
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: 2 * REWARD}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        // Agent1 submits and gets verified
        vm.prank(agent1);
        uint256 f1 = pool.submitFinding(bountyId, hex"aa", "Bug1", BountyPool.Severity.High);

        vm.prank(verifier);
        escrow.verify(f1);

        // Bounty still active (1 reward left)
        assertTrue(pool.getBounty(bountyId).active);

        // Agent2 submits and gets verified
        vm.prank(agent2);
        uint256 f2 = pool.submitFinding(bountyId, hex"bb", "Bug2", BountyPool.Severity.High);

        vm.prank(verifier);
        escrow.verify(f2);

        // Bounty now exhausted and deactivated
        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertFalse(b.active);
        assertEq(b.totalFunds, 0);
    }
}
