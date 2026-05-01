// Quick console test for getCloseDeploymentBlock logic.
// Usage: npx tsx packages/history/src/svc/deploymentBlock.test.ts [RPC_URL]
//
// Default RPC is the public Base mainnet endpoint.
// Example:
//   npx tsx packages/history/src/svc/deploymentBlock.test.ts https://mainnet.base.org

import { JsonRpcProvider } from "ethers";
import {
	isNoHistoricalStateError,
	isRateLimitError,
	formatErrorMessage,
} from "../utils/errors.js";

const CONTRACT = "0x38c4E93bac87b2fb96931dAB876Bb683D388f1A8";
const DEFAULT_RPC = "https://mainnet.base.org";

async function getCodeAt(
	contractAddress: string,
	blockNumber: number,
	provider: JsonRpcProvider,
): Promise<string> {
	let consecutiveErrors = 0;
	for (;;) {
		try {
			return await provider.getCode(contractAddress, blockNumber);
		} catch (err) {
			if (isNoHistoricalStateError(err)) {
				throw new Error(
					`RPC node is not an archive node (no historical state at block ${blockNumber}). Use an archive-capable RPC endpoint.`,
				);
			}
			consecutiveErrors++;
			if (consecutiveErrors > 10) {
				throw new Error(
					`getCodeAt: giving up after ${consecutiveErrors} errors: ${formatErrorMessage(err)}`,
				);
			}
			const wait = isRateLimitError(err)
				? Math.min(Math.pow(2, consecutiveErrors) * 2, 120)
				: Math.min(consecutiveErrors * 10, 120);
			console.warn(
				`getCodeAt: ${isRateLimitError(err) ? "rate limited" : "error"}, waiting ${wait}s (attempt ${consecutiveErrors})`,
			);
			await new Promise((r) => setTimeout(r, wait * 1000));
		}
	}
}

async function findDeploymentBlock(
	contractAddress: string,
	provider: JsonRpcProvider,
): Promise<{ blockNumber: number; timestamp: number }> {
	const currentBlock = await provider.getBlockNumber();
	console.log(`Current block: ${currentBlock}`);

	let upper = currentBlock - 1000;
	let step = 10_000;
	let lower = upper - step;

	console.log(`Walking backwards from block ${upper} in steps of ${step}...`);
	while (lower > 0) {
		const code = await getCodeAt(contractAddress, lower, provider);
		console.log(
			`  block ${lower}: ${code === "0x" ? "not deployed" : "deployed"} (step=${step})`,
		);
		if (code === "0x") break;
		upper = lower;
		step = Math.min(step * 2, 2_000_000);
		lower = Math.max(0, upper - step);
	}

	console.log(`\nBinary searching between blocks ${lower} and ${upper}...`);
	while (upper - lower > 1) {
		const mid = lower + Math.floor((upper - lower) / 2);
		const code = await getCodeAt(contractAddress, mid, provider);
		console.log(
			`  mid=${mid}: ${code === "0x" ? "not deployed" : "deployed"} [${lower}..${upper}]`,
		);
		if (code === "0x") {
			lower = mid;
		} else {
			upper = mid;
		}
	}

	const block = await provider.getBlock(lower);
	return { blockNumber: lower, timestamp: block!.timestamp };
}

async function main() {
	const rpcUrl = process.argv[2] ?? DEFAULT_RPC;
	console.log(`RPC:      ${rpcUrl}`);
	console.log(`Contract: ${CONTRACT}\n`);

	const provider = new JsonRpcProvider(rpcUrl);

	const { blockNumber, timestamp } = await findDeploymentBlock(CONTRACT, provider);
	const date = new Date(timestamp * 1000).toISOString();
	console.log(`\nDeployment block: ${blockNumber} (${date})`);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
