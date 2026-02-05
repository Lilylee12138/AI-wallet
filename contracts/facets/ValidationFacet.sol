// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";
import "../libs/LibNonce.sol";
import "../libs/LibValidation.sol";
import "../libs/LibIdentity.sol";
import "../interfaces/PackedUserOperation.sol";

/// @notice AA-ready ValidationFacet for ERC-4337 EntryPoint.handleOps.
/// Supports signature modes:
/// - 0x00: Owner EOA signature (EIP-712 userOpHash, fallback EIP-191)
/// - 0x01: Passkey-session (offchain WebAuthn verified; onchain checks issuerSig + passkeyEnabled gate)
/// - 0x02: OAuth-session   (offchain OAuth verified; onchain checks issuerSig)
///
/// Route A: Onchain only verifies ECDSA (secp256k1) signatures from:
/// - owner (mode 0x00)
/// - trustedIssuer (modes 0x01/0x02)
contract ValidationFacet {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    uint8 internal constant MODE_EOA = 0x00;
    uint8 internal constant MODE_PASSKEY_SESSION = 0x01;
    uint8 internal constant MODE_OAUTH_SESSION = 0x02;

    error InvalidSigMode();
    error SessionExpired();
    error SessionNotFound();
    error SessionNonceMismatch();
    error IssuerNotSet();
    error InvalidIssuerSig();
    error PasskeyNotEnabled();

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        // 1) only EntryPoint can call
        LibDiamond.enforceIsEntryPoint();

        // 2) nonce check (MVP). Later you can upgrade to keyed nonce/session nonce in LibNonce.
        if (userOp.nonce != LibNonce.get()) {
            return SIG_VALIDATION_FAILED;
        }

        // 3) signature check (mode dispatch)
        bytes calldata sig = userOp.signature;
        if (sig.length < 1) {
            return SIG_VALIDATION_FAILED;
        }

        uint8 mode = uint8(sig[0]);

        if (mode == MODE_EOA) {
            if (!_validateOwnerEOA(sig[1:], userOpHash)) {
                return SIG_VALIDATION_FAILED;
            }
        
            // DAO/AI auth context: write validated memberId (no re-auth)
            bytes32 memberId = keccak256(abi.encodePacked("EOA", LibDiamond.owner()));
            LibIdentity.setCurrentMemberId(memberId);

} else if (mode == MODE_PASSKEY_SESSION) {
            if (!_validatePasskeySession(sig[1:], userOpHash)) {
                return SIG_VALIDATION_FAILED;
            }
        } else if (mode == MODE_OAUTH_SESSION) {
            if (!_validateOAuthSession(sig[1:], userOpHash)) {
                return SIG_VALIDATION_FAILED;
            }
        } else {
            revert InvalidSigMode();
        }

        // 4) consume AA nonce on success (keep as-is)
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

    // ------------------------------------------------------------
    // Mode 0x00: owner EOA signature (EIP-712 userOpHash, fallback EIP-191)
    // ------------------------------------------------------------
    function _validateOwnerEOA(bytes calldata ownerSig, bytes32 userOpHash) internal view returns (bool) {
        address owner = LibDiamond.owner();

        // (a) EIP-712: signature over userOpHash directly
        address signer712 = LibValidation.recoverSigner(userOpHash, ownerSig);
        if (signer712 == owner) return true;

        // (b) EIP-191 fallback
        bytes32 digest191 = LibValidation.toEthSignedMessageHash(userOpHash);
        address signer191 = LibValidation.recoverSigner(digest191, ownerSig);
        return (signer191 == owner);
    }

    // ------------------------------------------------------------
    // Mode 0x01: passkey session (issuerSig + passkeyEnabled gate)
    // Payload encoding (abi.encode):
    // (bytes32 credentialIdHash, address sessionSigner, uint48 validUntil, uint32 scope, uint64 sessionNonce, bytes issuerSig)
    // ------------------------------------------------------------
    function _validatePasskeySession(bytes calldata payload, bytes32 userOpHash) internal returns (bool) {
        (
            bytes32 credentialIdHash,
            address sessionSigner,
            uint48 validUntil,
            uint32 scope,
            uint64 sessionNonce,
            bytes memory issuerSig
        ) = abi.decode(payload, (bytes32, address, uint48, uint32, uint64, bytes));

        // Passkey must be registered/enabled (MVP gate)
        if (!LibIdentity.isPasskeyEnabled(credentialIdHash)) revert PasskeyNotEnabled();

        
if (!_validateIssuerSessionAuth(
            MODE_PASSKEY_SESSION,
            userOpHash,
            sessionSigner,
            validUntil,
            scope,
            sessionNonce,
            issuerSig
        )) { return false; }
        // DAO/AI auth context: write validated memberId (no re-auth)
        address issuer = LibIdentity.getTrustedIssuer();
        bytes32 memberId = keccak256(abi.encodePacked("PASSKEY", issuer, sessionSigner));
        LibIdentity.setCurrentMemberId(memberId);

        return true;

    }

    // ------------------------------------------------------------
    // Mode 0x02: oauth session (issuerSig)
    // Payload encoding (abi.encode):
    // (address sessionSigner, uint48 validUntil, uint32 scope, uint64 sessionNonce, bytes issuerSig)
    // ------------------------------------------------------------
    function _validateOAuthSession(bytes calldata payload, bytes32 userOpHash) internal returns (bool) {
        (
            address sessionSigner,
            uint48 validUntil,
            uint32 scope,
            uint64 sessionNonce,
            bytes memory issuerSig
        ) = abi.decode(payload, (address, uint48, uint32, uint64, bytes));

        
if (!_validateIssuerSessionAuth(
            MODE_OAUTH_SESSION,
            userOpHash,
            sessionSigner,
            validUntil,
            scope,
            sessionNonce,
            issuerSig
        )) { return false; }
        // DAO/AI auth context: write validated memberId (no re-auth)
        address issuer = LibIdentity.getTrustedIssuer();
        bytes32 memberId = keccak256(abi.encodePacked("OAUTH", issuer, sessionSigner));
        LibIdentity.setCurrentMemberId(memberId);

        return true;

    }

    // ------------------------------------------------------------
    // Shared: verify issuerSig + session policy + anti-replay
    //
    // issuer signs an EIP-191 message over:
    // keccak256(abi.encodePacked(
    //   "AA_SESSION_AUTH_V1",
    //   address(this),
    //   mode,
    //   userOpHash,
    //   sessionSigner,
    //   validUntil,
    //   scope,
    //   sessionNonce
    // ))
    //
    // sessionSigner here is an "authorized signer identity" bound via IdentityFacet.setSession().
    // We additionally require:
    // - session exists
    // - session not expired
    // - sessionNonce == storedNonce + 1 (strict increment)
    // ------------------------------------------------------------
    function _validateIssuerSessionAuth(
        uint8 mode,
        bytes32 userOpHash,
        address sessionSigner,
        uint48 validUntil,
        uint32 scope,
        uint64 sessionNonce,
        bytes memory issuerSig
    ) internal returns (bool ok) {
        ok = false;
address issuer = LibIdentity.getTrustedIssuer();
        if (issuer == address(0)) revert IssuerNotSet();

        // check session exists
        LibIdentity.Session memory s = LibIdentity.getSession(sessionSigner);
        if (!s.exists) revert SessionNotFound();

        // expiry: both payload validUntil and stored session validUntil must allow
        uint48 effectiveUntil = s.validUntil < validUntil ? s.validUntil : validUntil;
        if (effectiveUntil != 0 && block.timestamp > effectiveUntil) revert SessionExpired();

        // anti-replay nonce
        // require strictly increment by 1 (you can relax later)
        if (sessionNonce != s.nonce + 1) revert SessionNonceMismatch();

        // scope: MVP just store; you can add gates later (e.g., only allow DaoFacet selectors)
        // For now, require payload scope is subset of stored scope unless stored scope==0 (meaning "all")
        if (s.scope != 0) {
            // subset check: (payload & ~stored) == 0
            if ((scope & ~s.scope) != 0) { return false; }
        }

        // verify issuer signature
        bytes32 msgHash = keccak256(
            abi.encodePacked(
                "AA_SESSION_AUTH_V1",
                address(this),
                mode,
                userOpHash,
                sessionSigner,
                validUntil,
                scope,
                sessionNonce
            )
        );

        bytes32 digest = LibValidation.toEthSignedMessageHash(msgHash);
        address recovered = LibValidation.recoverSigner(digest, issuerSig);
        if (recovered != issuer) { return false; }

        // bump session nonce in storage on success
        LibIdentity.bumpSessionNonce(sessionSigner, sessionNonce);
        ok = true;
        return ok;
}
}
