import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";

const TIMEOUT_MS = Number(process.env.WS_TEST_TIMEOUT_MS ?? 20000);
const ORIGIN = process.env.WS_TEST_ORIGIN;
const TRADER = process.env.WS_TEST_TRADER ?? "0x0000000000000000000000000000000000000001";
const MAPPER_URL = process.env.GAME_MAPPER_URL;
const MAPPER_KEY = process.env.GAME_MAPPER_API_KEY;

const targets = Object.entries(process.env)
	.filter(([k, v]) => k.startsWith("WS_URL_") && !!v)
	.map(([k, v]) => {
		const net = k.slice("WS_URL_".length);
		return { net, url: v, symbol: process.env[`SYMBOL_${net}`] };
	});

async function findGameSymbol() {
	if (!MAPPER_URL || !MAPPER_KEY) return undefined;
	const rpc = (method, params) =>
		fetch(MAPPER_URL, {
			method: "POST",
			headers: { "x-api-key": MAPPER_KEY, "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
			.then((r) => r.json())
			.then((j) => j.result);
	try {
		const today = new Date().toISOString().slice(0, 10);
		const ymd = today.slice(2).replace(/-/g, "");
		const status = await rpc("game_getStatus", {});
		for (const league of Object.keys(status.leagues ?? {})) {
			const games = await rpc("game_listGames", { league });
			for (const g of games)
				if (g.polymarket?.event_date === today)
					return `${league}_${g.away_abbr}_${g.home_abbr}_${ymd}-PUSD-PUSD`;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function connect(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, ORIGIN ? { origin: ORIGIN } : {});
		const to = setTimeout(() => {
			ws.terminate();
			reject(new Error(`connect timeout: ${url}`));
		}, TIMEOUT_MS);
		ws.once("open", () => (clearTimeout(to), resolve(ws)));
		ws.once("error", (e) => (clearTimeout(to), reject(e)));
	});
}

function waitFor(ws, pred) {
	return new Promise((resolve, reject) => {
		const to = setTimeout(() => reject(new Error("timed out waiting for ws message")), TIMEOUT_MS);
		const onMsg = (data) => {
			let m;
			try {
				m = JSON.parse(data.toString());
			} catch {
				return;
			}
			if (pred(m)) (clearTimeout(to), ws.off("message", onMsg), resolve(m));
		};
		ws.on("message", onMsg);
	});
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (targets.length === 0) {
	test("skipped: no WS_URL_* env vars set", { skip: true }, () => {});
}

for (const t of targets) {
	describe(`WS subscription — ${t.net} (${t.url})`, () => {
		let symbol = t.symbol;

		before(async () => {
			if (!symbol) symbol = await findGameSymbol();
		});

		test("connects and greets with connect:success", async () => {
			const ws = await connect(t.url);
			try {
				const m = await waitFor(ws, (m) => m.type === "connect");
				assert.equal(m.msg, "success");
			} finally {
				ws.close();
			}
		});

		test("rejects malformed trader address", async () => {
			const ws = await connect(t.url);
			try {
				send(ws, { traderAddr: "not-an-address", symbol: "BTC-USD-USD" });
				const m = await waitFor(ws, (m) => m.type === "error");
				assert.equal(m.data.code, "SUBSCRIBE_ERROR");
			} finally {
				ws.close();
			}
		});

		test("rejects unknown symbol", async () => {
			const ws = await connect(t.url);
			try {
				send(ws, { traderAddr: TRADER, symbol: "NOTREAL-USD-USD" });
				const m = await waitFor(ws, (m) => m.type === "error" || m.type === "subscription");
				assert.equal(m.type, "error");
			} finally {
				ws.close();
			}
		});

		test("subscribe returns subscription + perpetual state", async (tc) => {
			if (!symbol) return tc.skip(`set SYMBOL_${t.net} or GAME_MAPPER_URL/GAME_MAPPER_API_KEY`);
			const ws = await connect(t.url);
			try {
				send(ws, { traderAddr: TRADER, symbol });
				const m = await waitFor(ws, (m) => m.type === "subscription");
				assert.equal(m.msg, symbol.toUpperCase());
				assert.equal(typeof m.data?.id, "number");
			} finally {
				ws.close();
			}
		});

		test("ping after subscribe returns pong", async (tc) => {
			if (!symbol) return tc.skip(`set SYMBOL_${t.net} or GAME_MAPPER_URL/GAME_MAPPER_API_KEY`);
			const ws = await connect(t.url);
			try {
				send(ws, { traderAddr: TRADER, symbol });
				await waitFor(ws, (m) => m.type === "subscription");
				send(ws, { type: "ping" });
				const m = await waitFor(ws, (m) => m.type === "ping");
				assert.equal(m.msg, "pong");
			} finally {
				ws.close();
			}
		});

		test("unsubscribe then resubscribe acks again", async (tc) => {
			if (!symbol) return tc.skip(`set SYMBOL_${t.net} or GAME_MAPPER_URL/GAME_MAPPER_API_KEY`);
			const ws = await connect(t.url);
			try {
				send(ws, { traderAddr: TRADER, symbol });
				await waitFor(ws, (m) => m.type === "subscription");
				send(ws, { type: "unsubscribe" });
				await sleep(500);
				send(ws, { traderAddr: TRADER, symbol });
				const m = await waitFor(ws, (m) => m.type === "subscription");
				assert.equal(m.msg, symbol.toUpperCase());
			} finally {
				ws.close();
			}
		});
	});
}
