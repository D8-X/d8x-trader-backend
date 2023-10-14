# d8x-trader-backend

The entire backend for the D8X Perpetuals trading frontend package consists of

- this backend code - lerna monorepo consisting of a two services (history; api;)
- candle stick chart server: [https://github.com/D8-X/d8x-candles](https://github.com/D8-X/d8x-candles)
- broker server: [https://github.com/D8-X/d8x-broker-server](https://github.com/D8-X/d8x-broker-server)
- [optional] a price server that provides Pyth off-chain oracle prices

The services can be setup with our [command line interface tool](https://github.com/D8-X/d8x-cli)

There must be one backend per chain-id.

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
