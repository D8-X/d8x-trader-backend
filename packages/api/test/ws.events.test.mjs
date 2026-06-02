import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { AccountTrade, MarketData, PerpetualDataHandler } from "@d8-x/d8x-node-sdk";
import { ethers } from "ethers";

const SDK_CONFIG = "base_sepolia";
const CHAIN_ID = 84532;
const LEVERAGE = 10;

const PK = process.env.KEY;
const WS_URL = process.env.WS_URL_TESTNET;
const RPC = process.env.RPC_TESTNET;
const ORIGIN = process.env.WS_TEST_ORIGIN;
const TIMEOUT_MS = Number(process.env.TRADE_TEST_TIMEOUT_MS ?? 120000);

const skip = !(PK && WS_URL && RPC) && "set KEY, WS_URL_TESTNET, RPC_TESTNET";

function connect(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, ORIGIN ? { origin: ORIGIN } : {});
		const to = setTimeout(() => (ws.terminate(), reject(new Error("ws connect timeout"))), 20000);
		ws.once("open", () => (clearTimeout(to), resolve(ws)));
		ws.once("error", () => (clearTimeout(to), reject(new Error("ws connect error"))));
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

describe("WS trade events base sepolia", { skip }, () => {
	let symbol, trader, accTrade, failQty;

	before(async () => {
		const config = PerpetualDataHandler.readSDKConfig(SDK_CONFIG);
		assert.equal(config.chainId, CHAIN_ID, "trade tests are restricted to base sepolia");
		config.nodeURL = RPC;
		trader = new ethers.Wallet(PK).address;

		const md = new MarketData(config);
		await md.createProxyInstance();
		const info = await md.exchangeInfo();
		let price;
		outer: for (const pool of info.pools)
			for (const p of pool.perpetuals)
				if (p.state === "NORMAL" && !p.isMarketClosed) {
					symbol = `${p.baseCurrency}-${p.quoteCurrency}-${pool.poolSymbol}`;
					price = p.markPrice;
					break outer;
				}
		if (!symbol) throw new Error("no active market found");

		const balance = await md.getWalletBalance(trader, symbol);
		failQty = Math.ceil(((balance * LEVERAGE) / price) * 2);

		accTrade = new AccountTrade(config, PK);
		await accTrade.createProxyInstance();
	});

	test("margin-exceeding order relays PerpetualLimitOrderCreated then ExecutionFailed", async () => {
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

		await accTrade.order({
			symbol,
			side: "BUY",
			type: "MARKET",
			quantity: failQty,
			leverage: LEVERAGE,
			executionTimestamp: Math.floor(Date.now() / 1000),
		});

		assert.ok(
			await waitFor(() => received.has("PerpetualLimitOrderCreated"), TIMEOUT_MS),
			"PerpetualLimitOrderCreated not relayed",
		);
		assert.ok(
			await waitFor(() => received.has("ExecutionFailed"), TIMEOUT_MS),
			"ExecutionFailed not relayed",
		);
		const ef = received.get("ExecutionFailed");
		assert.equal(typeof ef.perpetualId, "number");
		assert.equal(ef.traderAddr.toLowerCase(), trader.toLowerCase());
		ws.close();
	});
});
