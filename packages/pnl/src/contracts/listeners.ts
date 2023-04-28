import { JsonRpcProvider, Log, Provider, ethers } from "ethers";
import { Logger } from "winston";
import { getPerpetualManagerABI } from "../utils/abi";
import {
	LiquidateEvent,
	LiquidityAddedEvent,
	LiquidityRemovedEvent,
	TradeEvent,
	UpdateMarginAccountEvent,
} from "./types";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { getPerpetualManagerABI } from "../utils/abi";
export interface EventListenerOptions {
	logger: Logger;

	// smart contract addresses which will be used to listen to incoming events
	contractAddresses: {
		perpetualManagerProxy: string;
	};

	// Private key hex
	privateKey?: string;
}

export class EventListener {
	private l: Logger;

	private opts: EventListenerOptions;

	constructor(
		opts: EventListenerOptions,
		public provider: Provider,
		private dbTrades: TradingHistory,
		private dbFundingRates: FundingRatePayments,
		private dbEstimatedEarnings: EstimatedEarnings,
		private dbPriceInfos: PriceInfo
	) {
		this.l = opts.logger;
		this.opts = opts;
	}

	/**
	 * listen starts all event listeners
	 */
	public listen() {
		this.l.info("starting smart contract event listeners", {
			contract_address: this.opts.contractAddresses.perpetualManagerProxy,
		});

		// perpertual proxy manager - main contract
		const pmp = new ethers.Contract(
			this.opts.contractAddresses.perpetualManagerProxy,
			getPerpetualManagerABI(),
			this.provider
		);

		// Trade event
		pmp.on(
			"Trade",
			async (
				perpetualId,
				trader,
				positionId,
				order,
				orderDigest,
				newPositionSizeBC,
				price,
				fFeeCC,
				fPnlCC,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got trade event", { perpetualId, trader });

				const trade: TradeEvent = {
					perpetualId,
					trader,
					positionId,
					order,
					orderDigest,
					newPositionSizeBC,
					price,
					fFeeCC,
					fPnlCC,
				};
				trade.order = (
					trade.order as unknown as ethers.Result
				).toObject() as TradeEvent["order"];

				this.dbTrades.insertTradeHistoryRecord(
					trade,
					event.log.transactionHash,
					new Date().getTime() / 1000
				);
			}
		);

		pmp.once(
			"Liquidate",
			(
				perpetualId,
				liquidator,
				trader,
				positionId,
				amountLiquidatedBC,
				liquidationPrice,
				newPositionSizeBC,
				fFeeCC,
				fPnlCC,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got liquidate event", { perpetualId, trader, liquidator });
				const liquidation: LiquidateEvent = {
					perpetualId,
					liquidator,
					trader,
					positionId,
					amountLiquidatedBC,
					liquidationPrice,
					newPositionSizeBC,
					fFeeCC,
					fPnlCC,
				};
				this.dbTrades.insertTradeHistoryRecord(
					liquidation,
					event.log.transactionHash,
					new Date().getTime() / 1000
				);
			}
		);

		pmp.once(
			"UpdateMarginAccount",
			(
				perpetualId,
				trader,
				positionId,
				fPositionBC,
				fCashCC,
				fLockedInValueQC,
				fFundingPaymentCC,
				fOpenInterestBC,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got update margin account event", {
					perpetualId,
					trader,
					positionId,
				});
				const updateMACC: UpdateMarginAccountEvent = {
					perpetualId,
					trader,
					positionId,
					fPositionBC,
					fCashCC,
					fLockedInValueQC,
					fFundingPaymentCC,
					fOpenInterestBC,
				};
				this.dbFundingRates.insertFundingRatePayment(
					updateMACC,
					event.log.transactionHash,
					new Date().getTime() / 1000
				);
			}
		);

		pmp.once(
			"LiquidityAdded",
			(
				poolId,
				user,
				tokenAmount,
				shareAmount,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got liquidity added event", {
					poolId,
					user,
				});
				const e: LiquidityAddedEvent = {
					poolId,
					user,
					tokenAmount,
					shareAmount,
				};
				this.dbEstimatedEarnings.insertLiquidityAdded(
					user,
					tokenAmount,
					poolId,
					event.log.transactionHash,
					new Date().getTime() / 1000
				);

				// Insert price info
				const price = dec18ToFloat(e.tokenAmount) / dec18ToFloat(e.shareAmount);
				this.dbPriceInfos.insert(price, poolId);
			}
		);

		pmp.once(
			"LiquidityRemoved",
			(
				poolId,
				user,
				tokenAmount,
				shareAmount,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got liquidity removed event", {
					poolId,
					user,
				});
				const e: LiquidityRemovedEvent = {
					poolId,
					user,
					tokenAmount,
					shareAmount,
				};
				this.dbEstimatedEarnings.insertLiquidityRemoved(
					user,
					tokenAmount,
					poolId,
					event.log.transactionHash,
					new Date().getTime() / 1000
				);

				// Insert price info
				const price = dec18ToFloat(e.tokenAmount) / dec18ToFloat(e.shareAmount);
				this.dbPriceInfos.insert(price, poolId);
			}
		);

		// TODO
		// pmp.once("ShareTokenP2PTransfer", () => {});
	}
}
