// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";
import "../libs/LibIdentity.sol";

/// @notice IdentityFacet (Route A):
/// - Onchain stores: trustedIssuer + session policies + optional passkey registry metadata.
/// - Actual OAuth/WebAuthn verification happens offchain; issuer signs an authorization over userOpHash.
contract IdentityFacet {
    // --- events ---
    event TrustedIssuerSet(address indexed issuer);
    event SessionSet(address indexed sessionSigner, uint48 validUntil, uint32 scope, uint64 nonce);
    event SessionRevoked(address indexed sessionSigner);
    event PasskeyRegistered(bytes32 indexed credentialIdHash, bytes32 rpIdHash);
    event PasskeyDisabled(bytes32 indexed credentialIdHash);

    modifier onlyOwner() {
        LibDiamond.enforceIsOwner();
        _;
    }

    // --- issuer ---
    function setTrustedIssuer(address issuer) external onlyOwner {
        LibIdentity.setTrustedIssuer(issuer);
        emit TrustedIssuerSet(issuer);
    }

    function getTrustedIssuer() external view returns (address) {
        return LibIdentity.getTrustedIssuer();
    }

    // --- passkey registry (metadata gate) ---
    function registerPasskey(bytes32 credentialIdHash, bytes32 rpIdHash) external onlyOwner {
        LibIdentity.setPasskey(credentialIdHash, rpIdHash, true);
        emit PasskeyRegistered(credentialIdHash, rpIdHash);
    }

    function disablePasskey(bytes32 credentialIdHash) external onlyOwner {
        LibIdentity.setPasskey(credentialIdHash, LibIdentity.getPasskeyRpIdHash(credentialIdHash), false);
        emit PasskeyDisabled(credentialIdHash);
    }

    function isPasskeyEnabled(bytes32 credentialIdHash) external view returns (bool) {
        return LibIdentity.isPasskeyEnabled(credentialIdHash);
    }

    function getPasskeyRpIdHash(bytes32 credentialIdHash) external view returns (bytes32) {
        return LibIdentity.getPasskeyRpIdHash(credentialIdHash);
    }

    // --- session admin ---
    function setSession(
        address sessionSigner,
        uint48 validUntil,
        uint32 scope,
        uint64 nonce
    ) external onlyOwner {
        LibIdentity.setSession(sessionSigner, validUntil, scope, nonce);
        emit SessionSet(sessionSigner, validUntil, scope, nonce);
    }

    function revokeSession(address sessionSigner) external onlyOwner {
        LibIdentity.revokeSession(sessionSigner);
        emit SessionRevoked(sessionSigner);
    }

    function getSession(address sessionSigner)
        external
        view
        returns (uint48 validUntil, uint32 scope, uint64 nonce, bool exists)
    {
        LibIdentity.Session memory s = LibIdentity.getSession(sessionSigner);
        return (s.validUntil, s.scope, s.nonce, s.exists);
    }
}
