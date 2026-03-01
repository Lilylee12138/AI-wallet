// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";
import "../libs/LibValidation.sol";
import "../libs/LibRiskOracle.sol";

contract RiskOracleFacet {
    using LibRiskOracle for LibRiskOracle.RiskAttestation;

    // ---------- errors ----------
    error NotSelf();
    error OracleNotSet();
    error Expired();
    error InvalidOracleSig();
    error RiskTooHigh(uint16 scoreBps, uint16 thresholdBps);

    // ---------- events ----------
    event OracleSignerUpdated(address indexed signer);
    event RiskThresholdUpdated(uint16 thresholdBps);

    // ---------- modifiers ----------
    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    // ---------- admin ----------
    function setOracleSigner(address signer) external {
        LibDiamond.enforceIsOwner();
        LibRiskOracle.rs().oracleSigner = signer;
        emit OracleSignerUpdated(signer);
    }

    function setRiskThresholdBps(uint16 thresholdBps) external {
        LibDiamond.enforceIsOwner();
        LibRiskOracle.rs().thresholdBps = thresholdBps;
        emit RiskThresholdUpdated(thresholdBps);
    }

    function getOracleSigner() external view returns (address) {
        return LibRiskOracle.rs().oracleSigner;
    }

    function getRiskThresholdBps() external view returns (uint16) {
        return LibRiskOracle.rs().thresholdBps;
    }

    // ---------- core ----------
    function checkRisk(
        LibRiskOracle.RiskAttestation calldata att,
        bytes calldata oracleSig
    ) external view onlySelf returns (bool ok) {
        LibRiskOracle.RiskStorage storage s = LibRiskOracle.rs();
        if (s.oracleSigner == address(0)) revert OracleNotSet();

        if (att.deadline != 0 && block.timestamp > att.deadline) revert Expired();

        bytes32 msgHash = LibRiskOracle.attestationMessageHash(address(this), att);
        bytes32 digest = LibValidation.toEthSignedMessageHash(msgHash);

        address recovered = LibValidation.recoverSigner(digest, oracleSig);
        if (recovered != s.oracleSigner) revert InvalidOracleSig();

        if (att.riskScoreBps > s.thresholdBps) {
            revert RiskTooHigh(att.riskScoreBps, s.thresholdBps);
        }

        return true;
    }
}
