# Main API

## Response Format

```
{ type: "error"| <endpointName> | "connect" | "subscription",
  msg: <endpointName If Error> | "" | <info about connection>,
  data:  "" | <json-object>
}
```

## All GET endpoints

<details>
<summary>List with example parameters</summary>

-   `/exchange-info` (no parameters): Exchange information, including all pools and perpetuals
-   `/perpetual-static-info?symbol=ETH-USD-MATIC`: Static data about a perpetual
-   `/open-orders?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`: All open orders of a trader in a perpetual
-   `/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC-USD-MATIC`: Current state of a trader's account in a perpetual
-   `/trading-fee?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&poolSymbol=MATIC` : Fee including broker fee in tbps (1e-5)
-   `/add-collateral?symbol=MATIC-USD-MATIC&amount=100`: Data needed to deposit collateral via direct smart contract interaction: perpetual Id, proxy contract address, 'deposit' method ABI, price updates, and HEX-encoded amount
-   `/remove-collateral?symbol=MATIC-USD-MATIC&amount=100`: Data needed to withdraw collateral via direct smart contract interaction: perpetual Id, proxy contract address, 'withdraw' method ABI, price updates, and HEX-encoded amount
-   `/available-margin?symbol=MATIC-USD-MATIC&traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05`: Maximum amount that can be removed from a trader's account
-   `/cancel-order?symbol=MATIC-USD-MATIC&orderId=0x433cd04c5e9703890d5aa72d90980b90bfde5b087075293abd679a067780629d`: Data needed to cancel a given order via direct smrt contract interaction: order book contract address, 'cancelOrder' method ABI, price updates, and digest to sign by the trader who posted this order

</details>

## All POST endpoints

If the frontend wants to submit a trade for a trader, it sends the trade-struct
to the `/order-digest` endpoint using a POST request. The back-end takes care of
the broker fee, signature, and address, and responds with an order-struct that is ready
to be submitted to the contract. The response also contains the contract address of the
order-book that accepts this order. The trader needs to sign the data 'digest' and
then the frontend can submit it.

<details>

-   `/order-digest`:
    -   parameters `{ orders: [order1, order2], traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05 }`, see test/post.test.ts
    -   returns `{digests: ['hash1 which has to be signed', 'hash2 which has to be signed'], ids: ['id 1', 'id 2'], OrderBookAddr: 'address of relevant order book', SCOrders: ['Smart-Contract Order 1',  'Smart-Contract Order 2']}`
    -   the trader has to sign the digest, then the frontend must submit the SCOrder:
        `tx = await orderBookContract.postOrder(scOrder, signature)`
    -   note that the broker address, signature, and fee, are added to the order in the backend and the returned SCOrder contains this. Optionally this can also work without broker in which case the information is also added.
    -   more than one order can be submitted, but they must have the same symbol and correspond to the same trader
    -   setAllowance has to be performed on the collateral token and the proxy-contract from the frontend
-   `/position-risk-on-collateral-action`:
    -   parameters `{ traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05, amount: -100, positionRisk: 'Margin account struct' }`, see test/post.test.ts
    -   returns `{newPositionRisk: 'MarginAccount type', availableMargin: number}` - `newPositionRisk` is what the given trader's positionRisk would look like if the given order is executed - `availableMargin` is the maximum amount of margin that can be withdrawn from this account
    </details>

# Websocket

The frontend subscribes to perpetuals and trader addresses. Some messages
are trader-address specific, some are broadcasted (indicated below).

-   endpoint `ws://localhost:8080`
-   subscribe by sending a JSON message in the following format:

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

-   all messages received are defined in [src/wsTypes](/src/wsTypes) and listed below
-   the general format of the messages is

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

-   Objects are built from the following interfaces

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

# Development: Run Local Instance

-   Copy envExample into .env
-   Redis needs to run with the configured password (.env), for example
    ```
    docker run -d --name redis-stack -p 6379:6379 -e REDIS_ARGS="--requirepass myfAncyPassword" redis/redis-stack-server:latest
    ```
-   Navigate to the code directoy and run the application, for example via ts-node

    ```
    cd packages/api/src
    ts-node index.ts
    ```
