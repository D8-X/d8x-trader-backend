import { PerpetualDataHandler, MarketData } from "@d8x/perpetuals-sdk";

async function test() {
  const config = PerpetualDataHandler.readSDKConfig("testnet");
  config.nodeURL =
    "https://spring-fittest-diagram.matic-testnet.quiknode.pro/09346d48fb9929a508104956421d49883d7d105a/";
  //https://gateway.tenderly.co/public/polygon-mumbai";
  const mktData = new MarketData(config);
  await mktData.createProxyInstance();
  const info = await mktData.exchangeInfo();
  console.log(info);
}
test();
