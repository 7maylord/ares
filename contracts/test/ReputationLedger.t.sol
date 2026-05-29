// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {ReputationLedger} from "../src/ReputationLedger.sol";

contract ReputationLedgerTest is Test {
    ReputationLedger public ledger;

    address admin = makeAddr("admin");
    address judge = makeAddr("judge");
    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");
    address nobody = makeAddr("nobody");

    function setUp() public {
        vm.startPrank(admin);
        ledger = new ReputationLedger(admin);
        ledger.grantRole(ledger.JUDGE_ROLE(), judge);
        vm.stopPrank();
    }

    // ─────────────── Registration ───────────────

    function test_RegisterAgent() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        assertEq(ledger.reputationScore(agent1), 500);
        assertTrue(ledger.isRegistered(agent1));
    }

    function test_RegisterAgent_EmitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit ReputationLedger.AgentRegistered(agent1, 500);
        ledger.registerAgent(agent1);
    }

    function test_RevertWhen_RegisteringTwice() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ReputationLedger.AgentAlreadyRegistered.selector, agent1));
        ledger.registerAgent(agent1);
    }

    function test_RevertWhen_NonAdminRegisters() public {
        vm.prank(nobody);
        vm.expectRevert();
        ledger.registerAgent(agent1);
    }

    // ─────────────── Reputation Updates ───────────────

    function test_SuccessfulSubmission_IncreasesScore() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        vm.prank(judge);
        ledger.updateReputation(agent1, true);

        assertEq(ledger.reputationScore(agent1), 550); // 500 + 50
        assertEq(ledger.successfulSubmissions(agent1), 1);
        assertEq(ledger.failedSubmissions(agent1), 0);
        assertEq(ledger.totalSubmissions(agent1), 1);
    }

    function test_FailedSubmission_DecreasesScore() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        vm.prank(judge);
        ledger.updateReputation(agent1, false);

        assertEq(ledger.reputationScore(agent1), 400); // 500 - 100
        assertEq(ledger.successfulSubmissions(agent1), 0);
        assertEq(ledger.failedSubmissions(agent1), 1);
    }

    function test_ScoreCappedAtMax() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        // 11 successes: 500 + (11 * 50) = 1050, but should cap at 1000
        vm.startPrank(judge);
        for (uint256 i = 0; i < 11; i++) {
            ledger.updateReputation(agent1, true);
        }
        vm.stopPrank();

        assertEq(ledger.reputationScore(agent1), 1000);
    }

    function test_ScoreFlooredAtOne() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        // 6 failures: 500 - (6 * 100) = -100, but should floor at 1
        vm.startPrank(judge);
        for (uint256 i = 0; i < 6; i++) {
            ledger.updateReputation(agent1, false);
        }
        vm.stopPrank();

        assertEq(ledger.reputationScore(agent1), 1);
    }

    function test_UpdateReputation_EmitsEvent() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        vm.prank(judge);
        vm.expectEmit(true, false, false, true);
        emit ReputationLedger.ReputationUpdated(agent1, true, 550, 1, 0);
        ledger.updateReputation(agent1, true);
    }

    function test_RevertWhen_UpdatingUnregisteredAgent() public {
        vm.prank(judge);
        vm.expectRevert(abi.encodeWithSelector(ReputationLedger.AgentNotRegistered.selector, agent1));
        ledger.updateReputation(agent1, true);
    }

    function test_RevertWhen_NonJudgeUpdates() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        vm.prank(nobody);
        vm.expectRevert();
        ledger.updateReputation(agent1, true);
    }

    // ─────────────── View Functions ───────────────

    function test_GetAgentStats() public {
        vm.prank(admin);
        ledger.registerAgent(agent1);

        vm.startPrank(judge);
        ledger.updateReputation(agent1, true);
        ledger.updateReputation(agent1, true);
        ledger.updateReputation(agent1, false);
        vm.stopPrank();

        (uint256 score, uint256 successful, uint256 failed, uint256 total) = ledger.getAgentStats(agent1);

        assertEq(score, 500); // 500 + 50 + 50 - 100 = 500
        assertEq(successful, 2);
        assertEq(failed, 1);
        assertEq(total, 3);
    }

    function test_IsRegistered_ReturnsFalseForUnknown() public view {
        assertFalse(ledger.isRegistered(nobody));
    }

    // ─────────────── Multiple Agents ───────────────

    function test_MultipleAgentsIndependent() public {
        vm.startPrank(admin);
        ledger.registerAgent(agent1);
        ledger.registerAgent(agent2);
        vm.stopPrank();

        vm.startPrank(judge);
        ledger.updateReputation(agent1, true);
        ledger.updateReputation(agent2, false);
        vm.stopPrank();

        assertEq(ledger.reputationScore(agent1), 550);
        assertEq(ledger.reputationScore(agent2), 400);
    }
}
