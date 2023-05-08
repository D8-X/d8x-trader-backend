import { PerpetualDataHandler } from "@d8x/perpetuals-sdk";
import { ethers } from "ethers";

export const getSDKFromEnv = () => {
	const configName = (process.env.SDK_CONFIG_NAME as string) ?? "";
	if (configName == "") {
		throw Error("SDK_CONFIG_NAME missing in .env");
	}
	return PerpetualDataHandler.readSDKConfig(configName);
};

export function getPerpetualManagerABI(): ethers.InterfaceAbi {
	let abi = getSDKFromEnv().proxyABI as string;
	return abi as ethers.InterfaceAbi;
}

export function getPerpetualManagerProxyAddress(): string {
	return getSDKFromEnv().proxyAddr;
}

export function getDefaultRPC(): string {
	return getSDKFromEnv().nodeURL;
}
