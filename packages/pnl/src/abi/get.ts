import testnetABI from "@d8x/perpetuals-sdk/dist/esm/abi/testnet/IPerpetualManager.json";
import centralParkABI from "@d8x/perpetuals-sdk/dist/esm/abi/central-park/IPerpetualManager.json";
import zkTestnetABI from "@d8x/perpetuals-sdk/dist/esm/abi/zkevmTestnet/IPerpetualManager.json";
import { ABI_OPTION } from "../types";

// Retrieve the ABI json from d8x sdk based on. Defaults to testnetABI if
// ABI_OPTION is not provided
export const getPerpetualManagerABI = () => {
	const network = (process.env.ABI_OPTION as ABI_OPTION) ?? "";
	switch (network) {
		case "central-park":
			return centralParkABI;
		case "testnet":
			return testnetABI;
		case "zk-testnet":
			return zkTestnetABI;
		default:
			return testnetABI;
	}
};
