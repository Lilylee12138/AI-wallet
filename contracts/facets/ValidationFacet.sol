// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";
import "../libs/LibNonce.sol";
import "../libs/LibValidation.sol";
import "../interfaces/PackedUserOperation.sol";

/// @notice AA-ready ValidationFacet for ERC-4337 EntryPoint.handleOps.
/// - Only EntryPoint can call validateUserOp
/// - Signature must match owner:
///   - Prefer EIP-712 digest (userOpHash as-is)
///   - Fallback to EIP-191 eth_sign (toEthSignedMessageHash)
/// - Uses LibNonce as minimal nonce source
contract ValidationFacet {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        // 1) only EntryPoint can call
        LibDiamond.enforceIsEntryPoint();

        // 2) nonce check (MVP). Later you can upgrade to keyed nonce.
        if (userOp.nonce != LibNonce.get()) {
            return SIG_VALIDATION_FAILED;
        }

        // 3) signature check
        address owner = LibDiamond.owner();

        // (a) EIP-712: signature over userOpHash directly (this matches _signTypedData in test/UserOp.ts)
        address signer712 = LibValidation.recoverSigner(userOpHash, userOp.signature);
        if (signer712 != owner) {
            // (b) Backward compatibility: eth_sign / personal_sign style (EIP-191)
            bytes32 digest191 = LibValidation.toEthSignedMessageHash(userOpHash);
            address signer191 = LibValidation.recoverSigner(digest191, userOp.signature);
            if (signer191 != owner) {
                return SIG_VALIDATION_FAILED;
            }
        }

        // 4) consume nonce on success
        LibNonce.increment();

        // 5) pay missing funds (EntryPoint deposit topup)
        if (missingAccountFunds != 0) {
            (bool ok, ) = msg.sender.call{value: missingAccountFunds}("");
            if (!ok) {
                return SIG_VALIDATION_FAILED;
            }
        }

        return 0;
    }
}
