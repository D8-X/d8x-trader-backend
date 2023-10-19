import dotenv from "dotenv";
import { chooseRandomRPC, sleep, executeWithTimeout, loadConfigRPC } from "utils";
import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import BrokerNone from "./brokerNone";
import BrokerIntegration from "./brokerIntegration";
import { PerpetualDataHandler, NodeSDKConfig } from "@d8x/perpetuals-sdk";
import BrokerRemote from "./brokerRemote";
import * as winston from "winston";
import { RPCConfig } from "utils/dist/wsTypes";
import RPCManager from "./rpcManager";

const defaultLogger = () => {
	return winston.createLogger({
		level: "info",
		format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
		defaultMeta: { service: "api" },
		transports: [new winston.transports.Console()],
	});
};
export const logger = defaultLogger();

async function start() {
	dotenv.config();
	let configName: string = <string>process.env.SDK_CONFIG_NAME || "";
	if (configName == "") {
		throw new Error("Set SDK_CONFIG_NAME in .env (e.g. SDK_CONFIG_NAME=testnet)");
	}
	console.log(`loading configuration ${configName}`);
	const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig(configName);
	const rpcConfig = loadConfigRPC() as RPCConfig[];

	const priceFeedEndpoints: Array<{ type: string; endpoint: string }> = [];

	if (priceFeedEndpoints.length > 0) {
		sdkConfig.priceFeedEndpoints = priceFeedEndpoints;
	}
	let broker: BrokerIntegration;
	let remoteBrokerAddr = process.env.REMOTE_BROKER_HTTP;

	if (remoteBrokerAddr != undefined && process.env.REMOTE_BROKER_HTTP != "") {
		const brokerIdName = "1";
		remoteBrokerAddr = remoteBrokerAddr.replace(/\/+$/, ""); // remove trailing slash
		console.log("Creating remote broker for order signatures");
		broker = new BrokerRemote(remoteBrokerAddr, brokerIdName, sdkConfig.chainId);
	} else {
		console.log("No broker PK/fee or remore broker defined, using empty broker.");
		broker = new BrokerNone();
	}
	const rpcManagerHttp = new RPCManager(
		rpcConfig.find((config) => config.chainId == sdkConfig.chainId)?.HTTP ?? []
	);
	const rpcManagerWs = new RPCManager(
		rpcConfig.find((config) => config.chainId == sdkConfig.chainId)?.WS ?? []
	);
	sdkConfig.nodeURL = await rpcManagerHttp.getRPC();
	let wsRPC = await rpcManagerWs.getRPC();
	let d8XBackend = new D8XBrokerBackendApp(broker!, sdkConfig, logger);
	let count = 0;
	let isSuccess = false;
	while (!isSuccess) {
		try {
			console.log(`RPC (HTTP) = ${sdkConfig.nodeURL}`);
			console.log(`RPC (WS)   = ${wsRPC}`);
			await executeWithTimeout(
				d8XBackend.initialize(sdkConfig, rpcManagerHttp, wsRPC),
				60_000,
				"initialize timeout"
			);
			isSuccess = true;
		} catch (error) {
			await sleep(1000);
			if (count > 10) {
				throw error;
			}
			console.log("retrying new rpc...");
			sdkConfig.nodeURL = await rpcManagerHttp.getRPC();
			wsRPC = await rpcManagerWs.getRPC();
		}
		count++;
	}

	let waitTime = 60_000;
	while (true) {
		await sleep(waitTime);
		wsRPC = await rpcManagerWs.getRPC();
		sdkConfig.nodeURL = await rpcManagerHttp.getRPC();
		if (!(await d8XBackend!.checkTradeEventListenerHeartbeat(wsRPC))) {
			waitTime = 1000;
		} else {
			waitTime = 60_000;
		}
	}
}
start();
