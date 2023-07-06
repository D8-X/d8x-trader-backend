# Build and run backend

- Optional: build your own instance of the Pyth Price service:
  - Using [repo](https://github.com/pyth-network/pyth-crosschain/tree/main/price_service/server)
  - Set the endpoint of your price service in the field `wsEndpoints` of the file config/wsConfig.json. Note that you can have
    multiple servers in the configuration instead of just one.

## Prerequisites

Either

- install Redis: https://redis.io/docs/getting-started/installation/install-redis-on-linux/
- node (used v18.14.0 for testing)
- yarn
  Or just Docker.

[details running without docker](README_MONOREPO.md)

## Using Docker

- check `packages/src/wsConfig.json`, especially edit the entry `wsEndpoints` optionally add your own endpoint for the
  [price service](https://github.com/pyth-network/pyth-crosschain/tree/main/price_service/server)
- Copy `.envExample` file and paste as `.env` file. No changes should be necessary for testnet.
- `cd` into the repository root directory and

```bash
docker compose  --env-file .env up --build
```

## Broker-fee

By default the backend comes without any broker-fee involved. D8X allows brokers to set their
own fee which is added to the exchange fee that the trader is charged. The broker receives the fee
from the D8X smart contracts whenever the trader places a trade.

To apply a broker fee, the broker needs to implement a concrete class that inherits from the
abstract class `BrokerIntegration`. Specifically, the following methods need to be implemented:

1. `getBrokerAddress(traderAddr: string, order?: Order): string`
2. `getBrokerFeeTBps(traderAddr: string, order?: Order): number`
3. `signOrder(SCOrder: SmartContractOrder): string`

By default, a the class `NoBroker` is used. Once the broker implements their own class, the following two lines have to be changed in `index.ts`:

```
import NoBroker from "./noBroker";
...
let d8XBackend = new D8XBrokerBackendApp(new NoBroker(), sdkConfig);
```

Methods (1) and (2) are trivial, method (3) requires access to the broker private key and it can make use of the following code-snippet
that leverages D8X Node SDK:

```
// for a known brokerPrivateKey and brokerAddress
config = PerpetualDataHandler.readSDKConfig("testnet");
let brokerTool = new BrokerTool(config, brokerPrivateKey);
await brokerTool.createProxyInstance();
let signedOrder = await brokerTool.signOrder(order, brokerAddress);

```

## Response Format

```
{ type: "error"| <endpointName> | "connect" | "subscription",
  msg: <endpointName If Error> | "" | <info about connection>,
  data:  "" | <json-object>
}
```

## All GET endpoints (parameter examples):

- `/exchange-info` (no parameters): Exchange information, including all pools and perpetuals
- `/perpetual-static-info?symbol=ETH-USD-MATIC`: Static data about a perpetual
- `/perpetual-mid-price?symbol=MATIC-USD-MATIC`: Current mid-price
- `/mark-price?symbol=MATIC-USD-MATIC`: Current mark-price
- `/oracle-price?symbol=ETH-USD`: Latest oracle price
- `/open-orders?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`: All open orders of a trader in a perpetual
- `/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`: Current state of a trader's account in a perpetual
- `/trading-fee?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC` : Fee including broker fee in tbps (1e-5)
- `/order-ids?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`: Ids of all the orders of a trader in a perpetual
- `/current-trader-volume?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC`: Current trading volume of a trader
- `/add-collateral?symbol=MATIC-USD-MATIC&amount=100`: Data needed to deposit collateral via direct smart contract interaction: perpetual Id, proxy contract address, 'deposit' method ABI, price updates, and HEX-encoded amount
- `/remove-collateral?symbol=MATIC-USD-MATIC&amount=100`: Data needed to withdraw collateral via direct smart contract interaction: perpetual Id, proxy contract address, 'withdraw' method ABI, price updates, and HEX-encoded amount
- `/available-margin?symbol=MATIC-USD-MATIC&traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05`: Maximum amount that can be removed from a trader's account
- `/cancel-order?symbol=MATIC-USD-MATIC&orderId=0x433cd04c5e9703890d5aa72d90980b90bfde5b087075293abd679a067780629d`: Data needed to cancel a given order via direct smrt contract interaction: order book contract address, 'cancelOrder' method ABI, price updates, and digest to sign by the trader who posted this order

## All POST endpoints for Trader:

If the frontend wants to submit a trade for a trader, it sends the trade-struct
to the `/order-digest` endpoint using a POST request. The back-end takes care of
the broker fee, signature, and address, and responds with an order-struct that is ready
to be submitted to the contract. The response also contains the contract address of the
order-book that accepts this order. The trader needs to sign the data 'digest' and
then the frontend can submit it.

- `/order-digest`:
  - parameters `{ orders: [order1, order2], traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05 }`, see test/post.test.ts
  - returns `{digests: ['hash1 which has to be signed', 'hash2 which has to be signed'], ids: ['id 1', 'id 2'], OrderBookAddr: 'address of relevant order book', SCOrders: ['Smart-Contract Order 1',  'Smart-Contract Order 2']}`
  - the trader has to sign the digest, then the frontend must submit the SCOrder:
    `tx = await orderBookContract.postOrder(scOrder, signature)`
  - note that the broker address, signature, and fee, are added to the order in the backend and the returned SCOrder contains this. Optionally this can also work without broker in which case the information is also added.
  - more than one order can be submitted, but they must have the same symbol and correspond to the same trader
  - setAllowance has to be performed on the collateral token and the proxy-contract from the frontend
- `/position-risk-on-trade`:
  - parameters `{ order: order, traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05 }`, see test/post.test.ts
  - returns `{newPositionRisk: 'MarginAccount type', orderCost: number}`
    - `newPositionRisk` is what the given trader's positionRisk would look like if the given order is executed
    - `orderCost` is the approximate collateral deposit that will be deducted from the trader when the order is executed
- `/position-risk-on-collateral-action`:
  - parameters `{ traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05, amount: -100, positionRisk: 'Margin account struct' }`, see test/post.test.ts
  - returns `{newPositionRisk: 'MarginAccount type', availableMargin: number}`
    - `newPositionRisk` is what the given trader's positionRisk would look like if the given order is executed
    - `availableMargin` is the maximum amount of margin that can be withdrawn from this account

Swagger (incomplete): http://localhost:3001/api/docs/

# Websocket

The frontend subscribes to perpetuals and trader addresses. Some messages
are trader-address specific, some are broadcasted (indicated below).

- endpoint `ws://localhost:8080`
- subscribe by sending a JSON message in the following format:

```
interface SubscriptionInterface {
  // perpetual symbol, e.g. MATIC-USD-MATIC
  symbol: string;
  // address of the trader
  traderAddr: string;
}
```

To unsubscribe, send

```
{
 "type": "unsubscribe"
}
```

response:

```
{ type: "subscription",
  msg: <BTC-USD-MATIC>,
  data: {<perpState>}
}

```

- all messages received are defined in [src/wsTypes](/src/wsTypes) and listed below
- the general format of the messages is

```
{ type: "error"| <endpointName> | "connect",
  msg: <endpointName If Error> | "" | <info about connection>,
  data:  <json-WSMsg-object> | ""
}
```

with `<json-WSMsg-object>` defined as

```
interface WSMsg {
  name: string;
  obj: Object;
}
```

- Objects are built from the following interfaces

```
// broadcasted
// careful: openInterest and fundingRate might
// be zero in which case exchangeInfo should not
// be overwritten with 0.
interface PriceUpdate {
  perpetualId: number;
  midPrice: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  openInterest: number;
}
```

```
interface LimitOrderCreated {
  perpetualId: number;
  traderAddr: string;
  brokerAddr: string;
  orderId: string;
}
```

```
// broadcasted, so recent trades can be displayed
interface Trade {
  perpetualId: number;
  traderAddr: string;
  // each position has a unique id
  positionId: string;
  // each order has a unique id
  orderId: string;
  // position size in base currency
  newPositionSizeBC: number;
  // execution price in quote currency
  executionPrice: number;
}
```

```
interface PerpetualLimitOrderCancelled {
  perpetualId: number;
  traderAddr: string;
  orderId: string;
}
```

```
interface UpdateMarginAccount {
  perpetualId: number;
  traderAddr: string;
  // id of position
  positionId: string;
  // position size in base currency
  positionBC: number;
  // margin collateral in collateral currency
  cashCC: number;
  // average price * position size
  lockedInValueQC: number;
  // funding payment paid when
  // margin account was changed
  fundingPaymentCC: number;
}
```

## Live index price streams

The components in the `/packages/pxws-client` submodule serve as a websocket
client to the off-chain oracle network and streams index price data to the
frontend.

The `FeedHandler` class gets updated price indices, writes them to REDIS, and publishes the update via
`this.redisPubClient.publish("feedHandler", names);`, where names are colon separated tickers (BTC-USD:BTC-USDC).
To inform the `FeedHandler` what indices are required, the `FeedHandler` subscribes to `"feedRequest"` and
expects indices separated by colons (BTC-USDC:MATIC-USD:ETH-USD) in the message sent when publishing.
The `FeedHandler` requests a `"feedRequest"` message by sending `publish("feedHandler", "query-request")`

The client (SDKInterface) therefore needs to listen to `"feedHandler"` and upon receipt should publish
`"feedRequest"` with the required indices. Requested indices must be available completly via triangulation
from the websocket feeds. Upon receipt of `"feedUpdate"` the eventListener gets the updated
index prices from REDIS and processes them (change of mark-price, mid-price etc.) and streams the relevant
information via Websocket to the frontend.

# GitFlow

- Each chain id can have an entry as below
- _wsEndpoints_ can contain several endpoints. If there is no response from one, the system switches. The first endpoint is always used first.
- _feedIds_ defines a name and the identifier for this id.
- _tickers_ all the sources we want to listen too. Requires a feedId-entry with the same name. Users can subscribe to all triangulations
  that are possible with the provided ticker-list. Typically the tickers and feedIds are congruent
- _streamName_ is an arbitrary name and has no impact on the functions. The idea is that there can be several Pyth-like off-chain price feeds
  and we can have different configs for those for the same chainId.

```
[
{
    "chainId": 80001,
    "streamName": "crypto1",
    "wsEndpoints": ["wss://xc-testnet.pyth.network/ws"],
    "tickers": ["BTC-USD", "ETH-USD", "MATIC-USD"],
    "feedIds": [
      ["BTC-USD", "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b"],
      ["MATIC-USD", "0xd2c2c1f2bba8e0964f9589e060c2ee97f5e19057267ac3284caef3bd50bd2cb5"],
      ["ETH-USD", "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6"],
      ["USDC-USD", "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722"],
      ["USD-CHF", "0x796d24444ff50728b58e94b1f53dc3a406b2f1ba9d0d0b91d4406c37491a6feb"],
      ["GBP-USD", "0xbcbdc2755bd74a2065f9d3283c2b8acbd898e473bdb90a6764b3dbd467c56ecd"],
      ["XAU-USD", "0x30a19158f5a54c0adf8fb7560627343f22a1bc852b89d56be1accdc5dbf96d0e"]
    ]
  }
]
```
