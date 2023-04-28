# Setup

To install packages run

```bash
cd packages/pnl
yarn install
```

-   Create a Postgres database and run the Postgres instance.
-   Copy `.env.example` to `.env` and edit according to to [Environment variables](#environment-variables)
-   Run the following command which will create the necessary tables in the database you created
    ```bash
    cd packages/pnl
    npx prisma migrate deploy
    ```
    the output should be: "All migrations have been successfully applied." The database should have the tables
    funding_rate_payments and trades_history.

Build the project with

```bash
yarn build
```

in directory packages/pnl.

Run the PnL service:

```bash
node ./dist/main.js
```

in directory packages/pnl.

# Profit and loss service

This directory contains the PnL service codebase. This service

Service entrypoint is `src/main.ts`

To build project:

```bash
cd packages/pnl
yarn build
```

For development:

```bash
cd packages/pnl
yarn watch
```

## Environment variables

```
DATABASE_URL - postgres DSN string
HTTP_RPC_URL - node http url
WS_RPC_URL - node wss url (for event listeners)
API_PORT - port on which the REST API will be exposed on
SDK_CONFIG_NAME=testnet
```

DATABASE_URL:

-   Create an empty postgres database my_db
-   The URL is of the form `postgresql://username:password@host:port/databaseName`, e.g., `postgresql://postgres:postgres@host:5432/my_db`
-   What port? By default, PostgreSQL runs on port number 5432. If the server is running on a different port,
    you need to find out the port number from the PostgreSQL configuration file postgresql.conf.
    You can also check the port number by running `sudo netstat -nlp | grep postgres`. This will display the active listening ports of the PostgreSQL server.

HTTP_RPC_URL, WS_RPC_URL:

-   specifify the URL of the RPC for the same network as SDK_CONFIG_NAME
-   no default for the websocket-url (application fails if not provided)
-   if left empty (HTTP_RPC_URL=""), the application will choose the default RPC provider specified in the d8x node SDK

## Profit and loss service structure

PnL service consists of:

-   Blockchain interactions code (historical data filterers and event listeners) `src/contracts`
-   Minimal express REST API for serving results from db `src/api`
-   DB layer via Prisma `src/db`

# API

## Funding Rate Payments

Example: http://localhost:8888/funding-rate-payments/0xDEDf0dd46757cE93E0D9439F78382c0c68cF76C2

## Trades History

http://localhost:8888/trades-history/0x9d5aaB428e98678d0E645ea4AeBd25f744341a05

## Discussion M&B

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
