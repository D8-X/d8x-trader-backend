import { MarginAccount } from "@d8x/perpetuals-sdk";

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
export interface MarginAccount {
  symbol: string;
  positionNotionalBaseCCY: number;
  side: string;
  entryPrice: number;
  leverage: number;
  markPrice: number;
  unrealizedPnlQuoteCCY: number;
  unrealizedFundingCollateralCCY: number;
  collateralCC: number;
  liquidationPrice: [number, number | undefined];
  liquidationLvg: number;
  collToQuoteConversion: number;
}
 */

/**
 * This event message is generated on
 * UpdateMarginAccount
 * You may want to call positionRisk
 * after this event was executed
 */
export interface UpdateMarginAccount extends MarginAccount {
	// id of the perpetual
	perpetualId: number;
	// address of the trader
	traderAddr: string;
	// funding payment paid when
	// margin account was changed
	fundingPaymentCC: number;
}

/**
 * Trimmed down version of UpdateMarginAccount for relaying the event to
 * frontend. Frontend collects most of the additional data it needs.
 */
export interface UpdateMarginAccountTrimmed {
	// address of the trader - the only required field
	traderAddr: string;
	// id of the perpetual
	perpetualId?: number;
	// perpetual symbol
	symbol?: string;
	// funding payment paid when
	// margin account was changed
	fundingPaymentCC?: number;

	markPrice?: number;
	unrealizedFundingCollateralCCY?: number;
	collToQuoteConversion?: number;
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
	type: string; // source used by the underlying price service, usually "pyth"
	tickers: string[]; // tickers that we can get from all endpoints below
	feedIds: Array<[string, string]>; //tickername tickerid
	httpEndpoints: string[]; // array of endpoints of the form "http://<ip>:<port>"
	wsEndpoints: string[]; // array of endpoints of the form "ws://<ip>:<port>"
}

export interface RPCConfig {
	chainId: number;
	HTTP: string[];
	WS: string[];
}
