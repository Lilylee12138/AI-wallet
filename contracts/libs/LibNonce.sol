// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Nonce storage library with dedicated slot to avoid collisions.
library LibNonce {
    bytes32 internal constant NONCE_STORAGE_POSITION =
        keccak256("ai-wallet.nonce.storage.v1");

    struct NonceStorage {
        uint256 nonce;
    }

    function nonceStorage() internal pure returns (NonceStorage storage ns) {
        bytes32 position = NONCE_STORAGE_POSITION;
        assembly {
            ns.slot := position
        }
    }

    function get() internal view returns (uint256) {
        return nonceStorage().nonce;
    }

    function increment() internal returns (uint256 prev) {
        NonceStorage storage ns = nonceStorage();
        prev = ns.nonce;
        unchecked {
            ns.nonce = prev + 1;
        }
    }
}
