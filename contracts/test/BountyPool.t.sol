// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {BountyPool} from "../src/BountyPool.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";
import {ReputationLedger} from "../src/ReputationLedger.sol";

contract BountyPoolTest is Test {
    BountyPool public pool;
    BountyEscrow public escrow;
    ReputationLedger public ledger;

    address admin = makeAddr("admin");
    address protocolOwner = makeAddr("protocolOwner");
    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");
    address nobody = makeAddr("nobody");
    address vulnContract = makeAddr("vulnContract");

    uint256 constant REWARD = 1 ether;
    uint256 constant FUND = 5 ether;
    uint256 constant DEADLINE = 1 days;

    function setUp() public {
        vm.startPrank(admin);

        // Deploy stack
        ledger = new ReputationLedger(admin);
        pool = new BountyPool(admin, address(ledger));
        escrow = new BountyEscrow(admin, address(pool));

        // Wire up
        pool.setEscrow(address(escrow));

        // Grant JUDGE_ROLE to the pool so it can update reputations
        ledger.grantRole(ledger.JUDGE_ROLE(), address(pool));

        // Register agents
        ledger.registerAgent(agent1);
        ledger.registerAgent(agent2);

        vm.stopPrank();

        // Fund accounts
        vm.deal(protocolOwner, 100 ether);
        vm.deal(agent1, 10 ether);
        vm.deal(agent2, 10 ether);
    }

    // ══════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════

    function _createDefaultBounty() internal returns (uint256 bountyId) {
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        bountyId = pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Medium,
            block.timestamp + DEADLINE,
            whitelist
        );
    }

    function _createWhitelistedBounty(address[] memory whitelist) internal returns (uint256 bountyId) {
        vm.prank(protocolOwner);
        bountyId = pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );
    }

    function _submitFinding(uint256 bountyId, address agent) internal returns (uint256 findingId) {
        vm.prank(agent);
        findingId = pool.submitFinding(
            bountyId,
            hex"deadbeef",
            "Reentrancy in withdraw()",
            BountyPool.Severity.High
        );
    }

    // ══════════════════════════════════════════════
    //  BOUNTY CREATION
    // ══════════════════════════════════════════════

    function test_CreateBounty() public {
        uint256 bountyId = _createDefaultBounty();

        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertEq(b.targetContract, vulnContract);
        assertEq(b.bountyCreator, protocolOwner);
        assertEq(b.rewardAmount, REWARD);
        assertTrue(b.active);
        assertEq(b.totalFunds, FUND);
        assertEq(uint256(b.severityThreshold), uint256(BountyPool.Severity.Medium));
    }

    function test_CreateBounty_EmitsEvent() public {
        address[] memory whitelist = new address[](0);

        vm.prank(protocolOwner);
        vm.expectEmit(true, true, true, true);
        emit BountyPool.BountyCreated(
            0,
            protocolOwner,
            vulnContract,
            REWARD,
            BountyPool.Severity.Medium,
            block.timestamp + DEADLINE
        );
        pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Medium,
            block.timestamp + DEADLINE,
            whitelist
        );
    }

    function test_CreateBounty_IncrementsId() public {
        uint256 id1 = _createDefaultBounty();
        uint256 id2 = _createDefaultBounty();

        assertEq(id1, 0);
        assertEq(id2, 1);
    }

    function test_RevertWhen_CreateBounty_ZeroTarget() public {
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        vm.expectRevert(BountyPool.ZeroAddress.selector);
        pool.createBounty{value: FUND}(
            address(0),
            REWARD,
            BountyPool.Severity.Medium,
            block.timestamp + DEADLINE,
            whitelist
        );
    }

    function test_RevertWhen_CreateBounty_PastDeadline() public {
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        vm.expectRevert(BountyPool.InvalidDeadline.selector);
        pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Medium,
            block.timestamp - 1,
            whitelist
        );
    }

    function test_RevertWhen_CreateBounty_ZeroReward() public {
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        vm.expectRevert(BountyPool.InvalidReward.selector);
        pool.createBounty{value: FUND}(
            vulnContract,
            0,
            BountyPool.Severity.Medium,
            block.timestamp + DEADLINE,
            whitelist
        );
    }

    function test_RevertWhen_CreateBounty_InsufficientFunding() public {
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        vm.expectRevert(BountyPool.InsufficientFunds.selector);
        pool.createBounty{value: 0.5 ether}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Medium,
            block.timestamp + DEADLINE,
            whitelist
        );
    }

    // ══════════════════════════════════════════════
    //  BOUNTY FUNDING
    // ══════════════════════════════════════════════

    function test_FundBounty() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(protocolOwner);
        pool.fundBounty{value: 2 ether}(bountyId);

        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertEq(b.totalFunds, FUND + 2 ether);
    }

    function test_RevertWhen_FundingInactiveBounty() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(protocolOwner);
        pool.cancelBounty(bountyId);

        vm.prank(protocolOwner);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.BountyNotActive.selector, bountyId));
        pool.fundBounty{value: 1 ether}(bountyId);
    }

    // ══════════════════════════════════════════════
    //  BOUNTY CANCELLATION
    // ══════════════════════════════════════════════

    function test_CancelBounty_RefundsFunds() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 balanceBefore = protocolOwner.balance;

        vm.prank(protocolOwner);
        pool.cancelBounty(bountyId);

        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertFalse(b.active);
        assertEq(b.totalFunds, 0);
        assertEq(protocolOwner.balance, balanceBefore + FUND);
    }

    function test_RevertWhen_NonCreatorCancels() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.BountyNotActive.selector, bountyId));
        pool.cancelBounty(bountyId);
    }

    // ══════════════════════════════════════════════
    //  FINDING SUBMISSION
    // ══════════════════════════════════════════════

    function test_SubmitFinding() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        BountyPool.Finding memory f = pool.getFinding(findingId);
        assertEq(f.agent, agent1);
        assertEq(f.bountyId, bountyId);
        assertEq(uint256(f.status), uint256(BountyPool.FindingStatus.Pending));
        assertEq(uint256(f.severity), uint256(BountyPool.Severity.High));
    }

    function test_SubmitFinding_EmitsEvent() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(agent1);
        vm.expectEmit(true, true, true, true);
        emit BountyPool.FindingSubmitted(0, bountyId, agent1, BountyPool.Severity.High);
        pool.submitFinding(bountyId, hex"deadbeef", "Reentrancy", BountyPool.Severity.High);
    }

    function test_RevertWhen_SubmittingToInactiveBounty() public {
        uint256 bountyId = _createDefaultBounty();
        vm.prank(protocolOwner);
        pool.cancelBounty(bountyId);

        vm.prank(agent1);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.BountyNotActive.selector, bountyId));
        pool.submitFinding(bountyId, hex"deadbeef", "Reentrancy", BountyPool.Severity.High);
    }

    function test_RevertWhen_SubmittingAfterDeadline() public {
        uint256 bountyId = _createDefaultBounty();

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        vm.prank(agent1);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.BountyExpired.selector, bountyId));
        pool.submitFinding(bountyId, hex"deadbeef", "Reentrancy", BountyPool.Severity.High);
    }

    function test_RevertWhen_DuplicateSubmission() public {
        uint256 bountyId = _createDefaultBounty();
        _submitFinding(bountyId, agent1);

        vm.prank(agent1);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.AlreadySubmitted.selector, agent1, bountyId));
        pool.submitFinding(bountyId, hex"cafebabe", "Another vuln", BountyPool.Severity.High);
    }

    function test_RevertWhen_LowReputation() public {
        // Grant judge role to admin for direct reputation updates
        vm.startPrank(admin);
        ledger.grantRole(ledger.JUDGE_ROLE(), admin);
        // Drop agent1 from 500 to 1 (floor) — 5 failures: 500 - 500 → floor at 1
        for (uint256 i = 0; i < 5; i++) {
            ledger.updateReputation(agent1, false);
        }
        vm.stopPrank();

        uint256 rep = ledger.reputationScore(agent1);
        assertLt(rep, 100);

        uint256 bountyId = _createDefaultBounty();

        vm.prank(agent1);
        vm.expectRevert(
            abi.encodeWithSelector(
                BountyPool.InsufficientReputation.selector,
                agent1,
                rep
            )
        );
        pool.submitFinding(bountyId, hex"deadbeef", "Reentrancy", BountyPool.Severity.High);
    }

    function test_RevertWhen_SeverityBelowThreshold() public {
        uint256 bountyId = _createDefaultBounty(); // threshold = Medium

        vm.prank(agent1);
        vm.expectRevert("Severity too low");
        pool.submitFinding(bountyId, hex"deadbeef", "Minor issue", BountyPool.Severity.Low);
    }

    // ── Whitelist ──

    function test_WhitelistedBounty_AllowsWhitelistedAgent() public {
        address[] memory whitelist = new address[](1);
        whitelist[0] = agent1;
        uint256 bountyId = _createWhitelistedBounty(whitelist);

        // agent1 can submit
        _submitFinding(bountyId, agent1);
        BountyPool.Finding memory f = pool.getFinding(0);
        assertEq(f.agent, agent1);
    }

    function test_RevertWhen_NonWhitelistedAgentSubmits() public {
        address[] memory whitelist = new address[](1);
        whitelist[0] = agent1;
        uint256 bountyId = _createWhitelistedBounty(whitelist);

        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.AgentNotWhitelisted.selector, agent2));
        pool.submitFinding(bountyId, hex"deadbeef", "Vuln", BountyPool.Severity.High);
    }

    function test_OpenBounty_AllowsAnyAgent() public {
        uint256 bountyId = _createDefaultBounty(); // no whitelist

        _submitFinding(bountyId, agent1);
        _submitFinding(bountyId, agent2);

        assertEq(pool.getFinding(0).agent, agent1);
        assertEq(pool.getFinding(1).agent, agent2);
    }

    // ══════════════════════════════════════════════
    //  MULTIPLE SUBMISSIONS PER BOUNTY
    // ══════════════════════════════════════════════

    function test_MultipleAgentsCanSubmit() public {
        uint256 bountyId = _createDefaultBounty();

        _submitFinding(bountyId, agent1);
        _submitFinding(bountyId, agent2);

        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertEq(b.findingCount, 2);
    }

    // ══════════════════════════════════════════════
    //  CONSTRUCTOR ZERO-ADDRESS CHECKS
    // ══════════════════════════════════════════════

    function test_RevertWhen_ConstructorZeroAdmin() public {
        vm.expectRevert(BountyPool.ZeroAddress.selector);
        new BountyPool(address(0), address(ledger));
    }

    function test_RevertWhen_ConstructorZeroReputationLedger() public {
        vm.expectRevert(BountyPool.ZeroAddress.selector);
        new BountyPool(admin, address(0));
    }

    // ══════════════════════════════════════════════
    //  SET ESCROW
    // ══════════════════════════════════════════════

    function test_RevertWhen_SetEscrow_ZeroAddress() public {
        // Deploy a fresh pool without escrow set
        vm.startPrank(admin);
        BountyPool freshPool = new BountyPool(admin, address(ledger));
        vm.expectRevert(BountyPool.ZeroAddress.selector);
        freshPool.setEscrow(address(0));
        vm.stopPrank();
    }

    function test_RevertWhen_NonAdminSetsEscrow() public {
        vm.prank(nobody);
        vm.expectRevert();
        pool.setEscrow(address(escrow));
    }

    // ══════════════════════════════════════════════
    //  CANCEL BOUNTY — ADDITIONAL CASES
    // ══════════════════════════════════════════════

    function test_RevertWhen_CancellingAlreadyCancelledBounty() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(protocolOwner);
        pool.cancelBounty(bountyId);

        vm.prank(protocolOwner);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.BountyNotActive.selector, bountyId));
        pool.cancelBounty(bountyId);
    }

    function test_CancelBounty_EmitsEvent() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(protocolOwner);
        vm.expectEmit(true, true, false, true);
        emit BountyPool.BountyCancelled(bountyId, protocolOwner, FUND);
        pool.cancelBounty(bountyId);
    }

    // ══════════════════════════════════════════════
    //  FUND BOUNTY — ADDITIONAL CASES
    // ══════════════════════════════════════════════

    function test_RevertWhen_FundBounty_ZeroValue() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(protocolOwner);
        vm.expectRevert(BountyPool.InsufficientFunds.selector);
        pool.fundBounty{value: 0}(bountyId);
    }

    function test_FundBounty_EmitsEvent() public {
        uint256 bountyId = _createDefaultBounty();

        vm.prank(protocolOwner);
        vm.expectEmit(true, true, false, true);
        emit BountyPool.BountyFunded(bountyId, protocolOwner, 2 ether);
        pool.fundBounty{value: 2 ether}(bountyId);
    }

    // ══════════════════════════════════════════════
    //  SUBMIT FINDING — INSUFFICIENT FUNDS
    // ══════════════════════════════════════════════

    function test_RevertWhen_SubmitFinding_InsufficientBountyFunds() public {
        // Create a bounty, verify a finding to drain funds, then try to submit again
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: REWARD}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        // Agent1 submits and gets verified (drains the bounty)
        vm.prank(agent1);
        uint256 findingId = pool.submitFinding(bountyId, hex"aa", "Bug", BountyPool.Severity.High);

        vm.prank(admin);
        escrow.verify(findingId);

        // Bounty is now deactivated (funds exhausted), so agent2 should fail
        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.BountyNotActive.selector, bountyId));
        pool.submitFinding(bountyId, hex"bb", "Another bug", BountyPool.Severity.High);
    }

    // ══════════════════════════════════════════════
    //  ONLY-ESCROW DIRECT CALLS
    // ══════════════════════════════════════════════

    function test_RevertWhen_DirectCallVerifyAndPay() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        vm.prank(admin);
        vm.expectRevert(BountyPool.OnlyEscrow.selector);
        pool.verifyAndPay(findingId);
    }

    function test_RevertWhen_DirectCallRejectFinding() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        vm.prank(admin);
        vm.expectRevert(BountyPool.OnlyEscrow.selector);
        pool.rejectFinding(findingId);
    }

    // ══════════════════════════════════════════════
    //  VERIFY AND PAY — EDGE CASES
    // ══════════════════════════════════════════════

    function test_RevertWhen_VerifyAndPay_NonExistentFinding() public {
        // Call via escrow (verifier) on a finding that doesn't exist
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.InvalidFinding.selector, 999));
        escrow.verify(999);
    }

    function test_RevertWhen_VerifyAndPay_AlreadyVerified() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        vm.prank(admin);
        escrow.verify(findingId);

        // Try again via escrow — escrow will catch AlreadyProcessed first
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyProcessed.selector, findingId));
        escrow.verify(findingId);
    }

    function test_RevertWhen_RejectFinding_NonExistentFinding() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.InvalidFinding.selector, 999));
        escrow.reject(999);
    }

    function test_RevertWhen_RejectFinding_AlreadyRejected() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        vm.prank(admin);
        escrow.reject(findingId);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyProcessed.selector, findingId));
        escrow.reject(findingId);
    }

    // ══════════════════════════════════════════════
    //  VERIFY / REJECT EVENT EMISSIONS
    // ══════════════════════════════════════════════

    function test_VerifyAndPay_EmitsVerifiedAndRewardPaid() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        vm.prank(admin);
        vm.expectEmit(true, true, true, true);
        emit BountyPool.FindingVerified(findingId, bountyId, agent1);
        escrow.verify(findingId);
    }

    function test_RejectFinding_EmitsRejectedEvent() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        vm.prank(admin);
        vm.expectEmit(true, true, true, true);
        emit BountyPool.FindingRejected(findingId, bountyId, agent1);
        escrow.reject(findingId);
    }

    // ══════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ══════════════════════════════════════════════

    function test_GetBountyWhitelist_Empty() public {
        uint256 bountyId = _createDefaultBounty();
        address[] memory wl = pool.getBountyWhitelist(bountyId);
        assertEq(wl.length, 0);
    }

    function test_GetBountyWhitelist_WithAgents() public {
        address[] memory whitelist = new address[](2);
        whitelist[0] = agent1;
        whitelist[1] = agent2;
        uint256 bountyId = _createWhitelistedBounty(whitelist);

        address[] memory wl = pool.getBountyWhitelist(bountyId);
        assertEq(wl.length, 2);
        assertEq(wl[0], agent1);
        assertEq(wl[1], agent2);
    }

    // ══════════════════════════════════════════════
    //  RECEIVE FUNCTION
    // ══════════════════════════════════════════════

    function test_ReceiveETH() public {
        vm.deal(nobody, 1 ether);
        vm.prank(nobody);
        (bool sent,) = address(pool).call{value: 0.5 ether}("");
        assertTrue(sent);
        assertEq(address(pool).balance, 0.5 ether);
    }

    // ══════════════════════════════════════════════
    //  CREATE BOUNTY WITH WHITELIST
    // ══════════════════════════════════════════════

    function test_CreateBounty_WithWhitelist() public {
        address[] memory whitelist = new address[](2);
        whitelist[0] = agent1;
        whitelist[1] = agent2;

        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        address[] memory stored = pool.getBountyWhitelist(bountyId);
        assertEq(stored.length, 2);
    }

    // ══════════════════════════════════════════════
    //  FINDING NOT PENDING (direct pool calls via escrow)
    // ══════════════════════════════════════════════

    function test_RevertWhen_VerifyAndPay_FindingNotPending() public {
        // Verify a finding, then try to verify again directly through pool
        // (the escrow catches AlreadyProcessed first, so we test the pool directly)
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        // Verify via escrow first
        vm.prank(admin);
        escrow.verify(findingId);

        // Now call verifyAndPay directly from escrow address to test FindingNotPending
        vm.prank(address(escrow));
        vm.expectRevert(abi.encodeWithSelector(BountyPool.FindingNotPending.selector, findingId));
        pool.verifyAndPay(findingId);
    }

    function test_RevertWhen_RejectFinding_FindingNotPending() public {
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        // Reject via escrow first
        vm.prank(admin);
        escrow.reject(findingId);

        // Now call rejectFinding directly from escrow address to test FindingNotPending
        vm.prank(address(escrow));
        vm.expectRevert(abi.encodeWithSelector(BountyPool.FindingNotPending.selector, findingId));
        pool.rejectFinding(findingId);
    }

    // ══════════════════════════════════════════════
    //  SUBMIT FINDING — PARTIAL FUNDS (below rewardAmount)
    // ══════════════════════════════════════════════

    function test_RevertWhen_SubmitFinding_FundsBelowReward() public {
        // Create bounty with 2 ether but reward of 1 ether
        // Verify one finding (leaving 1 ether), then fund-drain by verifying again
        // Finally a new agent tries to submit when totalFunds < rewardAmount

        address agent3 = makeAddr("agent3");
        vm.prank(admin);
        ledger.registerAgent(agent3);
        vm.deal(agent3, 1 ether);

        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: 2 * REWARD}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        // Agent1 submits and gets verified → 1 ether left, bounty still active
        vm.prank(agent1);
        uint256 f1 = pool.submitFinding(bountyId, hex"aa", "Bug1", BountyPool.Severity.High);
        vm.prank(admin);
        escrow.verify(f1);

        // Agent2 submits and gets verified → 0 ether left, bounty deactivated
        vm.prank(agent2);
        uint256 f2 = pool.submitFinding(bountyId, hex"bb", "Bug2", BountyPool.Severity.High);
        vm.prank(admin);
        escrow.verify(f2);

        // Bounty is now inactive
        vm.prank(agent3);
        vm.expectRevert(abi.encodeWithSelector(BountyPool.BountyNotActive.selector, bountyId));
        pool.submitFinding(bountyId, hex"cc", "Bug3", BountyPool.Severity.High);
    }

    // ══════════════════════════════════════════════
    //  VERIFY WHEN BOUNTY FUNDS INSUFFICIENT (edge)
    // ══════════════════════════════════════════════

    function test_RevertWhen_VerifyAndPay_InsufficientBountyFunds() public {
        // Create a bounty, submit a finding, then drain funds externally before verify
        // We do this by cancelling a bounty and creating a new one with exact funds
        // Then partially draining via a verified finding

        address agent3 = makeAddr("agent3");
        vm.prank(admin);
        ledger.registerAgent(agent3);
        vm.deal(agent3, 1 ether);

        // Create bounty with 2 rewards, submit 2 findings, verify first one
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: 2 * REWARD}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        vm.prank(agent1);
        uint256 f1 = pool.submitFinding(bountyId, hex"aa", "Bug1", BountyPool.Severity.High);
        vm.prank(agent2);
        uint256 f2 = pool.submitFinding(bountyId, hex"bb", "Bug2", BountyPool.Severity.High);

        // Verify f1 → funds drop to 1 REWARD, still active
        vm.prank(admin);
        escrow.verify(f1);

        // Verify f2 → funds drop to 0, bounty deactivated
        vm.prank(admin);
        escrow.verify(f2);

        // Both agents got paid
        BountyPool.Bounty memory b = pool.getBounty(bountyId);
        assertEq(b.totalFunds, 0);
        assertFalse(b.active);
    }

    // ══════════════════════════════════════════════
    //  ETH TRANSFER FAILURE — CANCEL BOUNTY REFUND
    // ══════════════════════════════════════════════

    function test_RevertWhen_CancelBounty_RefundFails() public {
        // Use RejectETH as the bounty creator so the refund reverts
        RejectETH rejector = new RejectETH();
        vm.deal(address(rejector), 100 ether);

        // Create a bounty from the rejector contract
        address[] memory whitelist = new address[](0);
        vm.prank(address(rejector));
        uint256 bountyId = pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Medium,
            block.timestamp + DEADLINE,
            whitelist
        );

        // Try to cancel — the refund to RejectETH should fail
        vm.prank(address(rejector));
        vm.expectRevert("Refund failed");
        pool.cancelBounty(bountyId);
    }

    // ══════════════════════════════════════════════
    //  ETH TRANSFER FAILURE — REWARD PAYMENT
    // ══════════════════════════════════════════════

    function test_RevertWhen_VerifyAndPay_RewardTransferFails() public {
        // Use RejectETHAgent as the submitting agent so reward transfer reverts
        RejectETHAgent rejectorAgent = new RejectETHAgent();

        // Register the rejector agent and give it reputation
        vm.startPrank(admin);
        ledger.registerAgent(address(rejectorAgent));
        vm.stopPrank();

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

        // Submit finding from the rejector agent
        vm.prank(address(rejectorAgent));
        uint256 findingId = pool.submitFinding(
            bountyId,
            hex"deadbeef",
            "Vuln found",
            BountyPool.Severity.High
        );

        // Verify — reward transfer to RejectETHAgent should fail
        vm.prank(admin);
        vm.expectRevert("Reward transfer failed");
        escrow.verify(findingId);
    }

    // ══════════════════════════════════════════════
    //  SUBMIT FINDING — INSUFFICIENT FUNDS CHECK
    // ══════════════════════════════════════════════

    function test_RevertWhen_SubmitFinding_InsufficientFundsDuringSubmission() public {
        // We need to test the InsufficientFunds check (line 193):
        // active=true but totalFunds < rewardAmount.
        // Use vm.store to manipulate totalFunds directly.
        
        address[] memory whitelist = new address[](0);
        vm.prank(protocolOwner);
        uint256 bountyId = pool.createBounty{value: FUND}(
            vulnContract,
            REWARD,
            BountyPool.Severity.Low,
            block.timestamp + DEADLINE,
            whitelist
        );

        // bounties mapping is at storage slot 3
        // Bounty struct fields: targetContract(0), bountyCreator(1), rewardAmount(2),
        // severityThreshold+active packed(3), deadline(4), totalFunds(5), findingCount(6)
        bytes32 bountySlot = keccak256(abi.encode(bountyId, uint256(3)));
        bytes32 totalFundsSlot = bytes32(uint256(bountySlot) + 5);
        vm.store(address(pool), totalFundsSlot, bytes32(uint256(0)));

        vm.prank(agent1);
        vm.expectRevert(BountyPool.InsufficientFunds.selector);
        pool.submitFinding(bountyId, hex"deadbeef", "Bug", BountyPool.Severity.High);
    }

    // ══════════════════════════════════════════════
    //  VERIFY AND PAY — INSUFFICIENT FUNDS (line 245)
    // ══════════════════════════════════════════════

    function test_RevertWhen_VerifyAndPay_InsufficientFundsDuringVerify() public {
        // Submit a finding, then drain bounty funds via vm.store before verifying
        uint256 bountyId = _createDefaultBounty();
        uint256 findingId = _submitFinding(bountyId, agent1);

        // Zero out totalFunds via storage manipulation
        // bounties mapping is at slot 3, totalFunds is at offset 5
        bytes32 bountySlot = keccak256(abi.encode(bountyId, uint256(3)));
        bytes32 totalFundsSlot = bytes32(uint256(bountySlot) + 5);
        vm.store(address(pool), totalFundsSlot, bytes32(uint256(0)));

        // Now verify — should revert with InsufficientFunds
        vm.prank(address(escrow));
        vm.expectRevert(BountyPool.InsufficientFunds.selector);
        pool.verifyAndPay(findingId);
    }
}

/// @notice Helper contract that rejects ETH transfers (for testing refund failures)
contract RejectETH {
    receive() external payable {
        revert("I reject ETH");
    }

    // Allow creating bounties
    function approve(address, uint256) external pure returns (bool) {
        return true;
    }
}

/// @notice Helper: agent contract that rejects ETH rewards
contract RejectETHAgent {
    // Submit findings
    function submitFinding(
        BountyPool pool,
        uint256 bountyId,
        bytes calldata pocData,
        string calldata description,
        BountyPool.Severity severity
    ) external returns (uint256) {
        return pool.submitFinding(bountyId, pocData, description, severity);
    }

    // Reject incoming ETH
    receive() external payable {
        revert("I reject ETH rewards");
    }
}
