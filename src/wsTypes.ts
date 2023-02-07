/**
 * use this format to subscribe
 * to perpetual, e.g.,
 * {"symbol": "BTC-USD-MATIC",
 *  "traderAddress": "0x9d5a..41a05"}
 */
interface SubscriptionInterface {
  symbol: string;
  traderAddr: string;
}

/**
 * General response message layout
 */
interface WSMsg {
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
interface PriceUpdate {
  perpetualId: number;
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
interface LimitOrderCreated {
  perpetualId: number;
  traderAddr: string;
  brokerAddr: string;
  orderId: string;
}

/**
 * Trade event is sent to all
 * subscribers
 */
interface Trade {
  perpetualId: number;
  traderAddr: string;
  positionId: string;
  orderId: string;
  newPositionSizeBC: number;
  executionPrice: number;
}

// not active
// see issue #75
interface PerpetualLimitOrderCancelled {
  perpetualId: number;
  traderAddr: string;
  orderId: string;
}

/**
 * This event message is generated on
 * ExecutionFailed
 */
interface ExecutionFailed {
  perpetualId: number;
  traderAddr: string;
  orderId: string;
  reason: string;
}

/**
 * This event message is generated on
 * UpdateMarginAccount
 */
interface UpdateMarginAccount {
  perpetualId: number;
  traderAddr: string;
  positionId: string;
  positionBC: number;
  cashCC: number;
  lockedInValueQC: number;
  fundingPaymentCC: number;
}
