// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title VulnerableVault
/// @notice A simple ETH savings vault — intentionally buggy for testing Ares.
///
/// Known issues (DO NOT use in production):
///   1. Reentrancy in withdraw() — state updated AFTER external call
///   2. Anyone can call emergencyDrain() — no access control
///   3. flashLoan() fee calculation overflows for large amounts
///   4. setFeeRate() accepts 0 which later causes division-by-zero
///   5. owner can be changed by anyone via transferOwnership()
contract VulnerableVault {

    address public owner;
    uint256 public feeRate = 100; // basis points, e.g. 100 = 1%
    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event FlashLoan(address indexed borrower, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    // ── Deposit ──────────────────────────────────────────────────────────────

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    // ── BUG 1: Reentrancy ────────────────────────────────────────────────────
    // State is updated AFTER the external call — an attacker contract can
    // re-enter withdraw() before balances[msg.sender] is zeroed.
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // Vulnerable: external call before state update
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        balances[msg.sender] -= amount;   // should be BEFORE the call
        totalDeposits -= amount;
    }

    // ── BUG 2: Missing access control ────────────────────────────────────────
    // Anyone can drain the entire contract balance.
    function emergencyDrain() external {
        // Missing: require(msg.sender == owner, "Not owner");
        uint256 balance = address(this).balance;
        (bool success, ) = msg.sender.call{value: balance}("");
        require(success, "Drain failed");
    }

    // ── BUG 3: Integer overflow in fee calculation ────────────────────────────
    // For very large amounts, amount * feeRate overflows before / 10000.
    function flashLoan(address borrower, uint256 amount) external {
        require(amount <= address(this).balance, "Insufficient liquidity");

        uint256 fee = amount * feeRate / 10000;   // overflows if amount > type(uint256).max / feeRate

        uint256 balanceBefore = address(this).balance;
        (bool success, ) = borrower.call{value: amount}(
            abi.encodeWithSignature("onFlashLoan(uint256)", amount)
        );
        require(success, "Callback failed");

        require(
            address(this).balance >= balanceBefore + fee,
            "Flash loan not repaid"
        );

        emit FlashLoan(borrower, amount);
    }

    // ── BUG 4: Division-by-zero via setFeeRate(0) ────────────────────────────
    function setFeeRate(uint256 newRate) external {
        require(msg.sender == owner, "Not owner");
        // Missing: require(newRate > 0, "Fee rate cannot be zero");
        feeRate = newRate;
    }

    // ── BUG 5: Unprotected ownership transfer ─────────────────────────────────
    // Any caller can claim ownership — onlyOwner modifier not applied.
    function transferOwnership(address newOwner) external {
        // Missing: require(msg.sender == owner, "Not owner");
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    receive() external payable {
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
    }
}
