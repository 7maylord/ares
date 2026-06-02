"""
Tests for analyzer/analyzers/decompiler.py

Key invariants:
- Returns a non-empty string for any non-empty bytecode
- Falls back gracefully when Heimdall is not installed
- Handles 0x-prefixed and bare hex input identically
- Empty / zero-byte input returns an error comment, not an exception
"""

import pytest
from unittest.mock import patch, MagicMock
from analyzer.analyzers.decompiler import decompile, _basic_disassemble


# Minimal EVM bytecode: PUSH1 0x60 PUSH1 0x40 MSTORE STOP
SAMPLE_BYTECODE_BARE = "6060604052"
SAMPLE_BYTECODE_HEX = "0x" + SAMPLE_BYTECODE_BARE


class TestBasicDisassemble:
    def test_returns_string(self):
        result = _basic_disassemble(SAMPLE_BYTECODE_BARE)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_contains_push_opcode(self):
        result = _basic_disassemble(SAMPLE_BYTECODE_BARE)
        assert "PUSH1" in result

    def test_contains_mstore(self):
        # 0x52 = MSTORE
        result = _basic_disassemble("52")
        assert "MSTORE" in result

    def test_stop_opcode(self):
        result = _basic_disassemble("00")
        assert "STOP" in result

    def test_unknown_opcode_handled(self):
        # 0xef is not a standard opcode
        result = _basic_disassemble("ef")
        assert "UNKNOWN" in result or "0xef" in result


class TestDecompile:
    def test_strips_0x_prefix(self):
        # Both forms should produce the same output
        result_bare = decompile(SAMPLE_BYTECODE_BARE)
        result_hex = decompile(SAMPLE_BYTECODE_HEX)
        # Strip the source tag comment before comparing
        assert result_bare.split("\n", 1)[1] == result_hex.split("\n", 1)[1]

    def test_empty_bytecode_returns_error_comment(self):
        result = decompile("0x")
        assert "ERROR" in result

    def test_falls_back_to_basic_disassembly_when_heimdall_missing(self):
        with patch("shutil.which", return_value=None):
            result = decompile(SAMPLE_BYTECODE_HEX)
        assert "basic opcode disassembly" in result or "PUSH1" in result

    def test_uses_heimdall_when_available(self):
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = "// Heimdall output\nfunction foo() {}"
        with patch("shutil.which", return_value="/usr/local/bin/heimdall"), \
             patch("subprocess.run", return_value=mock_proc):
            result = decompile(SAMPLE_BYTECODE_HEX)
        assert "Heimdall" in result
        assert "foo" in result

    def test_falls_back_when_heimdall_returns_nonzero(self):
        mock_proc = MagicMock()
        mock_proc.returncode = 1
        mock_proc.stdout = ""
        mock_proc.stderr = "decompile failed"
        with patch("shutil.which", return_value="/usr/local/bin/heimdall"), \
             patch("subprocess.run", return_value=mock_proc):
            result = decompile(SAMPLE_BYTECODE_HEX)
        # Should fall back to basic disassembly — Heimdall output absent
        assert "Heimdall decompiler" not in result

    def test_output_is_tagged_with_source(self):
        with patch("shutil.which", return_value=None):
            result = decompile(SAMPLE_BYTECODE_HEX)
        # First line should always be a comment naming the source
        assert result.startswith("//")
