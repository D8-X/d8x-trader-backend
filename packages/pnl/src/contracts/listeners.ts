import { Contract, WebSocketProvider, ethers } from "ethers";
import { Logger } from "winston";
import {
	LiquidateEvent,
	LiquidityAddedEvent,
	LiquidityRemovedEvent,
	LiquidityWithdrawalInitiated,
	TradeEvent,
	UpdateMarginAccountEvent,
} from "./types";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { getPerpetualManagerABI, getShareTokenContractABI } from "../utils/abi";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { PriceInfo } from "../db/price_info";
import { dec18ToFloat } from "utils";
import { retrieveShareTokenContracts } from "./tokens";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals";
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
	private blockNumber: number = Infinity;
	private provider: WebSocketProvider | undefined;
	private opts: EventListenerOptions;

	constructor(
		opts: EventListenerOptions,
		// public provider: WebSocketProvider,
		private dbTrades: TradingHistory,
		private dbFundingRates: FundingRatePayments,
		private dbEstimatedEarnings: EstimatedEarnings,
		private dbPriceInfos: PriceInfo,
		private dbLPWithdrawals: LiquidityWithdrawals
	) {
		this.l = opts.logger;
		this.opts = opts;
	}

	public checkHeartbeat(latestBlock: number) {
		const isAlive = this.blockNumber + 1 >= latestBlock; // allow one block behind

		this.l.info(
			`${new Date(Date.now()).toISOString()}: ws=${
				this.blockNumber
			}, http=${latestBlock}`
		);
		if (!isAlive) {
			this.l.error(
				`${new Date(Date.now()).toISOString()}: websocket connection ended`
			);
			process.exit(1);
		}
		return true;
	}

	/**
	 * listen starts all event listeners
	 */
	public async listen(provider: WebSocketProvider) {
		if (this.provider) {
			await this.provider.removeAllListeners();
		}

		this.provider = provider;

		this.l.info("starting smart contract event listeners", {
			contract_address: this.opts.contractAddresses.perpetualManagerProxy,
		});

		provider.on("block", (blockNumber) => {
			this.blockNumber = blockNumber;
		});

		// perpertual proxy manager - main contract
		const pmp = new ethers.Contract(
			this.opts.contractAddresses.perpetualManagerProxy,
			getPerpetualManagerABI(),
			provider
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

		pmp.on(
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

		pmp.on(
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

		pmp.on(
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

		pmp.on(
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
				const [txHash, timestamp] = [
					event.log.transactionHash,
					new Date().getTime() / 1000,
				];
				this.dbEstimatedEarnings.insertLiquidityRemoved(
					user,
					tokenAmount,
					poolId,
					txHash,
					timestamp
				);

				// Insert price info
				const price = dec18ToFloat(e.tokenAmount) / dec18ToFloat(e.shareAmount);
				this.dbPriceInfos.insert(price, poolId);

				// Attempt to finalize lp withdrawal
				this.dbLPWithdrawals.insert(e, true, txHash, timestamp);
			}
		);

		// List to token transfers for all share token contracts
		const abi = await getShareTokenContractABI();
		const shareTokenContracts = await retrieveShareTokenContracts();
		for (let i = 0; i < shareTokenContracts.length; i++) {
			const c = new Contract(shareTokenContracts[i], abi, provider);
			const poolId = i + 1;

			this.l.info("starting share token P2PTransfer listener", {
				share_token_contract: shareTokenContracts[i],
			});
			c.on(
				"P2PTransfer",
				(
					from: string,
					to: string,
					amountD18: bigint,
					priceD18: bigint,
					event: ethers.ContractEventPayload
				) => {
					this.dbEstimatedEarnings.insertShareTokenP2PTransfer(
						from,
						to,
						amountD18,
						priceD18,
						poolId,
						event.log.transactionHash,
						new Date().getTime() / 1000
					);
				}
			);
		}

		pmp.on(
			"LiquidityWithdrawalInitiated",
			async (
				poolId: number,
				user: string,
				shareAmount: bigint,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("starting liquidity withdrawal initiated events listener");

				const e: LiquidityWithdrawalInitiated = {
					poolId,
					user,
					shareAmount,
				};

				this.dbLPWithdrawals.insert(
					e,
					false,
					event.log.transactionHash,
					new Date().getTime() / 1000
				);
			}
		);
	}
}
