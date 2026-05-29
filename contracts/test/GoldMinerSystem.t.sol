// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GoldMinerLevelCatalog} from "../src/GoldMinerLevelCatalog.sol";
import {GoldMinerScoreboard} from "../src/GoldMinerScoreboard.sol";
import {ScriptBase} from "../src/foundry/Vm.sol";

contract GoldMinerSystemTest is ScriptBase {
    uint256 private constant PLAYER_ONE_PK = 0xA11CE;
    uint256 private constant PLAYER_TWO_PK = 0xB0B;
    uint256 private constant VERIFIER_PK = 0xC0FFEE;

    bytes32 private constant RANKED_ID = bytes32("diamond_rush_60");
    bytes32 private constant ADVENTURE_ID = bytes32("adventure_l10");
    bytes32 private constant RANKED_CONTENT_HASH = keccak256("diamond-rush-content");
    bytes32 private constant CAMPAIGN_CONTENT_HASH = keccak256("adventure-content");
    bytes32 private constant RANKED_SEED = keccak256("diamond-rush-seed");
    bytes32 private constant CAMPAIGN_SEED = keccak256("adventure-seed");
    bytes32 private constant DEPLOYMENT_ID_HASH = keccak256("local-goldminer-diamond-rush");

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SESSION_PERMIT_TYPEHASH = keccak256(
        "SessionPermit(address player,address delegate,bytes32 sessionId,bytes32 deploymentIdHash,uint64 issuedAt,uint64 deadline,uint32 nonce,uint16 maxRuns)"
    );
    bytes32 private constant VERIFIED_RUN_TYPEHASH = keccak256(
        "VerifiedRun(bytes32 runId,bytes32 challengeId,uint32 challengeVersion,uint32 diamondsCaught,uint32 lastDiamondAtMs,bytes32 evidenceHash)"
    );
    bytes32 private constant VERIFIED_BATCH_TYPEHASH = keccak256(
        "VerifierBatch(address player,address delegate,bytes32 sessionId,uint32 nonce,bytes32 batchId,bytes32 runsHash)"
    );
    bytes32 private constant VERIFIED_CAMPAIGN_TYPEHASH = keccak256(
        "VerifiedCampaign(bytes32 campaignId,uint8 reachedLevel,bool completed,uint32 finalScore,uint32 totalDurationMs,uint16 purchasedItemCount,bytes32 evidenceHash)"
    );
    bytes32 private constant VERIFIER_CAMPAIGN_TYPEHASH = keccak256(
        "VerifierCampaign(address player,address delegate,bytes32 sessionId,uint32 nonce,bytes32 campaignHash)"
    );
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant SESSION_PERMIT_NAME_HASH = keccak256("GoldMinerSessionPermit");
    bytes32 private constant VERIFIED_BATCH_NAME_HASH = keccak256("GoldMinerVerifiedBatch");
    bytes32 private constant VERIFIED_CAMPAIGN_NAME_HASH = keccak256("GoldMinerVerifiedCampaign");

    GoldMinerLevelCatalog private levelCatalog;
    GoldMinerScoreboard private scoreboard;

    address private verifier;
    address private playerOne;
    address private playerTwo;

    function setUp() public {
        verifier = vm.addr(VERIFIER_PK);
        playerOne = vm.addr(PLAYER_ONE_PK);
        playerTwo = vm.addr(PLAYER_TWO_PK);

        levelCatalog = new GoldMinerLevelCatalog();
        scoreboard = new GoldMinerScoreboard(address(levelCatalog), verifier, "local-goldminer-diamond-rush");

        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: RANKED_ID,
                version: 1,
                contentHash: RANKED_CONTENT_HASH,
                order: 1,
                enabled: true,
                challengeSeed: RANKED_SEED
            })
        );
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: ADVENTURE_ID,
                version: 1,
                contentHash: CAMPAIGN_CONTENT_HASH,
                order: 2,
                enabled: true,
                challengeSeed: CAMPAIGN_SEED
            })
        );
        scoreboard.setCurrentRankedChallenge(RANKED_ID, 1);
    }

    function testSubmitVerifiedBatchOrdersLeaderboardByDiamondsThenTime() public {
        _submitSingleRun(playerOne, PLAYER_ONE_PK, 11, 8, 34_000, 1, 2);
        vm.warp(block.timestamp + 1);
        _submitSingleRun(playerTwo, PLAYER_TWO_PK, 22, 8, 31_000, 1, 2);

        GoldMinerScoreboard.LeaderboardEntry[] memory board = scoreboard.getLeaderboard(RANKED_ID, 1);
        require(board.length == 2, "leaderboard length mismatch");
        require(board[0].player == playerTwo, "earlier completion should rank first");
        require(board[1].player == playerOne, "later completion should rank second");
    }

    function testSubmitVerifiedBatchRejectsDuplicateRunId() public {
        GoldMinerScoreboard.SessionPermit memory permit;
        bytes memory playerPermitSig;
        GoldMinerScoreboard.VerifiedRun[] memory runs;
        bytes32 batchId;
        bytes memory verifierSig;

        (permit, playerPermitSig, runs, batchId, verifierSig) =
            _buildSingleRunBatch(playerOne, PLAYER_ONE_PK, 33, 7, 28_000, 1, 2);

        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, verifierSig);

        bytes32 secondBatchId = keccak256("duplicate-run-batch");
        bytes memory secondVerifierSig = _sign(VERIFIER_PK, _verifierBatchDigest(permit, runs, secondBatchId));

        try scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, secondBatchId, secondVerifierSig) {
            revert("expected duplicate run revert");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == GoldMinerScoreboard.GoldMinerScoreboard__DuplicateRunId.selector,
                "unexpected revert selector"
            );
        }
    }

    function testSubmitVerifiedCampaignOrdersByReachedLevelFirst() public {
        _submitCampaign(playerOne, PLAYER_ONE_PK, 41, 6, false, 6_000, 18_000, 1);
        vm.warp(block.timestamp + 1);
        _submitCampaign(playerTwo, PLAYER_TWO_PK, 42, 8, false, 4_000, 28_000, 0);

        GoldMinerScoreboard.CampaignLeaderboardEntry[] memory board = scoreboard.getCampaignLeaderboard();
        require(board.length == 2, "campaign leaderboard length mismatch");
        require(board[0].player == playerTwo, "higher reached level should rank first");
        require(board[1].player == playerOne, "lower reached level should rank second");
    }

    function testSubmitVerifiedCampaignRejectsDuplicateCampaignId() public {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedCampaign memory campaign,
            bytes memory verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 51, 10, true, 7_400, 32_000, 3);

        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, campaign, verifierSig);

        bytes memory secondVerifierSig = _sign(VERIFIER_PK, _verifierCampaignDigest(permit, campaign));

        try scoreboard.submitVerifiedCampaign(permit, playerPermitSig, campaign, secondVerifierSig) {
            revert("expected duplicate campaign revert");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == GoldMinerScoreboard.GoldMinerScoreboard__DuplicateCampaignId.selector,
                "unexpected revert selector"
            );
        }
    }

    function _submitSingleRun(
        address player,
        uint256 playerKey,
        uint32 nonce,
        uint32 diamondsCaught,
        uint32 lastDiamondAtMs,
        uint64 submittedOffset,
        uint16 maxRuns
    ) private {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedRun[] memory runs,
            bytes32 batchId,
            bytes memory verifierSig
        ) = _buildSingleRunBatch(player, playerKey, nonce, diamondsCaught, lastDiamondAtMs, submittedOffset, maxRuns);

        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, verifierSig);
    }

    function _submitCampaign(
        address player,
        uint256 playerKey,
        uint32 nonce,
        uint8 reachedLevel,
        bool completed,
        uint32 finalScore,
        uint32 totalDurationMs,
        uint16 purchasedItemCount
    ) private {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedCampaign memory campaign,
            bytes memory verifierSig
        ) = _buildCampaign(
            player,
            playerKey,
            nonce,
            reachedLevel,
            completed,
            finalScore,
            totalDurationMs,
            purchasedItemCount
        );

        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, campaign, verifierSig);
    }

    function _buildCampaign(
        address player,
        uint256 playerKey,
        uint32 nonce,
        uint8 reachedLevel,
        bool completed,
        uint32 finalScore,
        uint32 totalDurationMs,
        uint16 purchasedItemCount
    )
        private
        returns (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedCampaign memory campaign,
            bytes memory verifierSig
        )
    {
        uint64 issuedAt = uint64(block.timestamp);
        if (issuedAt > 0) {
            issuedAt -= 1;
        }

        bytes32 sessionId = keccak256(abi.encode(player, nonce, block.timestamp, "campaign"));
        permit = GoldMinerScoreboard.SessionPermit({
            player: player,
            delegate: address(this),
            sessionId: sessionId,
            deploymentIdHash: DEPLOYMENT_ID_HASH,
            issuedAt: issuedAt,
            deadline: uint64(block.timestamp + 1 days),
            nonce: nonce,
            maxRuns: 1
        });
        campaign = GoldMinerScoreboard.VerifiedCampaign({
            campaignId: sessionId,
            reachedLevel: reachedLevel,
            completed: completed,
            finalScore: finalScore,
            totalDurationMs: totalDurationMs,
            purchasedItemCount: purchasedItemCount,
            evidenceHash: keccak256(abi.encode(player, nonce, "campaign-evidence"))
        });
        playerPermitSig = _sign(playerKey, _playerPermitDigest(permit));
        verifierSig = _sign(VERIFIER_PK, _verifierCampaignDigest(permit, campaign));
    }

    function _buildSingleRunBatch(
        address player,
        uint256 playerKey,
        uint32 nonce,
        uint32 diamondsCaught,
        uint32 lastDiamondAtMs,
        uint64 submittedOffset,
        uint16 maxRuns
    )
        private
        returns (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedRun[] memory runs,
            bytes32 batchId,
            bytes memory verifierSig
        )
    {
        uint64 issuedAt = uint64(block.timestamp + submittedOffset);
        if (issuedAt > 0) {
            issuedAt -= 1;
        }

        permit = GoldMinerScoreboard.SessionPermit({
            player: player,
            delegate: address(this),
            sessionId: keccak256(abi.encode(player, nonce, block.timestamp, "session")),
            deploymentIdHash: DEPLOYMENT_ID_HASH,
            issuedAt: issuedAt,
            deadline: uint64(block.timestamp + 1 days),
            nonce: nonce,
            maxRuns: maxRuns
        });

        runs = new GoldMinerScoreboard.VerifiedRun[](1);
        runs[0] = GoldMinerScoreboard.VerifiedRun({
            runId: keccak256(abi.encode(player, nonce, diamondsCaught, lastDiamondAtMs)),
            challengeId: RANKED_ID,
            challengeVersion: 1,
            diamondsCaught: diamondsCaught,
            lastDiamondAtMs: lastDiamondAtMs,
            evidenceHash: keccak256(abi.encode(player, nonce, "evidence"))
        });

        batchId = keccak256(abi.encode(player, nonce, "batch"));
        playerPermitSig = _sign(playerKey, _playerPermitDigest(permit));
        verifierSig = _sign(VERIFIER_PK, _verifierBatchDigest(permit, runs, batchId));
    }

    function _playerPermitDigest(GoldMinerScoreboard.SessionPermit memory permit) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SESSION_PERMIT_TYPEHASH,
                permit.player,
                permit.delegate,
                permit.sessionId,
                permit.deploymentIdHash,
                permit.issuedAt,
                permit.deadline,
                permit.nonce,
                permit.maxRuns
            )
        );
        return _toTypedDataHash(structHash, SESSION_PERMIT_NAME_HASH);
    }

    function _verifierBatchDigest(
        GoldMinerScoreboard.SessionPermit memory permit,
        GoldMinerScoreboard.VerifiedRun[] memory runs,
        bytes32 batchId
    ) private view returns (bytes32) {
        bytes32[] memory structHashes = new bytes32[](runs.length);
        for (uint256 index = 0; index < runs.length; index += 1) {
            GoldMinerScoreboard.VerifiedRun memory run = runs[index];
            structHashes[index] = keccak256(
                abi.encode(
                    VERIFIED_RUN_TYPEHASH,
                    run.runId,
                    run.challengeId,
                    run.challengeVersion,
                    run.diamondsCaught,
                    run.lastDiamondAtMs,
                    run.evidenceHash
                )
            );
        }

        bytes32 runsHash = keccak256(abi.encodePacked(structHashes));
        bytes32 structHash =
            keccak256(abi.encode(VERIFIED_BATCH_TYPEHASH, permit.player, permit.delegate, permit.sessionId, permit.nonce, batchId, runsHash));
        return _toTypedDataHash(structHash, VERIFIED_BATCH_NAME_HASH);
    }

    function _verifierCampaignDigest(
        GoldMinerScoreboard.SessionPermit memory permit,
        GoldMinerScoreboard.VerifiedCampaign memory campaign
    ) private view returns (bytes32) {
        bytes32 campaignHash = keccak256(
            abi.encode(
                VERIFIED_CAMPAIGN_TYPEHASH,
                campaign.campaignId,
                campaign.reachedLevel,
                campaign.completed,
                campaign.finalScore,
                campaign.totalDurationMs,
                campaign.purchasedItemCount,
                campaign.evidenceHash
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                VERIFIER_CAMPAIGN_TYPEHASH,
                permit.player,
                permit.delegate,
                permit.sessionId,
                permit.nonce,
                campaignHash
            )
        );
        return _toTypedDataHash(structHash, VERIFIED_CAMPAIGN_NAME_HASH);
    }

    function _toTypedDataHash(bytes32 structHash, bytes32 nameHash) private view returns (bytes32) {
        bytes32 domainSeparator =
            keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, nameHash, VERSION_HASH, block.chainid, address(scoreboard)));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _selector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) {
            return bytes4(0);
        }

        assembly {
            selector := mload(add(reason, 32))
        }
    }
}
