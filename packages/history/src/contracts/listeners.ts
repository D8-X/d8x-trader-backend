import { BytesLike, Contract, WebSocketProvider, ethers } from "ethers";
import { Logger } from "winston";
import {
	LiquidateEvent,
	LiquidityAddedEvent,
	LiquidityRemovedEvent,
	LiquidityWithdrawalInitiatedEvent,
	TradeEvent,
	Order,
	UpdateMarginAccountEvent,
	P2PTransferEvent,
} from "./types";
import { TradingHistory } from "../db/trading_history";
import { FundingRatePayments } from "../db/funding_rate";
import { getPerpetualManagerABI, getShareTokenContractABI } from "../utils/abi";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { PriceInfo } from "../db/price_info";
import { dec18ToFloat, decNToFloat } from "utils";
import StaticInfo from "./static_info";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals";
export interface EventListenerOptions {
	logger: Logger;
	// smart contract addresses which will be used to listen to incoming events
	contractAddresses: {
		perpetualManagerProxy: string;
	};
	staticInfo: StaticInfo;
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
		const proxy = new ethers.Contract(
			this.opts.contractAddresses.perpetualManagerProxy,
			getPerpetualManagerABI(),
			provider
		);

		// Trade event
		proxy.on(
			"Trade",
			(
				perpetualId: number,
				trader: string,
				positionId: string,
				order: Order,
				orderDigest: string,
				newPositionSizeBC: bigint,
				price: bigint,
				fFeeCC: bigint,
				fPnlCC: bigint,
				fB2C: bigint,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got trade event", { perpetualId, trader });
				this.onTradeEvent(
					{
						perpetualId: perpetualId,
						trader: trader,
						positionId: positionId,
						order: order,
						orderDigest: orderDigest,
						newPositionSizeBC: newPositionSizeBC,
						price: price,
						fFeeCC: fFeeCC,
						fPnlCC: fPnlCC,
						fB2C: fB2C,
					},
					event.log.transactionHash,
					Math.round(new Date().getTime() / 1000)
				);
			}
		);

		proxy.on(
			"Liquidate",
			(
				perpetualId: number,
				liquidator: string,
				trader: string,
				positionId: string,
				amountLiquidatedBC: bigint,
				liquidationPrice: bigint,
				newPositionSizeBC: bigint,
				fFeeCC: bigint,
				fPnlCC: bigint,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got liquidate event", { perpetualId, trader, liquidator });
				this.onLiquidate(
					{
						perpetualId: perpetualId,
						liquidator: liquidator,
						trader: trader,
						positionId: positionId,
						amountLiquidatedBC: amountLiquidatedBC,
						liquidationPrice: liquidationPrice,
						newPositionSizeBC: newPositionSizeBC,
						fFeeCC: fFeeCC,
						fPnlCC: fPnlCC,
					},
					event.log.transactionHash,
					Math.round(new Date().getTime() / 1000)
				);
			}
		);

