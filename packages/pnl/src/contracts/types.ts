export type EventCallback<Event> = (
	event: Event,
	txHash: string,
	blockNumber: number
) => void;

// Trade event shape as retrieved from logs
export interface TradeEvent {
	perpetualId: bigint;
	trader: string;
	positionId: string;
	order: {
		flags: bigint;
		iPerpetualId: bigint;
		brokerFeeTbps: bigint;
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
	};
	orderDigest: string;
	newPositionSizeBC: bigint;
	price: bigint;
	fFeeCC: bigint;
	fPnlCC: bigint;
}

// Callback function for Trade events
export type TradesFilteredCb = EventCallback<TradeEvent>;

export interface LiquidateEvent {
	perpetualId: bigint; //unique perpetual id
	liquidator: string;
	trader: string;
	positionId: string;
	amountLiquidatedBC: bigint; //amount liquidated in base crrency, ABDK
	liquidationPrice: bigint; //liquidation price in quote crrency, ABDK
	newPositionSizeBC: bigint; //size after liq in base currency, ABDK
	fFeeCC: bigint; //fee in collateral currency, ABDK format
	fPnlCC: bigint; //P&L in collateral cu
}

export type LiquidationsFilteredCb = EventCallback<LiquidateEvent>;

export interface UpdateMarginAccountEvent {
	perpetualId: bigint;
	trader: string;
	positionId: string;
	fPositionBC: bigint;
	fCashCC: bigint;
	fLockedInValueQC: bigint;
	fFundingPaymentCC: bigint;
	fOpenInterestBC: bigint;
}

export type UpdateMarginAccountFilteredCb = EventCallback<UpdateMarginAccountEvent>;
