import { NodeSDKConfig, PerpetualDataHandler } from "@d8-x/d8x-node-sdk";
import dotenv from "dotenv";
import fs from "fs";
import { executeWithTimeout, extractErrorMsg, loadConfigRPC, sleep } from "utils";
import { RPCConfig } from "utils/dist/wsTypes.js";
import D8XBrokerBackendApp from "./D8XBrokerBackendApp.js";
import BrokerIntegration from "./brokerIntegration.js";
import BrokerNone from "./brokerNone.js";
import BrokerRemote from "./brokerRemote.js";
import { logger } from "./logger.js";
import RPCManager from "./rpcManager.js";

export { logger };

const INITIALIZE_TIMEOUT_BASE_MS = 160_000;
const INITIALIZE_MAX_RETRIES = 10;
const GET_RPC_TIMEOUT_MS = 15_000;
const HEARTBEAT_LOOP_IDLE_MS = 60_000;
const HEARTBEAT_LOOP_RETRY_MS = 1_000;
const POST_ERROR_SLEEP_MS = 1_000;

async function safeGetRPC(
	mgr: RPCManager,
	kind: "ws" | "http",
	healthy: boolean,
	fallback: string,
): Promise<string> {
	try {
		return await executeWithTimeout(
			mgr.getRPC(healthy),
			GET_RPC_TIMEOUT_MS,
			`${kind} getRPC timeout`,
		);
	} catch (err) {
		logger.warn("getRPC timed out, keeping previous URL", {
			kind,
			error: extractErrorMsg(err),
		});
		return fallback;
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the commented-out VAA endpoints flow below
function loadVAAEndpoints(filename: string): string[] {
	const fileContent = fs.readFileSync(filename).toString();
	const f = JSON.parse(fileContent);
	if ("priceServiceHTTPSEndpoints" in f && f.priceServiceHTTPSEndpoints.length > 0) {
		return f.priceServiceHTTPSEndpoints;
	}

	throw Error("priceServiceHTTPSEndpoints not found in prices config");
}

async function start() {
	dotenv.config();
	const configName: string = <string>process.env.SDK_CONFIG_NAME || "";
	if (configName == "") {
		throw new Error("Set SDK_CONFIG_NAME in .env (e.g. SDK_CONFIG_NAME=testnet)");
	}
	logger.info(`loading configuration ${configName}`);
	const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig(configName);
	/*
	const configPricesName: string = <string>process.env.CONFIG_PATH_PRICES || "";
	if (configPricesName == "") {
		throw new Error(
			"Set CONFIG_PATH_PRICES in .env (e.g. CONFIG_PATH_PRICES=./config/prices.config.json)",
		);
	}
	logger.info(`extracting price VAA endpoints ${configPricesName}`);
	const endpoints = loadVAAEndpoints(configPricesName);
	let type = "pyth";
	if (endpoints[0].includes("odin")) {
		type = "odin";
	}
	sdkConfig.priceFeedEndpoints = [{ type: type, endpoints: endpoints }];
	*/
	logger.info("priceFeedEndpoints", {
		priceFeedEndpoints: sdkConfig.priceFeedEndpoints,
	});
	const rpcConfig = loadConfigRPC() as RPCConfig[];
	let broker: BrokerIntegration;
	let remoteBrokerAddr = process.env.REMOTE_BROKER_HTTP;

	if (remoteBrokerAddr != undefined && process.env.REMOTE_BROKER_HTTP != "") {
		const brokerIdName = "1";
		remoteBrokerAddr = remoteBrokerAddr.replace(/\/+$/, ""); // remove trailing slash
		logger.info("Creating remote broker for order signatures");
		broker = new BrokerRemote(remoteBrokerAddr, brokerIdName, sdkConfig.chainId);
	} else {
		logger.info("No broker PK/fee or remote broker defined, using empty broker.");
		broker = new BrokerNone();
	}
	const rpcManagerHttp = new RPCManager(
		rpcConfig.find((config) => config.chainId == sdkConfig.chainId)?.HTTP ?? [],
	);
	const rpcManagerWs = new RPCManager(
		rpcConfig.find((config) => config.chainId == sdkConfig.chainId)?.WS ?? [],
	);
	sdkConfig.nodeURL = await rpcManagerHttp.getRPC();
	let wsRPC = await rpcManagerWs.getRPC(false);
	const d8XBackend = new D8XBrokerBackendApp(broker!, sdkConfig, logger);
	let count = 0;
	let isSuccess = false;
	while (!isSuccess) {
		try {
			logger.info(`RPC (HTTP) = ${sdkConfig.nodeURL}`);
			logger.info(`RPC (WS)   = ${wsRPC}`);
			await executeWithTimeout(
				d8XBackend.initialize(sdkConfig, rpcManagerHttp, wsRPC),
				(count + 1) * INITIALIZE_TIMEOUT_BASE_MS,
				"initialize timeout",
			);
			isSuccess = true;
		} catch (error) {
			logger.error("initializing d8xBackend", {
				error: error instanceof Error ? error.message : String(error),
			});
			await sleep(POST_ERROR_SLEEP_MS);
			if (count > INITIALIZE_MAX_RETRIES) {
				throw error;
			}
			logger.info("retrying new rpc...");
			sdkConfig.nodeURL = await rpcManagerHttp.getRPC();
			wsRPC = await rpcManagerWs.getRPC(false);
		}
		count++;
	}

	let waitTime = HEARTBEAT_LOOP_IDLE_MS;
	/* eslint-disable no-constant-condition */
	while (true) {
		await sleep(waitTime);
		wsRPC = await safeGetRPC(rpcManagerWs, "ws", false, wsRPC);
		await sleep(POST_ERROR_SLEEP_MS);
		sdkConfig.nodeURL = await safeGetRPC(
			rpcManagerHttp,
			"http",
			true,
			sdkConfig.nodeURL,
		);

		if (!(await d8XBackend.checkSDKHeartbeat())) {
			logger.warn("SDK heartbeat check failed. Will self heal on next refresh");
		}

		await sleep(POST_ERROR_SLEEP_MS);

		// restart event listener if events are out of sync

		if (!(await d8XBackend!.checkTradeEventListenerHeartbeat(wsRPC))) {
			waitTime = HEARTBEAT_LOOP_RETRY_MS;
		} else {
			waitTime = HEARTBEAT_LOOP_IDLE_MS;
		}
	}
}
start();
