process.env.REDIS_URL ??= "redis://localhost:6379";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import EventListener from "../../dist/eventListener.js";

const PID = 1;
const SYM = "TEST-PERP";
const TRADER = "0x1111111111111111111111111111111111111111";

describe("resubscribe re-registers order-book listeners", () => {
	test("subscribing again after the perp empties re-adds the listeners", () => {
		const logger = { info() {}, warn() {}, error() {} };
		const el = new EventListener(logger);
		el.logger = logger;
		el.traderInterface = { getPerpIdFromSymbol: () => PID, getSymbolFromPerpId: () => SYM };

		let added = 0;
		el.addOrderBookEventHandlers = () => {
			added++;
		};
		el.removeOrderBookEventHandlers = () => {};

		const ws1 = { send() {}, readyState: 1 };
		const ws2 = { send() {}, readyState: 1 };
		const req = { headers: {} };

		el.subscribe(ws1, SYM, TRADER);
		assert.equal(added, 1);

		el.unsubscribe(ws1, req);
		el.subscribe(ws2, SYM, TRADER);

		assert.equal(added, 2, "order-book listeners were not re-registered on resubscribe");
	});
});
