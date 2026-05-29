// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ReputationLedger
/// @notice Tracks the reputation of bug-bounty hunter agents based on their
///         submission accuracy. Scores range from 0 to 1000.
contract ReputationLedger is AccessControl {
    // ──────────────────── Roles ────────────────────
    bytes32 public constant JUDGE_ROLE = keccak256("JUDGE_ROLE");

    // ──────────────────── State ────────────────────
    mapping(address => uint256) public reputationScore;
    mapping(address => uint256) public successfulSubmissions;
    mapping(address => uint256) public failedSubmissions;
    mapping(address => uint256) public totalSubmissions;

    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant INITIAL_SCORE = 500;

    // ──────────────────── Events ───────────────────
    event ReputationUpdated(
        address indexed agent,
        bool success,
        uint256 newScore,
        uint256 totalSuccessful,
        uint256 totalFailed
    );
    event AgentRegistered(address indexed agent, uint256 initialScore);

    // ──────────────────── Errors ───────────────────
    error AgentNotRegistered(address agent);
    error AgentAlreadyRegistered(address agent);

    // ──────────────────── Constructor ──────────────
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(JUDGE_ROLE, admin);
    }

    // ──────────────────── External ─────────────────

    /// @notice Register a new agent with the default initial reputation.
    /// @param agent Address of the agent to register.
    function registerAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (reputationScore[agent] != 0) revert AgentAlreadyRegistered(agent);

        reputationScore[agent] = INITIAL_SCORE;
        emit AgentRegistered(agent, INITIAL_SCORE);
    }

    /// @notice Update an agent's reputation after a submission is judged.
    /// @param agent  The agent whose reputation should be updated.
    /// @param success Whether the submission was verified as valid.
    function updateReputation(address agent, bool success) external onlyRole(JUDGE_ROLE) {
        if (reputationScore[agent] == 0) revert AgentNotRegistered(agent);

        totalSubmissions[agent]++;

        if (success) {
            successfulSubmissions[agent]++;
            // +50 on success, capped at MAX_SCORE
            uint256 bonus = 50;
            uint256 current = reputationScore[agent];
            reputationScore[agent] = _min(current + bonus, MAX_SCORE);
        } else {
            failedSubmissions[agent]++;
            // -100 on failure, floored at 1 (never zero — zero means unregistered)
            uint256 penalty = 100;
            uint256 current = reputationScore[agent];
            reputationScore[agent] = current > penalty ? current - penalty : 1;
        }

        emit ReputationUpdated(
            agent,
            success,
            reputationScore[agent],
            successfulSubmissions[agent],
            failedSubmissions[agent]
        );
    }

    // ──────────────────── View ─────────────────────

    /// @notice Returns true when the agent is registered and has a score > 0.
    function isRegistered(address agent) external view returns (bool) {
        return reputationScore[agent] > 0;
    }

    /// @notice Convenience getter returning all stats for a single agent.
    function getAgentStats(address agent)
        external
        view
        returns (uint256 score, uint256 successful, uint256 failed, uint256 total)
    {
        return (
            reputationScore[agent],
            successfulSubmissions[agent],
            failedSubmissions[agent],
            totalSubmissions[agent]
        );
    }

    // ──────────────────── Internal ─────────────────
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
