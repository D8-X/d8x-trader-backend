import { PerpetualDataHandler } from "@d8x/perpetuals-sdk";

import { ethers } from "ethers";

export const getSDKConfigFromEnv = () => {
	const configName = (process.env.SDK_CONFIG_NAME as string) ?? "";
	if (configName == "") {
		throw Error("SDK_CONFIG_NAME missing in .env");
	}
	let config = PerpetualDataHandler.readSDKConfig(configName);
	return config;
};

export function getPerpetualManagerABI(): ethers.InterfaceAbi {
	let abi = getSDKConfigFromEnv().proxyABI as string;
	return abi as ethers.InterfaceAbi;
}

export function getPerpetualManagerProxyAddress(): string {
	return getSDKConfigFromEnv().proxyAddr;
}

export function getDefaultRPC(): string {
	return getSDKConfigFromEnv().nodeURL;
}

export const getShareTokenContractABI = async () => {
	return getSDKConfigFromEnv().shareTokenABI as ethers.InterfaceAbi;
};
