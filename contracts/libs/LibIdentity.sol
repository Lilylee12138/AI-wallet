// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Identity/session storage for DiamondAccount.
/// Route A: WebAuthn/OAuth verified offchain; onchain verifies issuer ECDSA signature + session policy.
library LibIdentity {
    bytes32 internal constant IDENTITY_STORAGE_POSITION =
        keccak256("diamond.account.identity.storage.v1");

    struct Session {
        uint48 validUntil;   // unix seconds
        uint32 scope;        // bitmask (MVP: stored only)
        uint64 nonce;        // anti-replay nonce for the session signer
        bool exists;
    }

    struct IdentityStorage {
        address trustedIssuer; // offchain auth service signer (EOA or contract wallet address)
        mapping(address => Session) sessions; // sessionSigner => session
        mapping(bytes32 => bool) passkeyEnabled; // credentialIdHash => enabled
        mapping(bytes32 => bytes32) passkeyRpIdHash; // optional metadata
    
        // DAO/AI hook: last validated memberId (written by ValidationFacet)
        bytes32 currentMemberId;
}

    function ds() internal pure returns (IdentityStorage storage s) {
        bytes32 pos = IDENTITY_STORAGE_POSITION;
        assembly {
            s.slot := pos
        }
    }

    // --- issuer ---
    function getTrustedIssuer() internal view returns (address) {
        return ds().trustedIssuer;
    }

    function setTrustedIssuer(address issuer) internal {
        ds().trustedIssuer = issuer;
    }

    // --- passkey registry ---
    function setPasskey(bytes32 credentialIdHash, bytes32 rpIdHash, bool enabled) internal {
        ds().passkeyEnabled[credentialIdHash] = enabled;
        ds().passkeyRpIdHash[credentialIdHash] = rpIdHash;
    }

    function isPasskeyEnabled(bytes32 credentialIdHash) internal view returns (bool) {
        return ds().passkeyEnabled[credentialIdHash];
    }

    function getPasskeyRpIdHash(bytes32 credentialIdHash) internal view returns (bytes32) {
        return ds().passkeyRpIdHash[credentialIdHash];
    }

    // --- session ---
    function getSession(address sessionSigner) internal view returns (Session memory) {
        return ds().sessions[sessionSigner];
    }

    function setSession(
        address sessionSigner,
        uint48 validUntil,
        uint32 scope,
        uint64 nonce
    ) internal {
        ds().sessions[sessionSigner] = Session({
            validUntil: validUntil,
            scope: scope,
            nonce: nonce,
            exists: true
        });
    }

    function revokeSession(address sessionSigner) internal {
        delete ds().sessions[sessionSigner];
    }

    function bumpSessionNonce(address sessionSigner, uint64 newNonce) internal {
        ds().sessions[sessionSigner].nonce = newNonce;
    }

    // ===== DAO/AI hook: last validated memberId (written by ValidationFacet) =====
    function setCurrentMemberId(bytes32 memberId) internal {
        IdentityStorage storage s = ds();
        s.currentMemberId = memberId;
    }

    function getCurrentMemberId() internal view returns (bytes32) {
        IdentityStorage storage s = ds();
        return s.currentMemberId;
    }

}
