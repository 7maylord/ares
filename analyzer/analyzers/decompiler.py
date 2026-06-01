"""
Bytecode decompiler for unverified contracts.

Strategy:
  1. Try Heimdall CLI (`heimdall decompile`) — produces high-quality pseudo-Solidity
  2. Fall back to basic opcode disassembly using pyevmasm (if installed)
  3. Last resort: return hex-annotated bytecode with a warning comment
"""

import subprocess
import shutil
import logging
import re

logger = logging.getLogger(__name__)

# EVM opcode table (subset — enough for readable disassembly)
_OPCODES: dict[int, str] = {
    0x00: "STOP", 0x01: "ADD", 0x02: "MUL", 0x03: "SUB", 0x04: "DIV",
    0x05: "SDIV", 0x06: "MOD", 0x07: "SMOD", 0x08: "ADDMOD", 0x09: "MULMOD",
    0x0a: "EXP", 0x0b: "SIGNEXTEND", 0x10: "LT", 0x11: "GT", 0x12: "SLT",
    0x13: "SGT", 0x14: "EQ", 0x15: "ISZERO", 0x16: "AND", 0x17: "OR",
    0x18: "XOR", 0x19: "NOT", 0x1a: "BYTE", 0x1b: "SHL", 0x1c: "SHR",
    0x1d: "SAR", 0x20: "SHA3", 0x30: "ADDRESS", 0x31: "BALANCE",
    0x32: "ORIGIN", 0x33: "CALLER", 0x34: "CALLVALUE", 0x35: "CALLDATALOAD",
    0x36: "CALLDATASIZE", 0x37: "CALLDATACOPY", 0x38: "CODESIZE",
    0x39: "CODECOPY", 0x3a: "GASPRICE", 0x3b: "EXTCODESIZE",
    0x3c: "EXTCODECOPY", 0x3d: "RETURNDATASIZE", 0x3e: "RETURNDATACOPY",
    0x3f: "EXTCODEHASH", 0x40: "BLOCKHASH", 0x41: "COINBASE",
    0x42: "TIMESTAMP", 0x43: "NUMBER", 0x44: "DIFFICULTY", 0x45: "GASLIMIT",
    0x46: "CHAINID", 0x47: "SELFBALANCE", 0x48: "BASEFEE", 0x50: "POP",
    0x51: "MLOAD", 0x52: "MSTORE", 0x53: "MSTORE8", 0x54: "SLOAD",
    0x55: "SSTORE", 0x56: "JUMP", 0x57: "JUMPI", 0x58: "PC", 0x59: "MSIZE",
    0x5a: "GAS", 0x5b: "JUMPDEST", 0xf0: "CREATE", 0xf1: "CALL",
    0xf2: "CALLCODE", 0xf3: "RETURN", 0xf4: "DELEGATECALL", 0xf5: "CREATE2",
    0xfa: "STATICCALL", 0xfd: "REVERT", 0xfe: "INVALID", 0xff: "SELFDESTRUCT",
}


def decompile(bytecode: str) -> str:
    """
    Decompile EVM bytecode to pseudo-Solidity (best-effort).

    Args:
        bytecode: Hex string, with or without 0x prefix.

    Returns:
        Decompiled source string tagged with the method used.
    """
    hex_code = bytecode.removeprefix("0x").strip()
    if not hex_code:
        return "// ERROR: empty bytecode"

    # 1. Try Heimdall
    if shutil.which("heimdall"):
        result = _run_heimdall(hex_code)
        if result:
            return f"// Source: Heimdall decompiler\n{result}"
        logger.warning("Heimdall decompile failed, falling back to disassembly")

    # 2. Try pyevmasm
    try:
        import pyevmasm  # noqa: F401
        result = _run_pyevmasm(hex_code)
        if result:
            return f"// Source: pyevmasm disassembly (no Heimdall available)\n{result}"
    except ImportError:
        pass

    # 3. Basic fallback
    return _basic_disassemble(hex_code)


def _run_heimdall(hex_code: str) -> str | None:
    try:
        proc = subprocess.run(
            ["heimdall", "decompile", hex_code],
            capture_output=True,
            text=True,
            timeout=60,
        )
        output = proc.stdout.strip()
        if proc.returncode == 0 and output:
            return output
        logger.debug(f"Heimdall stderr: {proc.stderr[:200]}")
        return None
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        logger.warning(f"Heimdall execution error: {e}")
        return None


def _run_pyevmasm(hex_code: str) -> str | None:
    try:
        import pyevmasm
        instructions = pyevmasm.disassemble_all(bytes.fromhex(hex_code))
        lines = [f"// {i.pc:#06x}: {i}" for i in instructions]
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"pyevmasm error: {e}")
        return None


def _basic_disassemble(hex_code: str) -> str:
    """Minimal opcode walk — no external deps."""
    raw = bytes.fromhex(hex_code)
    lines = ["// Source: basic opcode disassembly (install Heimdall for better results)"]
    i = 0
    while i < len(raw):
        op = raw[i]
        name = _OPCODES.get(op, f"UNKNOWN({op:#04x})")
        # PUSH1..PUSH32: opcode is 0x60..0x7f, pushes (op - 0x5f) bytes
        if 0x60 <= op <= 0x7f:
            n = op - 0x5f
            push_data = raw[i + 1: i + 1 + n].hex()
            lines.append(f"// {i:#06x}: {name} 0x{push_data}")
            i += 1 + n
        elif 0x80 <= op <= 0x8f:
            lines.append(f"// {i:#06x}: DUP{op - 0x7f}")
            i += 1
        elif 0x90 <= op <= 0x9f:
            lines.append(f"// {i:#06x}: SWAP{op - 0x8f}")
            i += 1
        elif 0xa0 <= op <= 0xa4:
            lines.append(f"// {i:#06x}: LOG{op - 0xa0}")
            i += 1
        else:
            lines.append(f"// {i:#06x}: {name}")
            i += 1
    return "\n".join(lines)
