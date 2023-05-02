import { PerpetualDataHandler } from "@d8x/perpetuals-sdk";
import { ethers } from "ethers";

export function getPerpetualManagerABI(): ethers.InterfaceAbi {
	const configName = (process.env.SDK_CONFIG_NAME as string) ?? "";
	if (configName == "") {
		Error("SDK_CONFIG_NAME missing in .env");
	}
	let abi = PerpetualDataHandler.readSDKConfig(configName).proxyABI as string;
	return abi as ethers.InterfaceAbi;
}

export function getPerpetualManagerProxyAddress(): string {
	const configName = (process.env.SDK_CONFIG_NAME as string) ?? "";
	if (configName == "") {
		Error("SDK_CONFIG_NAME missing in .env");
	}
	return PerpetualDataHandler.readSDKConfig(configName).proxyAddr;
}

export function getDefaultRPC(): string {
	const configName = (process.env.SDK_CONFIG_NAME as string) ?? "";
	if (configName == "") {
		Error("SDK_CONFIG_NAME missing in .env");
	}
	return PerpetualDataHandler.readSDKConfig(configName).nodeURL;
}
