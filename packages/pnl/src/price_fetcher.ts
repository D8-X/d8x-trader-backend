#!/bin/bash

/**
 * This script must be run as a cron job. It retrieves the price information for
 * each perpetual pool and stores it in db.
 */

import { JsonRpcProvider, ethers } from "ethers";
import { loadEnv, logger } from "./svc/main";
import { PrismaClient } from "@prisma/client";
import { getPerpetualManagerProxyAddress } from "./utils/abi";
import { getPerpetualManagerABI } from "./utils/abi";
import { getDefaultRPC } from "./utils/abi";
import { dec18ToFloat } from "./utils/bigint";

// Fetch the latest price from chain and put it in db
const run = async () => {
	// Assert that required env variables are present
	loadEnv(["DATABASE_URL", "SDK_CONFIG_NAME"]);

	const provider = new JsonRpcProvider(getDefaultRPC());
	const contract = new ethers.Contract(
		getPerpetualManagerProxyAddress(),
		getPerpetualManagerABI(),
		provider
	);

	const prisma = new PrismaClient();

	// uint8 max value - maximum number of pools
	const maxPools = 255;
	// let poolInfo = (await contract.getPoolStaticInfo(1, maxPools)) as ethers.Result;
	// const poolsWithPerpetuals = poolInfo[0];

	for (let i = 0; i < maxPools; i++) {
		const poolId = i + 1;
		let price: bigint;

		// Attempt to retrieve the pool price
		try {
			price = await contract.getShareTokenPriceD18(poolId);
		} catch (e) {
			logger.error(
				"got error when calling getShareTokenPriceD18, most probably last available pool info was retrieved",
				{ poolId, error: e }
			);
			return;
		}

		logger.info(`retrieved price for pool, updating price_info...`, {
			poolId,
			price,
		});
		try {
			await prisma.price.create({
				data: {
					pool_id: poolId,
					pool_token_price: dec18ToFloat(price),
				},
			});
		} catch (e) {
			if (e instanceof Error) {
				logger.error("could not update pool price info", {
					poolId,
					error: e.message,
				});
			}
			continue;
		}

		logger.info("updated pool price infos", { poolId, price });

		// const perps = poolsWithPerpetuals[i].toArray();
		// // Update perpetuals
		// for (let j = 0; j < perps.length; j++) {
		// 	const perpetual_id = perps[j];
		// 	try {
		// 		await prisma.price.create({
		// 			data: {
		// 				pool_id: perpetual_id,
		// 				pool_token_price: dec18ToFloat(price),
		// 			},
		// 		});
		// 	} catch (e) {
		// 		if (e instanceof Error) {
		// 			logger.error("could not update perpetual price info", {
		// 				perpetual_id,
		// 				error: e.message,
		// 			});
		// 		}
		// 		continue;
		// 	}
		// 	logger.info("updated perpetual price infos", { perpetual_id, price });
		// }
	}
};

run();
