# d8x-trader-backend

The entire backend for the D8X Perpetuals trading frontend package consists of

- this backend code - lerna monorepo consisting of a few services (history; api;
  pxws-client) read [here](#d8x-trader-backend-services) to find out more about the services.
- candle stick chart server: https://github.com/D8-X/candleD8
- a price server that provides Pyth off-chain oracle prices

The services run over http/ws and we propose to install a reverse proxy on
the servers so the traffic can flow via https/wss.

There must be one backend per chain-id.

Here is a [guide on how to set up the backend](README_SETUP.md). See also https://repeated-pink-afb.notion.site/D8X-Broker-Howto-b51acf693edb42608098c297e2ce6c98.
Click [here](README_DEV.md) for some further comments directed towards developers

# d8x-trader-backend services

These are the services provided in this repository:

- Main/Trading service `packages/api`  - handles everything related to trading (getting trade relevant data, posting trade relevant data). See [here](./packages/api/README.md) for API and WS specification.
- Historical data service `packages/history` - services that allow showing trade and funding payment historical data to users. See [here](./packages/history/README.md) for API specification.
- Referral service `packages/referral` - handles a 2-layered KOL referral service. See [here](./packages/referral/referral/README_API.md) for API specification.
- Pyth price connector service `packages/pxws-client` - provides price feeds from Pyth. See [here](./packages/referral/README.md).

# Frontend Configuration

The Frontend package is tightly linked to these services, and the way it connects with them is configured entirely via environment variables in that project. Once you know on which URLs these API and Websocket services are hosted, they can be connected to the FE by specifying the following environment variables:

- REACT_APP_API_URL: A semicolon separated list of endpoints served by the main REST API service.
  - For example, you could be hosting two main API services, one at `https://api.mybackend.com` for Polygon zkEVM (chain ID 1101) and one at `https://api.test.mybackend.com` for Polygon zkEVM Testnet (chain ID 1442).
  - You must also define a default chain for your frontend, in this example it's Mainnet
  - This entry should then take the form:
    `REACT_APP_API_URL=1101::https://api.mybackend.com;1442::https://api.test.mybackend.com;default::https://api.mybackend.com`
- REACT_APP_HISTORY_URL: A semicolon separated list of endpoints served by the History API service.
  - In line with the example above, you may be hosting the frontend on two different networks, Polyon zkEVM and Polygon zkEVM Testnet as before, using URLS `https://history.mybackend.com` and `https://history.test.mybackend.com`, respectively
  - Then you would define
    `REACT_APP_HISTORY_URL=137::https://history.mybackend.com;1442::https://history.test.mybackend.com;default::https://history.mybackend.com`
- REACT_APP_WEBSOCKET_URL: A semicolon separated list of endpoints served by the price Websocket service.
  - For example, you may be hosting `wss://ws.mybackend.com` for Polygon zkEVM and `wss://ws.test.mybackend.com` for Polygon zkEVM Testnet.
  - Then you would set this variable as
    `REACT_APP_WEBSOCKET_URL=137::wss://ws.mybackend.com/;1442::wss://ws.test.mybackend.com/;default::wss://ws.mybackend.com/`
- REACT_APP_CANDLES_WEBSOCKET_URL: The URL of the candles service, hosted on a different server.
  - This service can be shared by different chains, but it adheres to the same notation as the previous two. If you are hosting this service at `wss://candles.mybackend.com`, then you would set this variable as
    `REACT_APP_CANDLES_WEBSOCKET_URL=default::wss://candles.mybackend.com/`
