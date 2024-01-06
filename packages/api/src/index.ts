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
import fs from "fs";

const defaultLogger = () => {
  return winston.createLogger({
    level: "info",
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { service: "api" },
    transports: [new winston.transports.Console()],
  });
};
export const logger = defaultLogger();

function loadVAAEndpoints(filename : string) : string[] {
  const fileContent = fs.readFileSync(filename).toString();
  let f = JSON.parse(fileContent);
  if ("priceServiceHTTPSEndpoints" in f && f.priceServiceHTTPSEndpoints.length>0) {
    return f.priceServiceHTTPSEndpoints
  }
  let ep = f.priceServiceWSEndpoints as string[]
  // replace wss endpoints with https analogue
  for(let k=0; k<ep.length; k++) {
    ep[k] = ep[k].replace(/\/$/, "")
    ep[k] = ep[k].replace(/\/ws$/, "/api")
    ep[k] = ep[k].replace(/^wss/, "https")
  }
  return ep
}

async function start() {
  dotenv.config();
  let configName: string = <string>process.env.SDK_CONFIG_NAME || "";
  if (configName == "") {
    throw new Error("Set SDK_CONFIG_NAME in .env (e.g. SDK_CONFIG_NAME=testnet)");
  }
  logger.info(`loading configuration ${configName}`);
  const sdkConfig: NodeSDKConfig = PerpetualDataHandler.readSDKConfig(configName);

  let configPricesName: string = <string>process.env.CONFIG_PATH_PRICES || "";
  if (configPricesName == "") {
    throw new Error("Set CONFIG_PATH_PRICES in .env (e.g. CONFIG_PATH_PRICES=./config/prices.config.json)");
  }
  logger.info(`extracting price VAA endpoints ${configPricesName}`);
  let endpoints = loadVAAEndpoints(configPricesName)
  sdkConfig.priceFeedEndpoints = [
    { type: sdkConfig.priceFeedConfigNetwork, endpoints: endpoints},
  ];

  const rpcConfig = loadConfigRPC() as RPCConfig[];
  let broker: BrokerIntegration;
  let remoteBrokerAddr = process.env.REMOTE_BROKER_HTTP;

  if (remoteBrokerAddr != undefined && process.env.REMOTE_BROKER_HTTP != "") {
    const brokerIdName = "1";
    remoteBrokerAddr = remoteBrokerAddr.replace(/\/+$/, ""); // remove trailing slash
    logger.info("Creating remote broker for order signatures");
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
  let wsRPC = await rpcManagerWs.getRPC(false);
  let d8XBackend = new D8XBrokerBackendApp(broker!, sdkConfig, logger);
  let count = 0;
  let isSuccess = false;
  while (!isSuccess) {
    try {
      logger.info(`RPC (HTTP) = ${sdkConfig.nodeURL}`);
      logger.info(`RPC (WS)   = ${wsRPC}`);
      await executeWithTimeout(
        d8XBackend.initialize(sdkConfig, rpcManagerHttp, wsRPC),
        160_000,
        "initialize timeout"
      );
      isSuccess = true;
    } catch (error) {
      await sleep(1000);
      if (count > 10) {
        throw error;
      }
      logger.info("retrying new rpc...");
      sdkConfig.nodeURL = await rpcManagerHttp.getRPC();
      wsRPC = await rpcManagerWs.getRPC(false);
    }
    count++;
  }

  let waitTime = 60_000;
  while (true) {
    await sleep(waitTime);
    wsRPC = await rpcManagerWs.getRPC(false);
    await sleep(1_000);
    sdkConfig.nodeURL = await rpcManagerHttp.getRPC();
    if (!(await d8XBackend!.checkTradeEventListenerHeartbeat(wsRPC))) {
      waitTime = 1000;
    } else {
      waitTime = 60_000;
    }
  }
}
start();
