// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ScriptBase} from "../src/foundry/Vm.sol";
import {GoldMinerLevelCatalog} from "../src/GoldMinerLevelCatalog.sol";
import {GoldMinerScoreboard} from "../src/GoldMinerScoreboard.sol";

contract Deploy is ScriptBase {
    function run(string memory deploymentId) external {
        vm.startBroadcast();

        GoldMinerLevelCatalog levelCatalog = new GoldMinerLevelCatalog();
        GoldMinerScoreboard scoreboard = new GoldMinerScoreboard(address(levelCatalog), msg.sender, deploymentId);

        vm.stopBroadcast();

        string memory objectKey = "goldMinerDeployment";
        vm.serializeString(objectKey, "deploymentId", deploymentId);
        vm.serializeAddress(objectKey, "goldMinerLevelCatalog", address(levelCatalog));
        string memory finalJson = vm.serializeAddress(objectKey, "goldMinerScoreboard", address(scoreboard));
        vm.writeJson(finalJson, string.concat(vm.projectRoot(), "/out/deployment.json"));
    }
}
