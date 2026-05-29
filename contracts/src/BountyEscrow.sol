// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {BountyPool} from "./BountyPool.sol";

/// @title BountyEscrow
/// @notice Verification layer that judges submitted findings and triggers
///         payouts or rejections on the BountyPool.
/// @dev    In MVP, an off-chain oracle (the ABBH agent or a DAO multisig)
///         calls `verify()` / `reject()` after running the PoC in a
///         sandboxed fork via `eth_call` with state overrides.
contract BountyEscrow is AccessControl {
    // ──────────────────── Roles ────────────────────
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ──────────────────── State ────────────────────
    BountyPool public bountyPool;

    /// @dev findingId => true if already processed (verified or rejected)
    mapping(uint256 => bool) public processed;

    // ──────────────────── Events ───────────────────
    event VerificationRequested(uint256 indexed findingId, address indexed verifier);
    event VerificationPassed(uint256 indexed findingId);
    event VerificationFailed(uint256 indexed findingId);

    // ──────────────────── Errors ───────────────────
    error AlreadyProcessed(uint256 findingId);
    error ZeroAddress();

    // ──────────────────── Constructor ──────────────
    constructor(address admin, address _bountyPool) {
        if (admin == address(0) || _bountyPool == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
        bountyPool = BountyPool(payable(_bountyPool));
    }

    // ──────────────────── Verifier ─────────────────

    /// @notice Verify a finding. The off-chain oracle has already confirmed the
    ///         PoC works. This triggers payout via BountyPool.
    /// @param findingId The finding to verify.
    function verify(uint256 findingId) external onlyRole(VERIFIER_ROLE) {
        if (processed[findingId]) revert AlreadyProcessed(findingId);
        processed[findingId] = true;

        emit VerificationRequested(findingId, msg.sender);

        bountyPool.verifyAndPay(findingId);

        emit VerificationPassed(findingId);
    }

    /// @notice Reject a finding (PoC failed or false positive).
    /// @param findingId The finding to reject.
    function reject(uint256 findingId) external onlyRole(VERIFIER_ROLE) {
        if (processed[findingId]) revert AlreadyProcessed(findingId);
        processed[findingId] = true;

        emit VerificationRequested(findingId, msg.sender);

        bountyPool.rejectFinding(findingId);

        emit VerificationFailed(findingId);
    }

    // ──────────────────── Admin ────────────────────

    /// @notice Update the BountyPool reference (in case of migration).
    function setBountyPool(address _bountyPool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_bountyPool == address(0)) revert ZeroAddress();
        bountyPool = BountyPool(payable(_bountyPool));
    }
}
