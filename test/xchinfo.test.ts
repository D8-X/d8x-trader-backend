import { PerpetualDataHandler, MarketData } from "@d8x/perpetuals-sdk";

async function test() {
	const config = PerpetualDataHandler.readSDKConfig("arbitrumSepolia");
	const mktData = new MarketData(config);
	await mktData.createProxyInstance();
	const info = await mktData.exchangeInfo();
	console.log(info);
}
test();
