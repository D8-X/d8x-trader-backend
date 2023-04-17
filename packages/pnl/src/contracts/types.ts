import { BigNumberish } from "ethers";

export type EventCallback<Event> = (
	event: Event,
	txHash: string,
	blockNumber: BigNumberish
) => void;

// Trade event shape as retrieved from logs
export interface TradeEvent {
	perpetualId: BigNumberish;
	trader: string;
	positionId: string;
	order: {
		flags: BigNumberish;
		iPerpetualId: BigNumberish;
		brokerFeeTbps: BigNumberish;
		traderAddr: string;
		brokerAddr: string;
		referrerAddr: string;
		brokerSignature: string;
		fAmount: BigNumberish;
		fLimitPrice: BigNumberish;
		fTriggerPrice: BigNumberish;
		fLeverage: BigNumberish;
		iDeadline: BigNumberish;
		createdTimestamp: BigNumberish;
		submittedTimestamp: BigNumberish;
	};
	orderDigest: string;
	newPositionSizeBC: BigNumberish;
	price: BigNumberish;
	fFeeCC: BigNumberish;
	fPnlCC: BigNumberish;
}

// Callback function for Trade events
export type TradesFilteredCb = EventCallback<TradeEvent>;

export interface LiquidateEvent {
	perpetualId: BigNumberish; //unique perpetual id
	liquidator: string;
	trader: string;
	positionId: string;
	amountLiquidatedBC: BigNumberish; //amount liquidated in base crrency, ABDK
	liquidationPrice: BigNumberish; //liquidation price in quote crrency, ABDK
	newPositionSizeBC: BigNumberish; //size after liq in base currency, ABDK
	fFeeCC: BigNumberish; //fee in collateral currency, ABDK format
	fPnlCC: BigNumberish; //P&L in collateral cu
}

export type LiquidationsFilteredCb = EventCallback<LiquidateEvent>;

export interface UpdateMarginAccountEvent {
	perpetualId: BigNumberish;
	trader: string;
	positionId: string;
	fPositionBC: BigNumberish;
	fCashCC: BigNumberish;
	fLockedInValueQC: BigNumberish;
	fFundingPaymentCC: BigNumberish;
	fOpenInterestBC: BigNumberish;
}

export type UpdateMarginAccountFilteredCb = EventCallback<UpdateMarginAccountEvent>;
