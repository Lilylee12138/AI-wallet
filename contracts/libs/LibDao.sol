// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice LibDao
/// @dev Diamond storage + helpers for DAO governance (Phase 5)
library LibDao {
    // =============================================================
    // Storage
    // =============================================================

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

        // AI / UI hooks
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

    function ds() internal pure returns (DaoStorage storage s) {
        bytes32 position = DAO_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    // =============================================================
    // Membership helpers
    // =============================================================

    function isMember(bytes32 memberId) internal view returns (bool) {
        return ds().isMember[memberId];
    }

    function addMember(bytes32 memberId) internal {
        ds().isMember[memberId] = true;
    }

    // =============================================================
    // Proposal helpers
    // =============================================================

    function createProposal(
        address proposer,
        string memory description,
        address target,
        uint256 value,
        bytes memory data,
        uint64 votingPeriod,
        bytes32 metaHash,
        string memory metaURI
    ) internal returns (uint256 proposalId) {
        DaoStorage storage s = ds();

        proposalId = ++s.proposalCount;

        Proposal storage p = s.proposals[proposalId];
        p.proposer = proposer;
        p.startTime = uint64(block.timestamp);
        p.endTime = uint64(block.timestamp + votingPeriod);
        p.description = description;
        p.target = target;
        p.value = value;
        p.data = data;
        p.metaHash = metaHash;
        p.metaURI = metaURI;
    }

    function getProposal(uint256 proposalId)
        internal
        view
        returns (Proposal storage)
    {
        return ds().proposals[proposalId];
    }

    // =============================================================
    // Voting helpers
    // =============================================================

    /// @dev support: 1 = for, 2 = against, 3 = abstain
    function hasVoted(uint256 proposalId, bytes32 memberId)
        internal
        view
        returns (bool)
    {
        return ds().receipt[proposalId][memberId] != 0;
    }

    function castVote(
        uint256 proposalId,
        bytes32 memberId,
        uint8 support
    ) internal {
        DaoStorage storage s = ds();
        Proposal storage p = s.proposals[proposalId];

        // record receipt
        s.receipt[proposalId][memberId] = support;

        if (support == 1) {
            p.forVotes += 1;
        } else if (support == 2) {
            p.againstVotes += 1;
        } else if (support == 3) {
            p.abstainVotes += 1;
        }
    }

    // =============================================================
    // State machine
    // =============================================================

    function state(uint256 proposalId)
        internal
        view
        returns (ProposalState)
    {
        Proposal storage p = ds().proposals[proposalId];

        if (p.executed) {
            return ProposalState.Executed;
        }

        if (block.timestamp < p.startTime) {
            return ProposalState.Pending;
        }

        if (block.timestamp <= p.endTime) {
            return ProposalState.Active;
        }

        // voting ended
        if (p.finalized) {
            if (p.forVotes > p.againstVotes) {
                return ProposalState.Succeeded;
            } else {
                return ProposalState.Defeated;
            }
        }

        // not finalized yet, but voting window passed
        if (p.forVotes > p.againstVotes) {
            return ProposalState.Succeeded;
        } else {
            return ProposalState.Defeated;
        }
    }

    function finalize(uint256 proposalId) internal {
        Proposal storage p = ds().proposals[proposalId];
        p.finalized = true;
    }

    function markExecuted(uint256 proposalId) internal {
        Proposal storage p = ds().proposals[proposalId];
        p.executed = true;
    }

}
