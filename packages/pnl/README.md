# Setup

You can either use documentation provided in the root README to spin up all
services with `docker compose` [here](../../README.md#docker-compose-setup) or
refer to [Manual Setup](#manual-setup) for setting up only the PNL service
manually.

## Manual Setup

The following section documents how to run PNL service from the source files.

To install packages run

```bash
cd packages/pnl
yarn install
```

-   Create a Postgres database and run the Postgres instance.
-   Copy `.envExample` to `.env` and edit according to to [Environment variables](#environment-variables)
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

This directory contains the PnL service codebase. This service's entrypoint is `src/main.ts`

To build the project:

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
CHAIN_ID - corresponding to the apprropriate network
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

# API Endpoints

## Funding Rate Payments

Endpoint: `/funding-rate-payments`

Query params: `traderAddr`

Example: http://localhost:8888/funding-rate-payments?traderAddr=0x6fe871703eb23771c4016eb62140367944e8edfc

Sample Response:

```json
[
	{
		"perpetualId": 100001,
		"amount": 0.002591422437757812,
		"timestamp": "2023-04-30T23:21:54.000Z",
		"transactionHash": "0x6f9fa207f1b0874df37ef556ce5663bb8c78d0d3765c896ca70136ec5ad1335e"
	}
]
```

## Trades History

Endpoint: `/trades-history`

Query params: `traderAddr`

Example: http://localhost:8888/trades-history?traderAddr=0x6fe871703eb23771c4016eb62140367944e8edfc

Sample Response:

```json
[
	{
		"chainId": 80001,
		"perpetualId": 100001,
		"orderId": "0x401a854d1d5c2e74a5732d411371892e0729314c21eede515ee0df49d2cac4bc",
		"orderFlags": "1073741824",
		"side": "buy",
		"price": 1827.7619218467787,
		"quantity": 0.1,
		"fee": 0.26750443671354435,
		"realizedPnl": 3.513758261674475,
		"transactionHash": "0xd48fb25981434dd7c882ac6289bade191ef81f5e88466dc45ac7abb1754843f2",
		"timestamp": "2023-04-30T23:21:54.000Z"
	}
]
```

## APY

Endpoint: `/apy`

Query params: `fromTimestamp` - unix timestamp; `toTimestamp` - unix timestamp, `poolSymbol` - string

Example: http://localhost:8888/apy?fromTimestamp=1612324439&toTimestamp=1684324439&poolSymbol=USDC

Sample Response:

```json
{
	"startTimestamp": 1641072720,
	"endTimestamp": 1684326028.306,
	"startPrice": 1.0123,
	"endPrice": 1.234,
	"apy": 0.004496850129718713
}
```

## Earnings

Endpoint: `/earnings`

Query params: `lpAddr` - liquidity provider address; `poolSymbol` - string

Example: http://localhost:8888/earnings?lpAddr=0x9d5aab428e98678d0e645ea4aebd25f744341a05&poolSymbol=MATIC

Sample Response:

```json
{
	"earnings": 499914.0164721594
}
```

Note that `earnings` will be returned as decimal 18 adjusted number value.

## Open withdrawal

Endpoint: `/open-withdrawals`

Query params: `lpAddr` - liquidity provider address; `poolSymbol` - string

Example: http://localhost:8888/open-withdrawals?lpAddr=0x9d5aab428e98678d0e645ea4aebd25f744341a05&poolSymbol=MATIC

Sample Response:

```json
{
	"withdrawals": [{ "shareAmount": 1200000, "timeElapsedSec": 907960 }]
}
```
