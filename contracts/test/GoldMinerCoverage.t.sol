// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GoldMinerLevelCatalog} from "../src/GoldMinerLevelCatalog.sol";
import {GoldMinerScoreboard} from "../src/GoldMinerScoreboard.sol";
import {ScriptBase} from "../src/foundry/Vm.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {RegisterLevels} from "../script/RegisterLevels.s.sol";

contract GoldMinerCoverageTest is ScriptBase {
    uint256 private constant PLAYER_ONE_PK = 0xA11CE;
    uint256 private constant PLAYER_TWO_PK = 0xB0B;
    uint256 private constant VERIFIER_PK = 0xC0FFEE;

    bytes32 private constant RANKED_ID = bytes32("diamond_rush_60");
    bytes32 private constant ADVENTURE_ID = bytes32("adventure_l10");
    bytes32 private constant RANKED_CONTENT_HASH = keccak256("diamond-rush-content");
    bytes32 private constant CAMPAIGN_CONTENT_HASH = keccak256("adventure-content");
    bytes32 private constant ALT_CONTENT_HASH = keccak256("diamond-rush-content-v2");
    bytes32 private constant RANKED_SEED = keccak256("diamond-rush-seed");
    bytes32 private constant CAMPAIGN_SEED = keccak256("adventure-seed");
    bytes32 private constant ALT_SEED = keccak256("diamond-rush-seed-v2");
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
    uint256 private constant MAX_HISTORY_PER_USER = 50;

    GoldMinerLevelCatalog private levelCatalog;
    GoldMinerScoreboard private scoreboard;

    address private verifier;
    address private playerOne;
    address private playerTwo;
    address private outsider;

    function setUp() public {
        verifier = vm.addr(VERIFIER_PK);
        playerOne = vm.addr(PLAYER_ONE_PK);
        playerTwo = vm.addr(PLAYER_TWO_PK);
        outsider = vm.addr(0xD00D);

        levelCatalog = new GoldMinerLevelCatalog();
        scoreboard = new GoldMinerScoreboard(address(levelCatalog), verifier, "local-goldminer-diamond-rush");

        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: RANKED_ID,
                version: 1,
                contentHash: RANKED_CONTENT_HASH,
                order: 2,
                enabled: true,
                challengeSeed: RANKED_SEED
            })
        );
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: ADVENTURE_ID,
                version: 1,
                contentHash: CAMPAIGN_CONTENT_HASH,
                order: 1,
                enabled: true,
                challengeSeed: CAMPAIGN_SEED
            })
        );
        scoreboard.setCurrentRankedChallenge(RANKED_ID, 1);
    }

    function testLevelCatalogRejectsUnauthorizedAndInvalidConfigs() public {
        GoldMinerLevelCatalog.LevelConfig memory validConfig = GoldMinerLevelCatalog.LevelConfig({
            levelId: bytes32("extra-ranked"),
            version: 1,
            contentHash: ALT_CONTENT_HASH,
            order: 3,
            enabled: true,
            challengeSeed: ALT_SEED
        });

        vm.prank(outsider);
        vm.expectRevert(GoldMinerLevelCatalog.Unauthorized.selector);
        levelCatalog.upsertLevel(validConfig);

        vm.expectRevert(GoldMinerLevelCatalog.InvalidLevelId.selector);
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: bytes32(0),
                version: 1,
                contentHash: ALT_CONTENT_HASH,
                order: 3,
                enabled: true,
                challengeSeed: ALT_SEED
            })
        );

        vm.expectRevert(GoldMinerLevelCatalog.InvalidLevelVersion.selector);
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: bytes32("bad-version"),
                version: 0,
                contentHash: ALT_CONTENT_HASH,
                order: 3,
                enabled: true,
                challengeSeed: ALT_SEED
            })
        );

        vm.expectRevert(GoldMinerLevelCatalog.InvalidContentHash.selector);
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: bytes32("bad-hash"),
                version: 1,
                contentHash: bytes32(0),
                order: 3,
                enabled: true,
                challengeSeed: ALT_SEED
            })
        );

        vm.expectRevert(GoldMinerLevelCatalog.InvalidOrder.selector);
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: bytes32("bad-order"),
                version: 1,
                contentHash: ALT_CONTENT_HASH,
                order: 0,
                enabled: true,
                challengeSeed: ALT_SEED
            })
        );

        vm.expectRevert(GoldMinerLevelCatalog.InvalidChallengeSeed.selector);
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: bytes32("bad-seed"),
                version: 1,
                contentHash: ALT_CONTENT_HASH,
                order: 3,
                enabled: true,
                challengeSeed: bytes32(0)
            })
        );
    }

    function testLevelCatalogTransfersOwnershipUpdatesAndSortsCatalog() public {
        levelCatalog.transferOwnership(outsider);

        vm.prank(outsider);
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: bytes32("late-ranked"),
                version: 1,
                contentHash: ALT_CONTENT_HASH,
                order: 5,
                enabled: true,
                challengeSeed: ALT_SEED
            })
        );

        vm.prank(outsider);
        levelCatalog.upsertLevel(
            GoldMinerLevelCatalog.LevelConfig({
                levelId: RANKED_ID,
                version: 1,
                contentHash: ALT_CONTENT_HASH,
                order: 4,
                enabled: false,
                challengeSeed: ALT_SEED
            })
        );

        GoldMinerLevelCatalog.LevelConfig memory updated = levelCatalog.getLevel(RANKED_ID, 1);
        require(updated.contentHash == ALT_CONTENT_HASH, "catalog should upsert in place");
        require(updated.order == 4, "catalog should keep updated order");
        require(!updated.enabled, "catalog should persist updated enabled flag");
        require(levelCatalog.levelExists(RANKED_ID, 1), "existing pointer should remain addressable");
        require(!levelCatalog.isLevelEnabled(RANKED_ID, 1), "disabled level should report false");

        vm.prank(outsider);
        levelCatalog.setLevelEnabled(RANKED_ID, 1, true);
        require(levelCatalog.isLevelEnabled(RANKED_ID, 1), "enabled flag should toggle back on");

        GoldMinerLevelCatalog.LevelConfig[] memory catalog = levelCatalog.getCatalog();
        require(catalog.length == 3, "catalog should not duplicate overwritten pointer");
        require(catalog[0].levelId == ADVENTURE_ID, "lowest order should sort first");
        require(catalog[1].levelId == RANKED_ID, "updated order should re-sort existing entry");
        require(catalog[2].levelId == bytes32("late-ranked"), "latest entry should sort last");
    }

    function testLevelCatalogRejectsInvalidOwnerAndMissingLevel() public {
        vm.expectRevert(GoldMinerLevelCatalog.InvalidOwner.selector);
        levelCatalog.transferOwnership(address(0));

        vm.expectRevert(GoldMinerLevelCatalog.LevelNotFound.selector);
        levelCatalog.getLevel(bytes32("missing"), 1);

        vm.expectRevert(GoldMinerLevelCatalog.LevelNotFound.selector);
        levelCatalog.setLevelEnabled(bytes32("missing"), 1, true);
    }

    function testScoreboardOwnerFunctionsRejectInvalidStates() public {
        vm.prank(outsider);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__Unauthorized.selector);
        scoreboard.transferOwnership(outsider);

        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__Unauthorized.selector);
        scoreboard.transferOwnership(address(0));

        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidVerifier.selector);
        scoreboard.updateVerifier(address(0));

        levelCatalog.setLevelEnabled(RANKED_ID, 1, false);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__VersionNotEnabled.selector);
        scoreboard.setCurrentRankedChallenge(RANKED_ID, 1);

        vm.expectRevert(GoldMinerLevelCatalog.LevelNotFound.selector);
        scoreboard.setCurrentRankedChallenge(bytes32("missing"), 1);
    }

    function testScoreboardConstructorRejectsInvalidInputs() public {
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidChallenge.selector);
        new GoldMinerScoreboard(address(0), verifier, "local-goldminer-diamond-rush");

        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidVerifier.selector);
        new GoldMinerScoreboard(address(levelCatalog), address(0), "local-goldminer-diamond-rush");

        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidDeploymentId.selector);
        new GoldMinerScoreboard(address(levelCatalog), verifier, "");
    }

    function testSubmitVerifiedBatchRejectsInvalidPermitEnvelope() public {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedRun[] memory runs,
            bytes32 batchId,
            bytes memory verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 100, 9, 29_000, 1, 2);

        GoldMinerScoreboard.SessionPermit memory badPermit = permit;
        badPermit.player = address(0);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPlayer.selector);
        scoreboard.submitVerifiedBatch(badPermit, playerPermitSig, runs, batchId, verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 101, 9, 29_000, 1, 2);
        badPermit = permit;
        badPermit.delegate = address(0);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidDelegate.selector);
        scoreboard.submitVerifiedBatch(badPermit, playerPermitSig, runs, batchId, verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 102, 9, 29_000, 1, 2);
        badPermit = permit;
        badPermit.deploymentIdHash = keccak256("wrong-deployment");
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidDeploymentId.selector);
        scoreboard.submitVerifiedBatch(badPermit, playerPermitSig, runs, batchId, verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 103, 9, 29_000, 1, 2);
        badPermit = permit;
        badPermit.issuedAt = uint64(block.timestamp + 1);
        badPermit.deadline = uint64(block.timestamp + 2 days);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPermitWindow.selector);
        scoreboard.submitVerifiedBatch(badPermit, playerPermitSig, runs, batchId, verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 104, 9, 29_000, 1, 2);
        badPermit = permit;
        badPermit.deadline = badPermit.issuedAt;
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPermitWindow.selector);
        scoreboard.submitVerifiedBatch(badPermit, playerPermitSig, runs, batchId, verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 105, 9, 29_000, 1, 2);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPermitWindow.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, verifierSig);
    }

    function testSubmitVerifiedBatchRejectsSignatureAndBatchFailures() public {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedRun[] memory runs,
            bytes32 batchId,
            bytes memory verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 110, 9, 29_000, 1, 2);

        GoldMinerScoreboard.SessionPermit memory zeroMaxPermit = permit;
        zeroMaxPermit.maxRuns = 0;
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__MaxRunsExceeded.selector);
        scoreboard.submitVerifiedBatch(zeroMaxPermit, playerPermitSig, runs, batchId, verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 111, 9, 29_000, 1, 2);
        GoldMinerScoreboard.VerifiedRun[] memory emptyRuns = new GoldMinerScoreboard.VerifiedRun[](0);
        bytes memory emptyRunsVerifierSig = _sign(VERIFIER_PK, _verifierBatchDigest(permit, emptyRuns, batchId));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__EmptyBatch.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, emptyRuns, batchId, emptyRunsVerifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 112, 9, 29_000, 1, 2);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidBatchId.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, bytes32(0), verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 113, 9, 29_000, 1, 2);
        bytes memory wrongPlayerSig = _sign(PLAYER_TWO_PK, _playerPermitDigest(permit));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPlayerSignature.selector);
        scoreboard.submitVerifiedBatch(permit, wrongPlayerSig, runs, batchId, verifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 114, 9, 29_000, 1, 2);
        bytes memory wrongVerifierSig = _sign(PLAYER_TWO_PK, _verifierBatchDigest(permit, runs, batchId));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidVerifierSignature.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, wrongVerifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 115, 9, 29_000, 1, 2);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, verifierSig);

        (
            GoldMinerScoreboard.SessionPermit memory anotherPermit,
            bytes memory anotherPlayerSig,
            GoldMinerScoreboard.VerifiedRun[] memory anotherRuns,
            ,
            bytes memory anotherVerifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 116, 10, 28_000, 1, 2);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__DuplicateBatchId.selector);
        scoreboard.submitVerifiedBatch(anotherPermit, anotherPlayerSig, anotherRuns, batchId, anotherVerifierSig);
    }

    function testSubmitVerifiedBatchRejectsRunAndSessionStateFailures() public {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedRun[] memory runs,
            bytes32 batchId,
            bytes memory verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 103, 11, 27_000, 1, 2);

        GoldMinerScoreboard.VerifiedRun[] memory invalidRunIdRuns = _copyRuns(runs);
        invalidRunIdRuns[0].runId = bytes32(0);
        bytes memory invalidRunIdVerifierSig =
            _sign(VERIFIER_PK, _verifierBatchDigest(permit, invalidRunIdRuns, batchId));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidRunId.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, invalidRunIdRuns, batchId, invalidRunIdVerifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 112, 11, 27_000, 1, 2);
        GoldMinerScoreboard.VerifiedRun[] memory missingVersionRuns = _copyRuns(runs);
        missingVersionRuns[0].challengeVersion = 2;
        bytes memory missingVersionVerifierSig =
            _sign(VERIFIER_PK, _verifierBatchDigest(permit, missingVersionRuns, batchId));
        vm.expectRevert(GoldMinerLevelCatalog.LevelNotFound.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, missingVersionRuns, batchId, missingVersionVerifierSig);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 113, 11, 27_000, 1, 2);
        levelCatalog.setLevelEnabled(RANKED_ID, 1, false);
        bytes memory disabledVersionVerifierSig = _sign(VERIFIER_PK, _verifierBatchDigest(permit, runs, batchId));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__VersionNotEnabled.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, disabledVersionVerifierSig);
        levelCatalog.setLevelEnabled(RANKED_ID, 1, true);

        (
            permit,
            playerPermitSig,
            runs,
            batchId,
            verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 114, 11, 27_000, 1, 2);
        _setSessionUsageRevoked(permit.player, permit.nonce);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__SessionRevoked.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, verifierSig);
    }

    function testSubmitVerifiedBatchRejectsExceededRunQuota() public {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedRun[] memory runs,
            bytes32 batchId,
            bytes memory verifierSig
        ) = _buildRunBatch(playerOne, PLAYER_ONE_PK, 115, 9, 26_000, 1, 2);

        _setSessionSubmittedRuns(permit.player, permit.nonce, 2);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__MaxRunsExceeded.selector);
        scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, verifierSig);
    }

    function testSubmitVerifiedCampaignRejectsInvalidStatesAndSignatures() public {
        (
            GoldMinerScoreboard.SessionPermit memory permit,
            bytes memory playerPermitSig,
            GoldMinerScoreboard.VerifiedCampaign memory campaign,
            bytes memory verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 201, 6, false, 7_000, 25_000, 1);

        GoldMinerScoreboard.SessionPermit memory badPermit = permit;
        badPermit.player = address(0);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPlayer.selector);
        scoreboard.submitVerifiedCampaign(badPermit, playerPermitSig, campaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 202, 6, false, 7_000, 25_000, 1);
        badPermit = permit;
        badPermit.delegate = outsider;
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidDelegate.selector);
        scoreboard.submitVerifiedCampaign(badPermit, playerPermitSig, campaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 203, 6, false, 7_000, 25_000, 1);
        badPermit = permit;
        badPermit.deploymentIdHash = keccak256("wrong");
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidDeploymentId.selector);
        scoreboard.submitVerifiedCampaign(badPermit, playerPermitSig, campaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 204, 6, false, 7_000, 25_000, 1);
        badPermit = permit;
        badPermit.issuedAt = uint64(block.timestamp + 1);
        badPermit.deadline = uint64(block.timestamp + 2 days);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPermitWindow.selector);
        scoreboard.submitVerifiedCampaign(badPermit, playerPermitSig, campaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 205, 6, false, 7_000, 25_000, 1);
        GoldMinerScoreboard.VerifiedCampaign memory badCampaign = campaign;
        badCampaign.campaignId = bytes32(0);
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidCampaign.selector);
        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, badCampaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 206, 6, false, 7_000, 25_000, 1);
        badCampaign = campaign;
        badCampaign.reachedLevel = 0;
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidCampaign.selector);
        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, badCampaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 207, 6, false, 7_000, 25_000, 1);
        badCampaign = campaign;
        badCampaign.reachedLevel = 11;
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidCampaign.selector);
        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, badCampaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 208, 6, false, 7_000, 25_000, 1);
        bytes memory wrongPlayerSig = _sign(PLAYER_TWO_PK, _playerPermitDigest(permit));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidPlayerSignature.selector);
        scoreboard.submitVerifiedCampaign(permit, wrongPlayerSig, campaign, verifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 209, 6, false, 7_000, 25_000, 1);
        bytes memory wrongVerifierSig = _sign(PLAYER_TWO_PK, _verifierCampaignDigest(permit, campaign));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__InvalidVerifierSignature.selector);
        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, campaign, wrongVerifierSig);

        (
            permit,
            playerPermitSig,
            campaign,
            verifierSig
        ) = _buildCampaign(playerOne, PLAYER_ONE_PK, 210, 6, false, 7_000, 25_000, 1);
        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, campaign, verifierSig);
        bytes memory secondVerifierSig = _sign(VERIFIER_PK, _verifierCampaignDigest(permit, campaign));
        vm.expectRevert(GoldMinerScoreboard.GoldMinerScoreboard__DuplicateCampaignId.selector);
        scoreboard.submitVerifiedCampaign(permit, playerPermitSig, campaign, secondVerifierSig);
    }

    function testScoreboardMaintainsHistoryRingBufferAndCapacityLimits() public {
        for (uint32 index = 0; index < MAX_HISTORY_PER_USER + 5; index += 1) {
            (
                GoldMinerScoreboard.SessionPermit memory permit,
                bytes memory playerPermitSig,
                GoldMinerScoreboard.VerifiedRun[] memory runs,
                bytes32 batchId,
                bytes memory verifierSig
            ) = _buildRunBatch(
                playerOne,
                PLAYER_ONE_PK,
                300 + index,
                uint32(10 + (index % 5)),
                uint32(20_000 + index),
                1,
                1
            );

            scoreboard.submitVerifiedBatch(permit, playerPermitSig, runs, batchId, verifierSig);
            vm.warp(block.timestamp + 1);
        }

        GoldMinerScoreboard.RankedRunResult[] memory history = scoreboard.getPlayerHistory(playerOne);
        require(history.length == MAX_HISTORY_PER_USER, "history should cap at ring buffer size");
        require(history[0].lastDiamondAtMs == 20_005, "oldest retained history should rotate forward");
        require(history[history.length - 1].lastDiamondAtMs == 20_054, "latest history should stay last");

        GoldMinerScoreboard.LeaderboardEntry[] memory board = scoreboard.getLeaderboard(RANKED_ID, 1);
        require(board.length == 20, "leaderboard should cap at max size");
        require(board[0].result.diamondsCaught == 14, "best diamond score should rank first");
        require(board[board.length - 1].result.diamondsCaught >= 13, "tail should still keep top entries");
    }

    function testCampaignLeaderboardUsesCompletionScoreTimeAndPurchaseTiebreakers() public {
        _submitCampaign(playerOne, PLAYER_ONE_PK, 401, 8, false, 7_000, 30_000, 2);
        vm.warp(block.timestamp + 1);
        _submitCampaign(playerTwo, PLAYER_TWO_PK, 402, 8, true, 6_000, 31_000, 3);
        vm.warp(block.timestamp + 1);
        _submitCampaign(outsider, 0xD00D, 403, 8, true, 7_500, 29_000, 4);

        GoldMinerScoreboard.CampaignLeaderboardEntry[] memory board = scoreboard.getCampaignLeaderboard();
        require(board.length == 3, "campaign board length mismatch");
        require(board[0].player == outsider, "higher score should win among completed runs");
        require(board[1].player == playerTwo, "completed should outrank incomplete at same reached level");
        require(board[2].player == playerOne, "incomplete run should rank last");
    }

    function testCampaignLeaderboardDropsTailBeyondCapacity() public {
        for (uint8 index = 0; index < 22; index += 1) {
            _submitCampaign(vm.addr(uint256(5000 + index)), uint256(5000 + index), 500 + index, 5, false, 1_000 + index, 40_000 + index, index);
            vm.warp(block.timestamp + 1);
        }

        GoldMinerScoreboard.CampaignLeaderboardEntry[] memory board = scoreboard.getCampaignLeaderboard();
        require(board.length == 20, "campaign board should cap at max size");
        require(board[0].result.finalScore == 1_021, "highest score should stay first");
        require(board[19].result.finalScore == 1_002, "lowest retained score should be tail after trimming");
    }

    function testDeployScriptRunCreatesDeploymentArtifacts() public {
        Deploy deployScript = new Deploy();
        deployScript.run("local-goldminer-diamond-rush");
    }

    function testRegisterLevelsScriptRunLoadsJsonAndSetsCurrentRankedChallenge() public {
        GoldMinerLevelCatalog catalog = new GoldMinerLevelCatalog();
        GoldMinerScoreboard board = new GoldMinerScoreboard(address(catalog), verifier, "local-goldminer-diamond-rush");

        RegisterLevels registerLevels = new RegisterLevels();
        RegisterLevels.LevelRegistration[] memory levels = registerLevels.loadLevelsFromConfig();
        require(levels.length == 11, "config loader should discover all levels");
        require(keccak256(bytes(levels[0].boardKind)) == keccak256(bytes("campaign")), "first config kind mismatch");
        require(levels[0].levelId == bytes32("L1"), "first config level id mismatch");
        require(levels[10].levelId == bytes32("diamond_rush_60"), "ranked config should load");
        require(levels[10].isCurrent, "ranked config should mark current challenge");

        catalog.transferOwnership(tx.origin);
        board.transferOwnership(tx.origin);

        registerLevels.run(address(catalog), address(board));

        require(board.currentRankedChallengeId() == bytes32("diamond_rush_60"), "ranked pointer should follow json");
        require(board.currentRankedChallengeVersion() == 1, "ranked pointer version should follow json");

        GoldMinerLevelCatalog.LevelConfig[] memory catalogEntries = catalog.getCatalog();
        require(catalogEntries.length == 11, "script should register all json levels");
        require(catalogEntries[0].levelId == bytes32("L1"), "campaign entries should sort by order");
        GoldMinerLevelCatalog.LevelConfig memory rankedEntry = catalog.getLevel(bytes32("diamond_rush_60"), 1);
        require(rankedEntry.levelId == bytes32("diamond_rush_60"), "ranked entry should remain addressable");
        require(rankedEntry.enabled, "ranked entry should stay enabled");
    }

    function testRegisterLevelsApplyRegistrationsWithoutBroadcastWorksWhenScriptOwnsTargets() public {
        GoldMinerLevelCatalog catalog = new GoldMinerLevelCatalog();
        GoldMinerScoreboard board = new GoldMinerScoreboard(address(catalog), verifier, "local-goldminer-diamond-rush");
        RegisterLevels registerLevels = new RegisterLevels();
        RegisterLevels.LevelRegistration[] memory levels = registerLevels.loadLevelsFromConfig();

        catalog.transferOwnership(address(registerLevels));
        board.transferOwnership(address(registerLevels));

        registerLevels.applyRegistrationsWithoutBroadcast(levels, address(catalog), address(board));

        require(board.currentRankedChallengeId() == bytes32("diamond_rush_60"), "script owner path should set ranked pointer");
        require(catalog.getCatalog().length == 11, "script owner path should register all levels");
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

    function _buildRunBatch(
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

    function _copyRuns(GoldMinerScoreboard.VerifiedRun[] memory runs)
        private
        pure
        returns (GoldMinerScoreboard.VerifiedRun[] memory copiedRuns)
    {
        copiedRuns = new GoldMinerScoreboard.VerifiedRun[](runs.length);
        for (uint256 index = 0; index < runs.length; index += 1) {
            copiedRuns[index] = runs[index];
        }
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
        bytes32 structHash = keccak256(
            abi.encode(
                VERIFIED_BATCH_TYPEHASH,
                permit.player,
                permit.delegate,
                permit.sessionId,
                permit.nonce,
                batchId,
                runsHash
            )
        );
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

    function _setSessionSubmittedRuns(address player, uint32 nonce, uint16 submittedRuns) private {
        bytes32 outer = keccak256(abi.encode(player, uint256(7)));
        bytes32 slot = keccak256(abi.encode(uint256(nonce), outer));
        vm.store(address(scoreboard), slot, bytes32(uint256(submittedRuns)));
    }

    function _setSessionUsageRevoked(address player, uint32 nonce) private {
        bytes32 outer = keccak256(abi.encode(player, uint256(7)));
        bytes32 slot = keccak256(abi.encode(uint256(nonce), outer));
        vm.store(address(scoreboard), slot, bytes32((uint256(1) << 16)));
    }
}
