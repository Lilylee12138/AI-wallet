// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library LibDao {
    bytes32 internal constant DAO_STORAGE_POSITION =
        keccak256("diamond.standard.dao.storage.v1");

    enum ProposalState {
        Pending,     // 0
        Active,      // 1
        Succeeded,   // 2
        Defeated,    // 3
        Executed     // 4
    }

    struct Proposal {
        address proposer;
        uint64 startTime;
        uint64 endTime;

        // demo-friendly on-chain text
        string description;

        // optional executable action
        address target;
        uint256 value;
        bytes data;

        // AI/UI hooks
        bytes32 metaHash;
        string metaURI;

        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;

        bool executed;
        bool finalized;
    }

    struct DaoStorage {
        uint256 proposalCount;

        mapping(uint256 => Proposal) proposals;

        // proposalId => memberId => support (0 none, 1 for, 2 against, 3 abstain)
        mapping(uint256 => mapping(bytes32 => uint8)) receipt;

        // Phase 5: membership allowlist
        mapping(bytes32 => bool) isMember;
    }

    function daoStorage() internal pure returns (DaoStorage storage ds) {
        bytes32 position = DAO_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }
}
