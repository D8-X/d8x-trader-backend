# History and profit and loss service structure

This service consists of:

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
## SetOracles

We need to maintain a mapping of perpetual id -> perpetual-name, valid from, valid to,
so we can generate a new perpetual_id that includes the name (e.g. 10004-BTC-USDC-USDC)
to prevent performing queries over different perpetuals that used the same recycled
simple id.
We do this by querying the event 
`event SetOracles(uint24 indexed perpetualId, bytes4[2] baseQuoteS2, bytes4[2] baseQuoteS3);`


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
