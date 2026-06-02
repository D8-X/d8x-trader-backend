import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { AccountTrade, PerpetualDataHandler } from "@d8-x/d8x-node-sdk";
import { ethers } from "ethers";

const SDK_CONFIG = "base_sepolia";
const CHAIN_ID = 84532;

const PK = process.env.KEY;
const WS_URL = process.env.WS_URL_TESTNET;
const API_URL = process.env.API_URL_TESTNET;
const RPC = process.env.RPC_TESTNET;
const ORIGIN = process.env.WS_TEST_ORIGIN;
const QTY = Number(process.env.TRADE_QTY);
const TIMEOUT_MS = Number(process.env.TRADE_TEST_TIMEOUT_MS ?? 120000);

const skip =
	!(PK && WS_URL && API_URL && RPC && QTY) &&
	"set KEY, WS_URL_TESTNET, API_URL_TESTNET, RPC_TESTNET, TRADE_QTY";

async function findActiveMarket(apiUrl) {
	const res = await fetch(`${apiUrl.replace(/\/$/, "")}/exchange-info`, {
		headers: ORIGIN ? { Origin: ORIGIN } : {},
		signal: AbortSignal.timeout(30000),
	});
	const info = (await res.json()).data;
	for (const pool of info.pools)
		for (const p of pool.perpetuals)
			if (p.state === "NORMAL" && !p.isMarketClosed)
				return `${p.baseCurrency}-${p.quoteCurrency}-${pool.poolSymbol}`;
	throw new Error("no active market found");
}

function connect(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, ORIGIN ? { origin: ORIGIN } : {});
		const to = setTimeout(() => (ws.terminate(), reject(new Error("connect timeout"))), 20000);
		ws.once("open", () => (clearTimeout(to), resolve(ws)));
		ws.once("error", (e) => (clearTimeout(to), reject(e)));
	});
}

async function waitFor(fn, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fn()) return true;
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

describe("WS trade events — base sepolia", { skip }, () => {
	let symbol, trader, accTrade;

	before(async () => {
		const config = PerpetualDataHandler.readSDKConfig(SDK_CONFIG);
		assert.equal(config.chainId, CHAIN_ID, "trade tests are restricted to base sepolia");
		config.nodeURL = RPC;
		trader = new ethers.Wallet(PK).address;
		symbol = await findActiveMarket(API_URL);
		accTrade = new AccountTrade(config, PK);
		await accTrade.createProxyInstance();
	});

	test("placing an order relays PerpetualLimitOrderCreated to the trader", async () => {
		const ws = await connect(WS_URL);
		const received = new Map();
		ws.on("message", (data) => {
			let m;
			try {
				m = JSON.parse(data.toString());
			} catch {
				return;
			}
			if (m.data?.name) received.set(m.data.name, m.data.obj);
		});

		ws.send(JSON.stringify({ traderAddr: trader, symbol }));
		await new Promise((r) => setTimeout(r, 1500));

		const resp = await accTrade.order({
			symbol,
			side: "BUY",
			type: "MARKET",
			quantity: QTY,
			leverage: 10,
			executionTimestamp: Math.floor(Date.now() / 1000),
		});

		assert.ok(
			await waitFor(() => received.has("PerpetualLimitOrderCreated"), TIMEOUT_MS),
			"PerpetualLimitOrderCreated not relayed",
		);
		const created = received.get("PerpetualLimitOrderCreated");
		assert.equal(typeof created.perpetualId, "number");
		assert.equal(created.traderAddr.toLowerCase(), trader.toLowerCase());

		try {
			await accTrade.cancelOrder(symbol, resp.orderId ?? resp.digest);
		} catch {
			// best-effort cleanup; order may already be filled
		}
		ws.close();
	});
});
