# Profit and loss service

This directory contains the PnL service codebase. This service

Service entrypoint is `src/main.ts`

To build project:

```bash
yarn build
```

For development:

```bash
yarn watch
```

## Environment variables

```
DATABASE_URL - postgres DSN string
HTTP_RPC_URL - node http url
WS_RPC_URL - node wss url (for event listeners)
API_PORT - port on which the REST API will be exposed on
SC_ADDRESS_PERPETUAL_MANAGER_PROXY - perpetual manager proxy contract address
```

## Profit and loss service structure

PnL service consists of:

-   Blockchain interactions code (historical data filterers and event listeners) `src/contracts`
-   Minimal express REST API for serving results from db `src/api`
-   DB layer via Prisma `src/db`

## Database and migrations

PnL service uses Postgres 14+. [Prisma](https://www.prisma.io) is used for migration handling.

To run migrations for development:

```bash
npx prisma migrate dev
```

To run migrations for production:

```bash
npx prisma migrate deploy
```

# Historical data

## Description

## Discussion Mantas&Basile

    - We don't want everything upfront, but if someone searches for a wallet and it doesn't exist in our database, we need to launch some bg process which will then read the event logs of txs for that user wallet (let's say 6months in the past) and fetch the historical trades information
    - Look up at the latest timestamp for that address on startup
    - Recovery mechanism from crash of service
    - Use block timestamp when reading historical data and creating new entries
    - Events: Trade; Liquidate; UpdateMarginAccount;

### Proposed architecture

1. Functionality (code) which is able to retrieve (filter) historical logs and
   retrieve the events. This piece of code will be used either in pnl service or
   in another background process which will receive messages from the API or #3
   and start processing historical data. `src/contracts/historical.ts`
   (HistoricalDataFilterer)

    - Specify the timestamp how much back in the past we want to start
      retrieving the event logs. Based on the timestamp we calculate the block
      from which we start
    - Event specific params: user wallet address (must be indexed)

2. DB layer. Database layer is built with prisma. We inject the functionality
   into the callbacks for HistoricalDataFilterer. From there db layer
   functionality checks if given events should be inserted into db or not

    - Check the order hashes, block times, amounts to avoid duplication in db

3. Missing data checker (Something sitting between the API and
   HistoricalDataFilterer or called up upon restart of pnl service). Checks
   latest data available in database for given wallets and starts retrieving and
   processing data (via #1) if needed. Notification to check the wallet address
   data could be implemented as a RPC/HTTP call to pnl service via middleware or
   handler of REST API (providing the wallet address in question).

# TODO

[x] Historical data

    - Log filterer (HistoricalDataFilterer)
    - Db layer for upserting event data into db
    - Missing data

[] Contract event listeners
[x] DB functionality with prisma
[] REST Api with express

-- April 20th
[x] Filter events at the startup (from last timestamp of most last event data)
[x] Don't filter based on address
[x] On handlers we don't load anything
[x] Start the event listeners and process them
[] Check for filtering without fetching all logs
--
[x] Check the bigint toString conversion (we don't want to have E notation)

---

[] Block-time is hard-coded to 15 seconds
[] ABI (PerpetualManagerProxy.json) is copied into environment but must come from SDK
