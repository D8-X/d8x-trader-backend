import { Contract, JsonRpcProvider, WebSocketProvider, ethers } from "ethers";
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
	ListeningMode,
	SetOraclesEvent,
	SettleEvent,
	TokensDepositedEvent,
	TokensWithdrawnEvent,
} from "./types.js";
import { TradingHistory } from "../db/trading_history.js";
import { SetOracles } from "../db/set_oracles.js";
import { FundingRatePayments } from "../db/funding_rate.js";
import { getPerpetualManagerABI, getShareTokenContractABI } from "../utils/abi.js";
import { EstimatedEarnings } from "../db/estimated_earnings.js";
import { PriceInfo } from "../db/price_info.js";
import { dec18ToFloat, decNToFloat } from "utils";
import StaticInfo from "./static_info.js";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals.js";
import { SettleHistory } from "../db/settle_history.js";
import { TokenFlow } from "../db/token_flow.js";
import { metrics } from "../svc/metrics.js";
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
	private provider: WebSocketProvider | JsonRpcProvider | undefined;
	private opts: EventListenerOptions;
	private lastEventTs: number;
	public listeningMode: ListeningMode;
	private blockTsCache: Map<number, number> = new Map();

	constructor(
		opts: EventListenerOptions,
		// public provider: WebSocketProvider,
		private dbTrades: TradingHistory,
		private dbFundingRates: FundingRatePayments,
		private dbEstimatedEarnings: EstimatedEarnings,
		private dbPriceInfos: PriceInfo,
		private dbLPWithdrawals: LiquidityWithdrawals,
		private dbSetOracles: SetOracles,
		private dbSettle: SettleHistory,
		private dbTokenFlow: TokenFlow,
	) {
		this.l = opts.logger;
		this.opts = opts;
		this.lastEventTs = Date.now();
		this.listeningMode = ListeningMode.WS;
	}

	/**
	 * Get the block timestamp for an event, using a cache to avoid redundant
	 * RPC calls for events in the same block. Retries up to 3 times on failure.
	 * Returns undefined if all retries fail. caller should skip the event
	 * and let the backfill pick it up later with the correct timestamp.
	 * @param event the event to get the block timestamp for
	 * @returns the block timestamp in seconds, or undefined if it fails to get it
	 */
	private async getBlockTs(
		event: ethers.ContractEventPayload,
	): Promise<number | undefined> {
		if (!event?.log?.blockNumber) {
			this.l.warn("getBlockTs: event.log.blockNumber is undefined", {
				eventKeys: event ? Object.keys(event) : "null",
			});
			return undefined;
		}
		const blockNum = event.log.blockNumber;
		const cached = this.blockTsCache.get(blockNum);
		if (cached !== undefined) {
			return cached;
		}
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const block = await event.getBlock();
				if (this.blockTsCache.size > 200) {
					this.blockTsCache.clear();
				}
				this.blockTsCache.set(blockNum, block.timestamp);
				return block.timestamp;
			} catch (e) {
				this.l.warn(`getBlockTs attempt ${attempt + 1}/3 failed`, {
					blockNumber: blockNum,
					error: e,
				});
				if (attempt < 2) {
					await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
				}
			}
		}
		this.l.error("getBlockTs failed after 3 retries, skipping event", {
			blockNumber: blockNum,
			txHash: event.log.transactionHash,
		});
		return undefined;
	}

	/**
	 * Checks if the listener is still receiving events by comparing the current time with the timestamp of the last received event.
	 * If the difference exceeds the specified maximum delay, it logs that the connection has ended and returns false; otherwise, it returns true.
	 * @param maxDelaySec the maximum acceptable delay in seconds since the last received event before considering the listener to be not alive
	 * @returns boolean indicating whether the listener is still receiving events within the acceptable delay threshold
	 */
	public checkHeartbeat(maxDelaySec: number) {
		const nowTs = Date.now();
		const secSinceEvt = Math.round((nowTs - this.lastEventTs) / 1000);
		const isAlive = secSinceEvt < maxDelaySec;

		this.l.info(
			`last ${this.listeningMode} block=${this.blockNumber}, seconds since last event =${secSinceEvt}`,
		);
		if (!isAlive) {
			this.l.info(`${this.listeningMode} connection ended`);
			return false;
		}
		return true;
	}

	/**
	 * listen starts all event listeners
	 * @param provider	the provider to listen to events from, can be either WebSocketProvider or JsonRpcProvider.
	 * @remark If a provider was previously set, it removes all listeners from the old provider before setting up the new one.
	 */
	public async listen(provider: WebSocketProvider | JsonRpcProvider) {
		if (this.provider) {
			try {
				await this.provider.removeAllListeners();
			} catch (e) {
				this.l.warn("failed to remove listeners from previous provider", {
					error: e,
				});
			}
		}
		const IS_COLLECTED_BY_EVENT = true;
		this.provider = provider;
		this.listeningMode =
			provider instanceof WebSocketProvider ? ListeningMode.WS : ListeningMode.HTTP;

		this.l.info(
			`starting smart contract event listeners on ${this.listeningMode} provider`,
			{
				contract_address: this.opts.contractAddresses.perpetualManagerProxy,
			},
		);

		metrics.connection = this.listeningMode;
		provider.on("block", (blockNumber) => {
			this.lastEventTs = Date.now();
			this.blockNumber = blockNumber;
			metrics.lastBlock = blockNumber;
		});

		// perpertual proxy manager - main contract
		const proxy = new ethers.Contract(
			this.opts.contractAddresses.perpetualManagerProxy,
			getPerpetualManagerABI(),
			provider,
		);

		// Order book, oracle factory changes
		proxy.on(
			"TransferAddressTo",
			(module: string, oldAddress: string, newAddress: string) => {
				this.l.info("restart", { module, oldAddress, newAddress });
				process.exit(1);
			},
		);

		proxy.on(
			"TokensWithdrawn",
			async (
				perpetualId: number,
				trader: string,
				amount: bigint,
				event: ethers.ContractEventPayload,
			) => {
				const topic = event.log.topics[0];
				this.l.info("got withdraw event", { perpetualId, trader, topic });
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onTokensWithdrawnEvent(
					{
						perpetualId: perpetualId,
						trader: trader,
						amountCC: amount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
				);
			},
		);

		proxy.on(
			"TokensDeposited",
			async (
				perpetualId: number,
				trader: string,
				amount: bigint,
				event: ethers.ContractEventPayload,
			) => {
				const topic = event.log.topics[0];
				this.l.info("got deposit event", { perpetualId, trader, topic });
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onTokensDepositedEvent(
					{
						perpetualId: perpetualId,
						trader: trader,
						amountCC: amount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
				);
			},
		);

		proxy.on(
			"SettleV2",
			async (
				perpetualId: number,
				trader: string,
				amount: bigint,
				cash: bigint,
				event: ethers.ContractEventPayload,
			) => {
				const topic = event.log.topics[0];
				this.l.info("got settle event V2", { perpetualId, trader, topic });
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onSettleEvent(
					{
						perpetualId: perpetualId,
						trader: trader,
						amount: amount,
						cash: cash,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
				);
			},
		);

		if (proxy.filters["Settle"]) {
			proxy.on(
				"Settle",
				async (
					perpetualId: number,
					trader: string,
					amount: bigint,
					event: ethers.ContractEventPayload,
				) => {
					const topic = event.log.topics[0];
					this.l.info("got settle event V1", { perpetualId, trader, topic });
					const ts = await this.getBlockTs(event);
					if (ts === undefined) return;
					this.onSettleEvent(
						{
							perpetualId: perpetualId,
							trader: trader,
							amount: amount,
							cash: 0n,
						},
						event.log.transactionHash,
						IS_COLLECTED_BY_EVENT,
						ts,
					);
				},
			);
		}

		// Trade event
		proxy.on(
			"Trade",
			async (
				perpetualId: number,
				trader: string,
				order: Order,
				orderDigest: string,
				newPositionSizeBC: bigint,
				price: bigint,
				fFeeCC: bigint,
				fPnlCC: bigint,
				fB2C: bigint,
				event: ethers.ContractEventPayload,
			) => {
				const topic = event.log.topics[0];
				this.l.info("got trade event", { perpetualId, trader, topic });
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onTradeEvent(
					{
						perpetualId: perpetualId,
						trader: trader,
						order: order,
						orderDigest: orderDigest,
						newPositionSizeBC: newPositionSizeBC,
						price: price,
						fFeeCC: fFeeCC,
						fPnlCC: fPnlCC,
						fB2C: fB2C,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
					event.log.blockNumber,
				);
			},
		);

		// SetOracles event
		proxy.on(
			"SetOracles",
			async (
				perpetualId: number,
				baseQuoteS2: string[],
				baseQuoteS3: string[],
				event: ethers.ContractEventPayload,
			) => {
				const topic = event.log.topics[0];
				this.l.info("got SetOracles event", { perpetualId, topic });
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onSetOracleEvent(
					{
						perpetualId: perpetualId,
						baseQuoteS2: baseQuoteS2,
						baseQuoteS3: baseQuoteS3,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
					event.log.blockNumber,
				);
			},
		);

		proxy.on(
			"Liquidate",
			async (
				perpetualId: number,
				liquidator: string,
				trader: string,
				amountLiquidatedBC: bigint,
				liquidationPrice: bigint,
				newPositionSizeBC: bigint,
				fFeeCC: bigint,
				fPnlCC: bigint,
				event: ethers.ContractEventPayload,
			) => {
				this.l.info("got liquidate event", { perpetualId, trader, liquidator });
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onLiquidate(
					{
						perpetualId: perpetualId,
						liquidator: liquidator,
						trader: trader,
						amountLiquidatedBC: amountLiquidatedBC,
						liquidationPrice: liquidationPrice,
						newPositionSizeBC: newPositionSizeBC,
						fFeeCC: fFeeCC,
						fPnlCC: fPnlCC,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
					event.log.blockNumber,
				);
			},
		);

		proxy.on(
			"UpdateMarginAccount",
			async (
				perpetualId: number,
				trader: string,
				fFundingPaymentCC: bigint,
				event: ethers.ContractEventPayload,
			) => {
				this.l.info("got update margin account event", {
					perpetualId,
					trader,
				});
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onUpdateMarginAccount(
					{
						perpetualId: perpetualId,
						trader: trader,
						fFundingPaymentCC: fFundingPaymentCC,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
				);
			},
		);

		proxy.on(
			"LiquidityAdded",
			async (
				poolId: number,
				user: string,
				tokenAmount: bigint,
				shareAmount: bigint,
				event: ethers.ContractEventPayload,
			) => {
				this.l.info("got liquidity added event", {
					poolId,
					user,
				});
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onLiquidityAdded(
					{
						poolId: BigInt(poolId),
						user: user,
						tokenAmount: tokenAmount,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
				);
			},
		);

		proxy.on(
			"LiquidityRemoved",
			async (
				poolId: number,
				user: string,
				tokenAmount: bigint,
				shareAmount: bigint,
				event: ethers.ContractEventPayload,
			) => {
				this.l.info("got liquidity removed event", {
					poolId,
					user,
				});
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onLiquidityRemoved(
					{
						poolId: BigInt(poolId),
						user: user,
						tokenAmount: tokenAmount,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
				);
			},
		);

		// List to token transfers for all share token contracts
		const abi = await getShareTokenContractABI();
		const shareTokenContracts = this.opts.staticInfo.retrieveShareTokenContracts();
		for (let i = 0; i < shareTokenContracts.length; i++) {
			const c = new Contract(shareTokenContracts[i], abi, provider);
			const poolId = i + 1;

			this.l.info(
				`starting share token P2PTransfer listener on ${this.listeningMode} provider`,
				{
					share_token_contract: shareTokenContracts[i],
				},
			);
			c.on(
				"P2PTransfer",
				async (
					from: string,
					to: string,
					amountD18: bigint,
					priceD18: bigint,
					event: ethers.ContractEventPayload,
				) => {
					const ts = await this.getBlockTs(event);
					if (ts === undefined) return;
					this.onP2PTransfer(
						{ from: from, to: to, amountD18: amountD18, priceD18: priceD18 },
						poolId,
						event.log.transactionHash,
						IS_COLLECTED_BY_EVENT,
						ts,
					);
				},
			);
		}

		this.l.info(
			`starting liquidity withdrawal initiated events listener on ${this.listeningMode} provider`,
		);
		proxy.on(
			"LiquidityWithdrawalInitiated",
			async (
				poolId: number,
				user: string,
				shareAmount: bigint,
				event: ethers.ContractEventPayload,
			) => {
				const ts = await this.getBlockTs(event);
				if (ts === undefined) return;
				this.onLiquidityWithdrawalInitiated(
					{
						poolId: BigInt(poolId),
						user: user,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					ts,
				);
			},
		);
	}
	/**
	 * Listener for P2PTransfer events emitted by share token contracts. Updates estimated earnings for the sender and receiver of the transfer,
	 * and also updates price info for the share token if the price is above 0.
	 * @param eventData the data from the P2PTransfer event, including sender, receiver, amount, and price
	 * @param poolId the ID of the liquidity pool associated with the share token contract that emitted the event
	 * @param txHash the transaction hash of the event, used for logging and database records
	 * @param isCollectedByEvent a boolean indicating whether the event was collected directly from the blockchain event listener (true) or from historical data backfill (false)
	 * @param timestampSec the timestamp of the event in seconds, typically the block timestamp, used for database records and time-based calculations
	 */
	public async onP2PTransfer(
		eventData: P2PTransferEvent,
		poolId: number,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		this.dbEstimatedEarnings.insertShareTokenP2PTransfer(
			eventData,
			poolId,
			txHash,
			isCollectedByEvent,
			timestampSec,
			this.opts.staticInfo,
		);
	}

	public async onSettleEvent(
		eventData: SettleEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		try {
			await this.dbSettle.insertSettleHistoryRecord(
				eventData,
				txHash,
				isCollectedByEvent,
				timestampSec,
			);
		} catch (e) {
			this.l.error("failed to insert settle record", { txHash, error: e });
			metrics.trackError("db:settle", e);
		}
	}

	public async onTokensDepositedEvent(
		eventData: TokensDepositedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		try {
			await this.dbTokenFlow.insertTokenDepositRecord(
				eventData,
				txHash,
				isCollectedByEvent,
				timestampSec,
			);
		} catch (e) {
			this.l.error("failed to insert token deposit record", { txHash, error: e });
			metrics.trackError("db:tokenDeposit", e);
		}
	}
	public async onTokensWithdrawnEvent(
		eventData: TokensWithdrawnEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		try {
			await this.dbTokenFlow.insertTokenWithdrawRecord(
				eventData,
				txHash,
				isCollectedByEvent,
				timestampSec,
			);
		} catch (e) {
			this.l.error("failed to insert token withdraw record", { txHash, error: e });
			metrics.trackError("db:tokenWithdraw", e);
		}
	}

	public async onTradeEvent(
		eventData: TradeEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
		blockNumber: number,
	) {
		try {
			await this.dbTrades.insertTradeHistoryRecord(
				eventData,
				txHash,
				isCollectedByEvent,
				timestampSec,
				blockNumber,
			);
		} catch (e) {
			this.l.error("failed to insert trade record", { txHash, error: e });
			metrics.trackError("db:trade", e);
		}
	}

	public async onSetOracleEvent(
		eventData: SetOraclesEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		blockTimestamp: number,
		blockNumber: number,
	) {
		await this.dbSetOracles.insertSetOraclesRecord(
			eventData,
			txHash,
			isCollectedByEvent,
			blockTimestamp,
			blockNumber,
		);
	}

	public async onLiquidate(
		eventData: LiquidateEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
		blockNumber: number,
	) {
		await this.dbTrades.insertTradeHistoryRecord(
			eventData,
			txHash,
			isCollectedByEvent,
			timestampSec,
			blockNumber,
		);
	}

	public async onUpdateMarginAccount(
		eventData: UpdateMarginAccountEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		await this.dbFundingRates.insertFundingRatePayment(
			eventData,
			txHash,
			isCollectedByEvent,
			timestampSec,
		);
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
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		await this.dbLPWithdrawals.insert(
			eventData,
			false,
			txHash,
			isCollectedByEvent,
			timestampSec,
		);
	}

	public async onLiquidityRemoved(
		eventData: LiquidityRemovedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		await this.dbEstimatedEarnings.insertLiquidityRemoved(
			eventData,
			txHash,
			isCollectedByEvent,
			timestampSec,
		);

		// Insert price info
		await this._updateSharePoolTokenPriceInfo(
			Number(eventData.poolId.toString()),
			eventData.tokenAmount,
			eventData.shareAmount,
			timestampSec,
		);

		// Attempt to finalize lp withdrawal
		this.dbLPWithdrawals.insert(
			eventData,
			true,
			txHash,
			isCollectedByEvent,
			timestampSec,
		);
	}

	public async onLiquidityAdded(
		eventData: LiquidityAddedEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
	) {
		this.dbEstimatedEarnings.insertLiquidityAdded(
			eventData,
			txHash,
			isCollectedByEvent,
			timestampSec,
		);
		// Insert price info
		await this._updateSharePoolTokenPriceInfo(
			Number(eventData.poolId.toString()),
			eventData.tokenAmount,
			eventData.shareAmount,
			timestampSec,
		);
	}

	private async _updateSharePoolTokenPriceInfo(
		poolId: number,
		tokenAmount: bigint,
		shareAmount: bigint,
		timestampSec: number,
	) {
		// Insert price info. Pool tokens are decimal-18
		const decimals = this.opts.staticInfo.getMarginTokenDecimals(poolId);
		const price = decNToFloat(tokenAmount, decimals) / dec18ToFloat(shareAmount);
		await this.dbPriceInfos.insert(price, poolId, timestampSec);
	}
}