		proxy.on(
			"UpdateMarginAccount",
			(
				perpetualId: number,
				trader: string,
				positionId: string,
				fPositionBC: bigint,
				fCashCC: bigint,
				fLockedInValueQC: bigint,
				fFundingPaymentCC: bigint,
				fOpenInterestBC: bigint,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got update margin account event", {
					perpetualId,
					trader,
					positionId,
				});
				this.onUpdateMarginAccount(
					{
						perpetualId: perpetualId,
						trader: trader,
						positionId: positionId,
						fPositionBC: fPositionBC,
						fCashCC: fCashCC,
						fLockedInValueQC: fLockedInValueQC,
						fFundingPaymentCC: fFundingPaymentCC,
						fOpenInterestBC: fOpenInterestBC,
					},
					event.log.transactionHash,
					Math.round(new Date().getTime() / 1000)
				);
			}
		);

		proxy.on(
			"LiquidityAdded",
			(
				poolId: bigint,
				user: string,
				tokenAmount: bigint,
				shareAmount: bigint,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got liquidity added event", {
					poolId,
					user,
				});
				this.onLiquidityAdded(
					{
						poolId: poolId,
						user: user,
						tokenAmount: tokenAmount,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					true,
					Math.round(new Date().getTime() / 1000)
				);
			}
		);

		proxy.on(
			"LiquidityRemoved",
			(
				poolId: bigint,
				user: string,
				tokenAmount: bigint,
				shareAmount: bigint,
				event: ethers.ContractEventPayload
			) => {
				this.l.info("got liquidity removed event", {
					poolId,
					user,
				});
				this.onLiquidityRemoved(
					{
						poolId: poolId,
						user: user,
						tokenAmount: tokenAmount,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					true,
					Math.round(new Date().getTime() / 1000)
				);
			}
		);

		// List to token transfers for all share token contracts
		const abi = await getShareTokenContractABI();
		const shareTokenContracts = this.opts.staticInfo.retrieveShareTokenContracts();
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
					this.onP2PTransfer(
						{ from: from, to: to, amountD18: amountD18, priceD18: priceD18 },
						poolId,
						event.log.transactionHash,
						true,
						Math.round(new Date().getTime() / 1000)
					);
				}
			);
		}

		this.l.info("starting liquidity withdrawal initiated events listener");
		proxy.on(
			"LiquidityWithdrawalInitiated",
			(
				poolId: bigint,
				user: string,
				shareAmount: bigint,
				event: ethers.ContractEventPayload
			) =>
				this.onLiquidityWithdrawalInitiated(
					{
						poolId: Number(poolId.toString()),
						user: user,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					Math.round(new Date().getTime() / 1000)
				)
		);
	}

	public async onP2PTransfer(
		eventData: P2PTransferEvent,
		poolId: number,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number
	) {
		this.dbEstimatedEarnings.insertShareTokenP2PTransfer(
			eventData,
			poolId,
			txHash,
			isCollectedByEvent,
			timestampSec
		);
	}

	public async onTradeEvent(
		eventData: TradeEvent,
		txHash: string,
		timestampSec: number
	) {
		this.dbTrades.insertTradeHistoryRecord(eventData, txHash, timestampSec);
	}

	public async onLiquidate(
		eventData: LiquidateEvent,
		txHash: string,
		timestampSec: number
	) {
		this.dbTrades.insertTradeHistoryRecord(eventData, txHash, timestampSec);
	}

	public async onUpdateMarginAccount(
		eventData: UpdateMarginAccountEvent,
		txHash: string,
		timestampSec: number
	) {
		this.dbFundingRates.insertFundingRatePayment(eventData, txHash, timestampSec);
	}

	/**
	 * Listener is called either via event or from historical data.
	 * If from historical data, timestampSec is set to the block timestamp.
	 * If from events, timestampSec is set to this timestamp
	 * @param eventData data from event
	 * @param txHash    transaction hash from event
	 * @param timestampSec timestamp in seconds for event (typically block timestamp)
	 */
	public async onLiquidityWithdrawalInitiated(
		eventData: LiquidityWithdrawalInitiatedEvent,
		txHash: string,
		timestampSec: number
	) {
		this.dbLPWithdrawals.insert(eventData, false, txHash, timestampSec);
	}

	public async onLiquidityRemoved(
		eventData: LiquidityRemovedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number
	) {
		const poolIdNum: number = Number(eventData.poolId.toString());
		this.dbEstimatedEarnings.insertLiquidityRemoved(
			eventData,
			txHash,
			isCollectedByEvent,
			timestampSec
		);

		// Insert price info
		await this._updateSharePoolTokenPriceInfo(
			Number(eventData.poolId.toString()),
			eventData.tokenAmount,
			eventData.shareAmount
		);

		// Attempt to finalize lp withdrawal
		this.dbLPWithdrawals.insert(eventData, true, txHash, timestampSec);
	}

	public async onLiquidityAdded(
		eventData: LiquidityAddedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number
	) {
		this.dbEstimatedEarnings.insertLiquidityAdded(
			eventData,
			txHash,
			isCollectedByEvent,
			timestampSec
		);
		// Insert price info
		await this._updateSharePoolTokenPriceInfo(
			Number(eventData.poolId.toString()),
			eventData.tokenAmount,
			eventData.shareAmount
		);
	}

	private async _updateSharePoolTokenPriceInfo(
		poolId: number,
		tokenAmount: bigint,
		shareAmount: bigint
	) {
		// Insert price info. Pool tokens are decimal-18
		const decimals = this.opts.staticInfo.getMarginTokenDecimals(poolId);
		const price = decNToFloat(tokenAmount, decimals) / dec18ToFloat(shareAmount);
		this.dbPriceInfos.insert(price, poolId);
	}
}
