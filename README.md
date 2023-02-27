# d8x-trader-backend

# Prerequisits

- install Redis: https://redis.io/docs/getting-started/installation/install-redis-on-linux/
- node (used v18.14.0 for testing)
- yarn

# Buidl and run backend

- Copy `.envExample` file and paste as `.env` file. Make changes if necessary.
  - for example: re-define the ports in `.env`, e.g., 3000 (using 30001 below)
- npm run build
- npm run start
- REST: http://localhost:3001/
- Websocket: ws://localhost:8080

## Response Format

```
{ type: "error"| <endpointName> | "connect" | "subscription",
  msg: <endpointName If Error> | "" | <info about connection>,
  data:  "" | <json-object>
}
```

## All GET endpoints (parameter examples):

- `/exchangeInfo` (no parameters)
- `/perpetualStaticInfo?symbol=ETH-USD-MATIC`
- `/getPerpetualMidPrice?symbol=MATIC-USD-MATIC`
- `/getMarkPrice?symbol=MATIC-USD-MATIC`
- `/getOraclePrice?symbol=ETH-USD`
- `/openOrders?traderAddress=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`
- `/positionRisk?traderAddress=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`
- Fee including broker fee in tbps (1e-5): `/queryFee?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC`
- `getOrderIds?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`
- `getCurrentTraderVolume?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC-USD-MATIC`

## All POST endpoints for Trader:

If the frontend wants to submit a trade for a trader, it sends the trade-struct
to the `/orderDigest` endpoint using a POST request. The back-end takes care of
the broker fee, signature, and address, and responds with an order-struct that is ready
to be submitted to the contract. The response also contains the contract address of the
order-book that accepts this order. The trader needs to sign the data 'digest' and
then the frontend can submit it.

- `/orderDigest`:
  - parameters `{ orders: [order1, order2], traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05 }`, see test/post.test.ts
  - returns `{digests: ['hash1 which has to be signed', 'hash2 which has to be signed'], ids: ['id 1', 'id 2'], OrderBookAddr: 'address of relevant order book', SCOrders: ['Smart-Contract Order 1',  'Smart-Contract Order 2']}`
  - the trader has to sign the digest, then the frontend must submit the SCOrder:
    `tx = await orderBookContract.postOrder(scOrder, signature)`
  - note that the broker address, signature, and fee, are added to the order in the backend and the returned SCOrder contains this. Optionally this can also work without broker in which case the information is also added.
  - more than one order can be submitted, but they must have the same symbol and correspond to the same trader
  - setAllowance has to be performed on the collateral token and the proxy-contract from the frontend
- `/positionRiskOnTrade`:
  - parameters `{ order: order, traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05 }`, see test/post.test.ts
  - returns `{newPositionRisk: 'MarginAccount type'}`
  - `newPositionRisk` is what the given trader's positionRisk would look like if the given order is executed

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

The components in the folder `indexPXWSClient` serve as a websocket client to the off-chain oracle network and streams index price data
to the frontend.

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

check the git flow in the GitFlow.md
