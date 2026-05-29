// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReputationLedger} from "./ReputationLedger.sol";

/// @title BountyPool
/// @notice Allows protocol owners to create bounties on target contracts and
///         agents to submit findings. Works with BountyEscrow for verification.
contract BountyPool is AccessControl, ReentrancyGuard {
    // ──────────────────── Types ────────────────────
    enum Severity { Low, Medium, High, Critical }
    enum FindingStatus { Pending, Verified, Rejected }

    struct Bounty {
        address targetContract;
        address bountyCreator;
        uint256 rewardAmount;
        Severity severityThreshold;
        bool active;
        uint256 deadline;
        uint256 totalFunds;
        uint256 findingCount;
    }

    struct Finding {
        address agent;
        uint256 bountyId;
        bytes pocData;
        string description;
        Severity severity;
        FindingStatus status;
        uint256 submittedAt;
    }

    // ──────────────────── State ────────────────────
    uint256 public nextBountyId;
    uint256 public nextFindingId;

    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => address[]) public bountyWhitelist;
    mapping(uint256 => Finding) public findings;
    /// @dev bountyId => agent => has submitted
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;

    ReputationLedger public reputationLedger;
    address public escrow;

    uint256 public constant MIN_REPUTATION_TO_SUBMIT = 100;

    // ──────────────────── Events ───────────────────
    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        address indexed targetContract,
        uint256 rewardAmount,
        Severity severityThreshold,
        uint256 deadline
    );
    event BountyCancelled(uint256 indexed bountyId, address indexed creator, uint256 refundAmount);
    event BountyFunded(uint256 indexed bountyId, address indexed funder, uint256 amount);
    event FindingSubmitted(
        uint256 indexed findingId,
        uint256 indexed bountyId,
        address indexed agent,
        Severity severity
    );
    event FindingVerified(uint256 indexed findingId, uint256 indexed bountyId, address indexed agent);
    event FindingRejected(uint256 indexed findingId, uint256 indexed bountyId, address indexed agent);
    event RewardPaid(uint256 indexed findingId, address indexed agent, uint256 amount);

    // ──────────────────── Errors ───────────────────
    error BountyNotActive(uint256 bountyId);
    error BountyExpired(uint256 bountyId);
    error BountyStillActive(uint256 bountyId);
    error InsufficientFunds();
    error AgentNotWhitelisted(address agent);
    error AlreadySubmitted(address agent, uint256 bountyId);
    error InsufficientReputation(address agent, uint256 score);
    error InvalidFinding(uint256 findingId);
    error FindingNotPending(uint256 findingId);
    error OnlyEscrow();
    error ZeroAddress();
    error InvalidDeadline();
    error InvalidReward();

    // ──────────────────── Modifiers ────────────────
    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
        _;
    }

    // ──────────────────── Constructor ──────────────
    constructor(address admin, address _reputationLedger) {
        if (admin == address(0) || _reputationLedger == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        reputationLedger = ReputationLedger(_reputationLedger);
    }

    // ──────────────────── Admin ────────────────────

    /// @notice Set the escrow contract address. Can only be called once by admin.
    function setEscrow(address _escrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_escrow == address(0)) revert ZeroAddress();
        escrow = _escrow;
    }

    // ──────────────────── Protocol Owner ───────────

    /// @notice Create a new bounty. Requires sending ETH to fund the bounty pool.
    /// @param targetContract   The contract to audit.
    /// @param rewardAmount     Reward per valid finding (in wei).
    /// @param severityThreshold Minimum severity to qualify.
    /// @param deadline         Unix timestamp after which no submissions are accepted.
    /// @param whitelistedAgents Agents allowed to submit (empty = open to all).
    function createBounty(
        address targetContract,
        uint256 rewardAmount,
        Severity severityThreshold,
        uint256 deadline,
        address[] calldata whitelistedAgents
    ) external payable returns (uint256 bountyId) {
        if (targetContract == address(0)) revert ZeroAddress();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (rewardAmount == 0) revert InvalidReward();
        if (msg.value < rewardAmount) revert InsufficientFunds();

        bountyId = nextBountyId++;

        bounties[bountyId] = Bounty({
            targetContract: targetContract,
            bountyCreator: msg.sender,
            rewardAmount: rewardAmount,
            severityThreshold: severityThreshold,
            active: true,
            deadline: deadline,
            totalFunds: msg.value,
            findingCount: 0
        });

        if (whitelistedAgents.length > 0) {
            bountyWhitelist[bountyId] = whitelistedAgents;
        }

        emit BountyCreated(bountyId, msg.sender, targetContract, rewardAmount, severityThreshold, deadline);
    }

    /// @notice Add more funds to an existing bounty.
    function fundBounty(uint256 bountyId) external payable {
        Bounty storage b = bounties[bountyId];
        if (!b.active) revert BountyNotActive(bountyId);
        if (msg.value == 0) revert InsufficientFunds();

        b.totalFunds += msg.value;
        emit BountyFunded(bountyId, msg.sender, msg.value);
    }

    /// @notice Cancel a bounty and refund remaining funds. Only the creator can cancel.
    function cancelBounty(uint256 bountyId) external nonReentrant {
        Bounty storage b = bounties[bountyId];
        if (b.bountyCreator != msg.sender) revert BountyNotActive(bountyId);
        if (!b.active) revert BountyNotActive(bountyId);

        b.active = false;
        uint256 refund = b.totalFunds;
        b.totalFunds = 0;

        emit BountyCancelled(bountyId, msg.sender, refund);

        (bool sent,) = msg.sender.call{value: refund}("");
        require(sent, "Refund failed");
    }

    // ──────────────────── Agent ────────────────────

    /// @notice Submit a vulnerability finding for a bounty.
    /// @param bountyId    The bounty to submit against.
    /// @param pocData     Encoded proof-of-concept transaction data.
    /// @param description Human-readable vulnerability description.
    /// @param severity    Severity classification of the finding.
    function submitFinding(
        uint256 bountyId,
        bytes calldata pocData,
        string calldata description,
        Severity severity
    ) external returns (uint256 findingId) {
        Bounty storage b = bounties[bountyId];

        // Validate bounty
        if (!b.active) revert BountyNotActive(bountyId);
        if (block.timestamp > b.deadline) revert BountyExpired(bountyId);
        if (b.totalFunds < b.rewardAmount) revert InsufficientFunds();

        // Validate agent
        if (hasSubmitted[bountyId][msg.sender]) revert AlreadySubmitted(msg.sender, bountyId);

        uint256 agentRep = reputationLedger.reputationScore(msg.sender);
        if (agentRep < MIN_REPUTATION_TO_SUBMIT) revert InsufficientReputation(msg.sender, agentRep);

        // Check whitelist (empty = open to all)
        address[] storage whitelist = bountyWhitelist[bountyId];
        if (whitelist.length > 0) {
            bool isWhitelisted = false;
            for (uint256 i = 0; i < whitelist.length; i++) {
                if (whitelist[i] == msg.sender) {
                    isWhitelisted = true;
                    break;
                }
            }
            if (!isWhitelisted) revert AgentNotWhitelisted(msg.sender);
        }

        // Validate severity meets threshold
        require(uint256(severity) >= uint256(b.severityThreshold), "Severity too low");

        // Create finding
        findingId = nextFindingId++;
        findings[findingId] = Finding({
            agent: msg.sender,
            bountyId: bountyId,
            pocData: pocData,
            description: description,
            severity: severity,
            status: FindingStatus.Pending,
            submittedAt: block.timestamp
        });

        hasSubmitted[bountyId][msg.sender] = true;
        b.findingCount++;

        emit FindingSubmitted(findingId, bountyId, msg.sender, severity);
    }

    // ──────────────────── Escrow Callbacks ─────────

    /// @notice Called by the escrow contract after successful verification.
    ///         Pays the agent and updates reputation.
    function verifyAndPay(uint256 findingId) external onlyEscrow nonReentrant {
        Finding storage f = findings[findingId];
        if (f.agent == address(0)) revert InvalidFinding(findingId);
        if (f.status != FindingStatus.Pending) revert FindingNotPending(findingId);

        Bounty storage b = bounties[f.bountyId];
        if (b.totalFunds < b.rewardAmount) revert InsufficientFunds();

        f.status = FindingStatus.Verified;
        uint256 reward = b.rewardAmount;
        b.totalFunds -= reward;

        // If funds exhausted, deactivate bounty
        if (b.totalFunds < b.rewardAmount) {
            b.active = false;
        }

        // Update reputation
        reputationLedger.updateReputation(f.agent, true);

        emit FindingVerified(findingId, f.bountyId, f.agent);
        emit RewardPaid(findingId, f.agent, reward);

        // Transfer reward
        (bool sent,) = f.agent.call{value: reward}("");
        require(sent, "Reward transfer failed");
    }

    /// @notice Called by the escrow contract to reject a finding.
    function rejectFinding(uint256 findingId) external onlyEscrow {
        Finding storage f = findings[findingId];
        if (f.agent == address(0)) revert InvalidFinding(findingId);
        if (f.status != FindingStatus.Pending) revert FindingNotPending(findingId);

        f.status = FindingStatus.Rejected;

        // Update reputation
        reputationLedger.updateReputation(f.agent, false);

        emit FindingRejected(findingId, f.bountyId, f.agent);
    }

    // ──────────────────── View ─────────────────────

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function getFinding(uint256 findingId) external view returns (Finding memory) {
        return findings[findingId];
    }

    function getBountyWhitelist(uint256 bountyId) external view returns (address[] memory) {
        return bountyWhitelist[bountyId];
    }

    /// @dev Allow contract to receive ETH.
    receive() external payable {}
}
