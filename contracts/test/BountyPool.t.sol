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
}
