# Setup

You can either use documentation provided in the root README to spin up all
services with `docker compose` or refer to [Manual Setup](#manual-setup) for
setting up only PNL service manually.

Cron job setup must be done manually and is not automatically included via
docker setup. If you are using docker to spin up the services and postgres
database, make sure to adjust `DATABASE_URL` variable to match your database
credentials when installing the
[price fetcher cron job](#setting-up-the-price-fetcher-cron-job)

## Manual Setup

The following section documents how to run PNL service from source files.

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

## Setting up the price fetcher cron job

Price fetcher script `./src/price_fetcher.ts` or compiled version
`./dist/price_fetcher.js` is used to fetch the pool share token price
information. This script must be set up to run on a daily basis in order to have
up to date price info in the database.

You can use a helper script to set up a crontab entry which will run price
fetcher daily. Replace the `SDK_CONFIG_NAME` `DATABASE_URL` values according to
your setup:

```bash
SDK_CONFIG_NAME=testnet DATABASE_URL="postgresql://username:password@localhost:5432/db?schema=public" bash ./src/cron_installer.sh
```

Note that running the helper script is idempotent, and won't add same entry twice.

If you don't want to or can't use cron, alternatively you can set up any other
tool (for example supervisor) to run the price fetcher script. We recommend to
schedule it to run on a daily basis. Make sure you provide correct
`SDK_CONFIG_NAME` and `DATABASE_URL` environment variables when running price
fetcher.

Example:

```bash
SDK_CONFIG_NAME=testnet DATABASE_URL="postgresql://username:password@localhost:5432/db?schema=public" node ./dist/price_fetcher.js
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

# API Endpoints

## Funding Rate Payments

Endpoint: `/funding-rate-payments`

Query params: `user_wallet`

Example: http://localhost:8888/funding-rate-payments?user_wallet=0x9d5aab428e98678d0e645ea4aebd25f744341a05

Sample Response:

```json
[
	{
		"id": "2",
		"wallet_address": "0x9d5aab428e98678d0e645ea4aebd25f744341a05",
		"perpetual_id": "100001",
		"payment_amount": "5736060149664922",
		"payment_timestamp": "2023-04-30T23:21:54.000Z",
		"tx_hash": "0x6f9fa207f1b0874df37ef556ce5663bb8c78d0d3765c896ca70136ec5ad1335e"
	}
]
```

## Trades History

Endpoint: `/trades-history`

Query params: `user_wallet`

Example: http://localhost:8888/trades-history?user_wallet=0x9d5aab428e98678d0e645ea4aebd25f744341a05

Sample Response:

```json
[
	{
		"id": "2",
		"wallet_address": "0x9d5aab428e98678d0e645ea4aebd25f744341a05",
		"perpetual_id": "100001",
		"chain_id": 80001,
		"side": "buy",
		"order_flags": "1073741824",
		"price": "34814354995126549210201",
		"quantity": "1844674407370955160",
		"fee": "5318589376144345804",
		"realized_profit": "-5674393472287671561",
		"order_digest_hash": "0x401a854d1d5c2e74a5732d411371892e0729314c21eede515ee0df49d2cac4bc",
		"tx_hash": "0x6f9fa207f1b0874df37ef556ce5663bb8c78d0d3765c896ca70136ec5ad1335e",
		"trade_timestamp": "2023-04-30T23:21:54.000Z"
	},
	{
		"id": "1",
		"wallet_address": "0x9d5aab428e98678d0e645ea4aebd25f744341a05",
		"perpetual_id": "100001",
		"chain_id": 80001,
		"side": "buy",
		"order_flags": "1073741824",
		"price": "34917851646879323276795",
		"quantity": "1844674407370955160",
		"fee": "5318453973402102417",
		"realized_profit": "-5674189917584069793",
		"order_digest_hash": "0x59168e0544182346f87baeaf911b58cf77f47fc4adb11cd26d4ea2a51dc09537",
		"tx_hash": "0x62f8354e2c86443a162e887dc27535fe02688ec5b41a61534f8d56e55025953e",
		"trade_timestamp": "2023-04-30T23:14:08.000Z"
	}
]
```

## APY

Endpoint: `/apy`

Query params: `from_timestamp` - unix timestamp; `to_timestamp` - unix timestamp, `pool_id` - number

Example: http://localhost:8888/apy?from_timestamp=1612324439&to_timestamp=1684324439&pool_id=1

Sample Response:

```json
{
	"start_timestamp": 1641072720,
	"end_timestamp": 1684326028.306,
	"start_price": 342422,
	"end_price": 340323,
	"pool_id": "1",
	"apy": 0.004496850129718713
}
```

## Earnings

Endpoint: `/earnings`

Query params: `user_wallet`; `pool_id` - number

Example: http://localhost:8888/earnings?user_wallet=0x9d5aab428e98678d0e645ea4aebd25f744341a05&pool_id=

Sample Response:

```json
{
	"pool_id": "1",
	"user": "0x9d5aab428e98678d0e645ea4aebd25f744341a05",
	"earnings": 12007637.680452734
}
```

Note that `earnings` will be returned as decimal 18 adjusted number value.

## Open withdrawal

Endpoint: `/open-withdrawal`

Query params: `user_wallet`; `pool_id` - number

Example: http://localhost:8888/open-withdrawal?user_wallet=0x9d5aab428e98678d0e645ea4aebd25f744341a05&pool_id=

Sample Response:

```json
{
	"user_wallet": "0x9d5aab428e98678d0e645ea4aebd25f744341a05",
	"pool_id": "1",
	"withdrawals": [{ "share_amount": 1200000, "time_elapsed_sec": 907960 }]
}
```
