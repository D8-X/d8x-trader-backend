# d8x-trader-backend

# Prerequisits

- install Redis: https://redis.io/docs/getting-started/installation/install-redis-on-linux/
- node (used v18.14.0 for testing)
- yarn

# Buidl and run backend

- optional: re-define the port in `.env`, e.g., 3000 (using 30001 below)
- npm run build
- npm run start
- http://localhost:3001/

# Endpoints Examples

base url: `http://localhost:3001/`

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

- `/orderDigest`:
  - parameters `{ order: order, orderId: orderId, traderAddr: 0x9d5aaB428e98678d0E645ea4AeBd25f744341a05 }`, see test/post.test.ts
  - returns `{digest: 'hash which has to be signed', OrderBookAddr: 'address of relevant order book', SCOrder: 'Smart-Contract Order type'}`
  - the trader has to sign the digest, then the frontend must submit the SCOrder:
    `tx = await orderBookContract.postOrder(scOrder, signature)`
  - note that the broker address, signature, and fee, are added to the order in the backend and the returned SCOrder contains this. Optionally this can also work without broker in which case the information is also added.
  - setAllowance has to be performed on the collateral token and the proxy-contract from the frontend

Swagger (incomplete): http://localhost:3001/api/docs/
