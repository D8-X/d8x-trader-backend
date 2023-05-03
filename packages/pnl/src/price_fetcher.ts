/**
 * This script must be run as a cron job. It retrieves the price information for
 * each perpetual pool and stores it in db.
 */

import { JsonRpcProvider, ethers } from "ethers";
import { loadEnv } from "./svc/main";
import { MarketData, PerpetualDataHandler, loadABIs } from "@d8x/perpetuals-sdk";
import { Prisma, PrismaClient } from "@prisma/client";
import { getNewPositionLeverage } from "@d8x/perpetuals-sdk";
import { getPerpetualManagerProxyAddress } from "./utils/abi";
import { getPerpetualManagerABI } from "./utils/abi";

// Fetch the latest price from chain and put it in db
const run = async () => {
	console.log(global.fetch);

	// Assert that required env variables are present
	loadEnv(["HTTP_RPC_URL", "DATABASE_URL", "SC_ADDRESS_PERPETUAL_MANAGER_PROXY"]);

	const provider = new JsonRpcProvider(process.env.HTTP_RPC_URL as string);
	const contract = new ethers.Contract(
		getPerpetualManagerProxyAddress(),
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

	const config = PerpetualDataHandler.readSDKConfig("testnet");

	// MarketData (read only, no authentication needed)
	let mktData = new MarketData(config);
	await mktData.createProxyInstance();
	const poolIds = (await mktData.exchangeInfo()).pools
		.map((pool) => {
			return pool.perpetuals.map((perp) => perp.id);
		})
		.reduce((c) => {
			return c;
		});

	console.log(poolIds);
	// Fetch the prices for each perpetual pool that we have
	for (let i = 0; i < allPools.length; i++) {
		const price = await contract.getShareTokenPriceD18(allPools[i]);
		console.log(price);
	}
};

run();
