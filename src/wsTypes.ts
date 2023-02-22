/**
 * use this format to subscribe
 * to perpetual, e.g.,
 * {"symbol": "BTC-USD-MATIC",
 *  "traderAddress": "0x9d5a..41a05"}
 */
export interface SubscriptionInterface {
  symbol: string;
  traderAddr: string;
}

/**
 * General response message layout
 */
export interface WSMsg {
  name: string;
  obj: Object;
}

/**
 * This message is issued on
 * UpdateMarkPrice but also contains
 * the fundingRate and openInterest
 * collected in other events
 * (those can be zero if the data
 * has not been collected yet)
 */
export interface PriceUpdate {
  perpetualId: number;
  symbol: string;
  midPrice: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  openInterest: number;
}

/**
 * Whenever an order is created
 * (market/limit/stop/...) this
 * message is issued
 */
export interface LimitOrderCreated {
  perpetualId: number;
  symbol: string;
  traderAddr: string;
  brokerAddr: string;
  orderId: string;
}

/**
 * Trade event is sent to all
 * subscribers
 */
export interface Trade {
  perpetualId: number;
  symbol: string;
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

// not active
// see issue #75
export interface PerpetualLimitOrderCancelled {
  perpetualId: number;
  symbol: string;
  traderAddr: string;
  orderId: string;
}

/**
 * This event message is generated on
 * ExecutionFailed
 */
export interface ExecutionFailed {
  perpetualId: number;
  symbol: string;
  traderAddr: string;
  orderId: string;
  reason: string;
}

/**
 * This event message is generated on
 * UpdateMarginAccount
 * You may want to call positionRisk
 * after this event was executed
 */
export interface UpdateMarginAccount {
  perpetualId: number;
  symbol: string;
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

/**
 * Interface for websocket client to stream
 * oracle price data to this backend
 * The application will stream WebsocketClientConfig[]
 * as defined in the config.
 * Per stream we can have several potential websockets
 */
export interface WebsocketClientConfig {
  chainId: number;
  streamName: string; //chainId & name must be unique
  tickers: string[]; // tickers that we can get from all endpoints below
  wsEndpoints: string[]; // array of endpoints of the form "ws://<ip>:<port>"
}
