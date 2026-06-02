import { test, describe } from "node:test";
import assert from "node:assert/strict";
import EventListener from "../dist/eventListener.js";

const PID_NUM = 1;
const PID_STR = "1";
const SYM = "TEST-PERP";
const TRADER = "0x1111111111111111111111111111111111111111";
const order = { flags: "0", iPerpetualId: PID_STR, traderAddr: TRADER };

function makeListener() {
	const logger = { info() {}, warn() {}, error() {} };
	const el = new EventListener(logger);
	el.logger = logger;
	el.traderInterface = {
		getPerpIdFromSymbol: () => PID_NUM,
		getSymbolFromPerpId: (id) => (Number(id) === PID_NUM ? SYM : ""),
	};
	el.sdkInterface = el.traderInterface;
	el.subscriptions.set(PID_NUM, new Map());
	const got = [];
	el.subscribe({ send: (m) => got.push(JSON.parse(m)), readyState: 1 }, SYM, TRADER);
	return { el, got };
}

const last = (got) => got[got.length - 1];

describe("EventListener relay with non-number perpetualId", () => {
	test("ExecutionFailed delivered with numeric perpetualId", () => {
		const { el, got } = makeListener();
		el.onExecutionFailed(PID_STR, TRADER, "0xd1", "reason");
		assert.equal(last(got).data.name, "ExecutionFailed");
		assert.equal(typeof last(got).data.obj.perpetualId, "number");
		assert.equal(last(got).data.obj.symbol, SYM);
	});

	test("PerpetualLimitOrderCreated delivered with numeric perpetualId", () => {
		const { el, got } = makeListener();
		el.onPerpetualLimitOrderCreated(PID_STR, TRADER, "0x0", order, "0xd2");
		assert.equal(last(got).data.name, "PerpetualLimitOrderCreated");
		assert.equal(typeof last(got).data.obj.perpetualId, "number");
	});

	test("Trade broadcast delivered with numeric perpetualId", () => {
		const { el, got } = makeListener();
		el.onTrade(PID_STR, TRADER, order, "0xd3", 0n, 0n);
		assert.equal(last(got).data.name, "Trade");
		assert.equal(typeof last(got).data.obj.perpetualId, "number");
	});

	test("onUpdateFundingRate keys the funding-rate map by number", () => {
		const { el } = makeListener();
		el.onUpdateFundingRate(PID_STR, 184467440737095516n);
		assert.notEqual(el.fundingRate.get(PID_NUM), undefined);
	});
});
