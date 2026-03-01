// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library LibRiskOracle {
    // -------- storage --------
    bytes32 internal constant RISK_STORAGE_SLOT =
        keccak256("aiwallet.riskoracle.storage.v1");

    struct RiskStorage {
        address oracleSigner;
        uint16 thresholdBps; // 0..10000 (score > threshold => reject)
    }

    // Keep attestation minimal for MVP and stable for later XGBoost integration
    struct RiskAttestation {
        bytes32 userOpHash;
        uint16 riskScoreBps; // 0..10000
        uint48 deadline;     // unix timestamp (0 allowed but not recommended)
    }

    function rs() internal pure returns (RiskStorage storage s) {
        bytes32 slot = RISK_STORAGE_SLOT;
        assembly {
            s.slot := slot
        }
    }

    /// @notice Off-chain oracle should sign this message (EIP-191 eth_sign / personal_sign)
    function attestationMessageHash(
        address wallet,
        RiskAttestation calldata att
    ) internal view returns (bytes32) {
        // keccak256(abi.encodePacked(
        //   "RISK_ATTEST_V1",
        //   chainid (uint256, 32 bytes),
        //   wallet address (20 bytes),
        //   userOpHash (32 bytes),
        //   riskScoreBps (2 bytes),
        //   deadline (6 bytes)
        // ))
        return keccak256(
            abi.encodePacked(
                "RISK_ATTEST_V1",
                block.chainid,
                wallet,
                att.userOpHash,
                att.riskScoreBps,
                att.deadline
            )
        );
    }
}
