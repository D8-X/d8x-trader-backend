export type EventCallback<Event, Params = any> = (
	event: Event,
	txHash: string,
	blockNumber: number,
	blockTimestamp: number,
	params?: Params
) => void;

// Trade event shape as retrieved from logs
// topic hash 0xcae6abbbeb6085c86dba93ff60c0913157ef0adb7bbc1da47d768f95d9147341
export interface TradeEvent {
	perpetualId: number;
	trader: string;
	positionId: string;
	order: Order;
	orderDigest: string;
	newPositionSizeBC: bigint;
	price: bigint;
	fFeeCC: bigint;
	fPnlCC: bigint;
	fB2C: bigint;
}

export interface Order {
	flags: bigint;
	iPerpetualId: number;
	brokerFeeTbps: number;
	traderAddr: string;
	brokerAddr: string;
	referrerAddr: string;
	brokerSignature: string;
	fAmount: bigint;
	fLimitPrice: bigint;
	fTriggerPrice: bigint;
	fLeverage: bigint;
	iDeadline: bigint;
	createdTimestamp: bigint;
	submittedTimestamp: bigint;
}

// Callback function for Trade events
export type TradesFilteredCb = EventCallback<TradeEvent>;

export interface LiquidateEvent {
	perpetualId: number; //unique perpetual id
	liquidator: string;
	trader: string;
	positionId: string;
	amountLiquidatedBC: bigint; //amount liquidated in base currency, ABDK
	liquidationPrice: bigint; //liquidation price in quote currency, ABDK
	newPositionSizeBC: bigint; //size after liq in base currency, ABDK
	fFeeCC: bigint; //fee in collateral currency, ABDK format
	fPnlCC: bigint; //P&L in collateral cu
}

export type LiquidationsFilteredCb = EventCallback<LiquidateEvent>;

export interface UpdateMarginAccountEvent {
	perpetualId: number;
	trader: string;
	positionId: string;
	fPositionBC: bigint;
	fCashCC: bigint;
	fLockedInValueQC: bigint;
	fFundingPaymentCC: bigint;
	fOpenInterestBC: bigint;
}

export type UpdateMarginAccountFilteredCb = EventCallback<UpdateMarginAccountEvent>;

export interface LiquidityAddedEvent {
	poolId: bigint;
	user: string;
	tokenAmount: bigint;
	shareAmount: bigint;
}

export type LiquidityAddedFilteredCb = EventCallback<LiquidityAddedEvent>;

export interface LiquidityRemovedEvent {
	poolId: bigint;
	user: string;
	tokenAmount: bigint;
	shareAmount: bigint;
}

export type LiquidityRemovedFilteredCb = EventCallback<LiquidityRemovedEvent>;

export interface P2PTransferEvent {
	from: string;
	to: string;
	amountD18: bigint; // share token amount
	priceD18: bigint;
}
export type P2PTransferFilteredCb = EventCallback<P2PTransferEvent, { poolId: number }>;

export interface LiquidityWithdrawalInitiatedEvent {
	poolId: number;
	user: string;
	shareAmount: bigint;
}
export type LiquidityWithdrawalInitiatedFilteredCb =
	EventCallback<LiquidityWithdrawalInitiatedEvent>;
