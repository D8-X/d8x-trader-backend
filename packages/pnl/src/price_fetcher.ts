/**
 * This script must be run as a cron job
 */

import { JsonRpcProvider, ethers } from "ethers";
import { loadEnv } from "./main";
import { loadABIs } from "@d8x/perpetuals-sdk";
import { Prisma, PrismaClient } from "@prisma/client";
import { getPerpetualManagerABI } from "./abi/get";
// Fetch the latest price from chain and put it in db
const run = async () => {
	// Assert that required env variables are present
	loadEnv(["HTTP_RPC_URL", "DATABASE_URL", "SC_ADDRESS_PERPETUAL_MANAGER_PROXY"]);

	const provider = new JsonRpcProvider(process.env.HTTP_RPC_URL as string);
	const contract = new ethers.Contract(
		process.env.SC_ADDRESS_PERPETUAL_MANAGER_PROXY as string,
		getPerpetualManagerABI(),
		provider
	);
	const prisma = new PrismaClient();

	const allPools = await prisma.price.findMany({
		select: {
			pool_id: true,
		},
		distinct: ["pool_id"],
	});

	// Fetch the prices for each perpetual pool that we have
	for (let i = 0; i < allPools.length; i++) {
		const price = await contract.getShareTokenPriceD18(allPools[i]);
		console.log(price);
	}
};

run();
