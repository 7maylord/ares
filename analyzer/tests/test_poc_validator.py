"""
Tests for analyzer/poc_validator.py

Key invariants:
- Every supported vulnerability type returns a valid 0x-prefixed hex string
- The first 4 bytes encode the correct function selector
- Unsupported types return '0x' (not an exception)
- Address and uint256 arguments are correctly ABI-encoded (32-byte aligned)
"""

from web3 import Web3
from analyzer.poc_validator import PoCValidator, _selector, _encode_uint256, _encode_address

_w3 = Web3()
ATTACKER = "0x" + "aa" * 20


def selector_of(fn_sig: str) -> bytes:
    return Web3.keccak(text=fn_sig)[:4]


class TestEncodingHelpers:
    def test_selector_length(self):
        assert len(_selector("transfer", ["address", "uint256"])) == 4

    def test_selector_matches_keccak(self):
        expected = selector_of("transfer(address,uint256)")
        assert _selector("transfer", ["address", "uint256"]) == expected

    def test_encode_uint256_max(self):
        data = _encode_uint256(2**256 - 1)
        assert len(data) == 32
        assert data == b"\xff" * 32

    def test_encode_uint256_zero(self):
        data = _encode_uint256(0)
        assert len(data) == 32
        assert data == b"\x00" * 32

    def test_encode_address_padding(self):
        data = _encode_address(ATTACKER)
        assert len(data) == 32
        # First 12 bytes should be zero (left-padding)
        assert data[:12] == b"\x00" * 12
        # Last 20 bytes should be the address
        assert data[12:] == bytes.fromhex("aa" * 20)


class TestPoCValidator:
    def setup_method(self):
        self.poc = PoCValidator()
        self.base_info = {"attacker_address": ATTACKER}

    def _assert_valid_hex(self, result: str):
        assert result.startswith("0x"), f"Expected 0x prefix, got: {result!r}"
        assert len(result) > 2, "Expected non-empty payload"
        bytes.fromhex(result[2:])  # must be valid hex

    def test_reentrancy_returns_withdraw_selector(self):
        result = self.poc.generate_poc("reentrancy", self.base_info)
        self._assert_valid_hex(result)
        payload = bytes.fromhex(result[2:])
        assert payload[:4] == selector_of("withdraw()")

    def test_reentrancy_custom_function(self):
        result = self.poc.generate_poc("reentrancy", {**self.base_info, "function_name": "claimReward"})
        payload = bytes.fromhex(result[2:])
        assert payload[:4] == selector_of("claimReward()")

    def test_access_control_encodes_address(self):
        result = self.poc.generate_poc("access_control", self.base_info)
        self._assert_valid_hex(result)
        payload = bytes.fromhex(result[2:])
        # Payload: 4-byte selector + 32-byte ABI-encoded address
        # ABI address encoding: 12 zero-padding bytes + 20-byte address
        assert len(payload) == 36
        assert payload[4:16] == b"\x00" * 12   # left-padding
        assert payload[16:36] == bytes.fromhex("aa" * 20)  # attacker address

    def test_integer_overflow_encodes_uint256_max(self):
        result = self.poc.generate_poc("integer_overflow", self.base_info)
        self._assert_valid_hex(result)
        payload = bytes.fromhex(result[2:])
        # Payload: 4 + 32 (address) + 32 (uint256_max)
        assert len(payload) == 68
        assert payload[36:68] == b"\xff" * 32

    def test_unchecked_return_value(self):
        result = self.poc.generate_poc("unchecked_return_value", {**self.base_info, "amount": 100})
        self._assert_valid_hex(result)

    def test_front_running(self):
        result = self.poc.generate_poc("front_running", {**self.base_info, "amount": 10**18})
        self._assert_valid_hex(result)

    def test_delegatecall(self):
        result = self.poc.generate_poc("delegatecall", self.base_info)
        self._assert_valid_hex(result)

    def test_timestamp_dependence(self):
        result = self.poc.generate_poc("timestamp_dependence", self.base_info)
        self._assert_valid_hex(result)

    def test_denial_of_service(self):
        result = self.poc.generate_poc("dos", self.base_info)
        self._assert_valid_hex(result)

    def test_unknown_type_returns_0x(self):
        result = self.poc.generate_poc("not_a_real_vuln_type", self.base_info)
        assert result == "0x"

    def test_hyphen_normalisation(self):
        # "access-control" should map to the same template as "access_control"
        result = self.poc.generate_poc("access-control", self.base_info)
        assert result != "0x"

    def test_case_insensitive(self):
        result = self.poc.generate_poc("Reentrancy", self.base_info)
        assert result != "0x"
