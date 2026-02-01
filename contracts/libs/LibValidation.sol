// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library LibValidation {
    error InvalidSignatureLength();
    error InvalidSignature();

    function recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }

        // accept both 27/28 and 0/1
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();

        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }

    /// @notice Ethereum Signed Message prefix (EIP-191).
    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }
}
