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
- `/getPerpetualMidPrice?symbol=MATIC-USD-MATIC`
- `/getMarkPrice?symbol=MATIC-USD-MATIC`
- `/getOraclePrice?symbol=ETH-USD`
- `/openOrders?address=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`
- `/positionRisk?address=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`
- Fee including broker fee in tbps (1e-5): `/queryFee?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC`
- `getOrderIds?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC-USD-MATIC`
- `getCurrentTraderVolume?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC-USD-MATIC`

## All POST endpoints for Trader:

If the frontend wants to submit a trade for a trader, it sends the trade-struct
to the `/orderDigest` endpoint using a POST request. The back-end takes care of
the broker fee, signature, and address, and responds with an order-struct that is ready
to be submitted to the contract. The response also contains the contract address of the
order-book that accepts this order. The trader needs to sign the data 'digest' and
then the frontend can submit it.

- `/orderDigest`:
  - parameters `{ order: order, orderId: orderId, traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05 }`, see test/post.test.ts
  - returns `{digest: 'hash which has to be signed', OrderBookAddr: 'address of relevant order book', SCOrder: 'Smart-Contract Order type'}`
  - the trader has to sign the digest, then the frontend must submit the SCOrder:
    `tx = await orderBookContract.postOrder(scOrder, signature)`
  - note that the broker address, signature, and fee, are added to the order in the backend and the returned SCOrder contains this. Optionally this can also work without broker in which case the information is also added.
  - setAllowance has to be performed on the collateral token and the proxy-contract from the frontend

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
# GitFlow

check the git flow in the GitFlow.md 