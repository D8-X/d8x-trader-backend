import { BytesLike, Contract, JsonRpcProvider, WebSocketProvider, ethers } from "ethers";
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
} from "./types";
import { TradingHistory } from "../db/trading_history";
import { SetOracles } from "../db/set_oracles";
import { FundingRatePayments } from "../db/funding_rate";
import { getPerpetualManagerABI, getShareTokenContractABI } from "../utils/abi";
import { EstimatedEarnings } from "../db/estimated_earnings";
import { PriceInfo } from "../db/price_info";
import { dec18ToFloat, decNToFloat } from "utils";
import StaticInfo from "./static_info";
import { LiquidityWithdrawals } from "../db/liquidity_withdrawals";
import { IPerpetualManager } from "@d8x/perpetuals-sdk";
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

	constructor(
		opts: EventListenerOptions,
		// public provider: WebSocketProvider,
		private dbTrades: TradingHistory,
		private dbFundingRates: FundingRatePayments,
		private dbEstimatedEarnings: EstimatedEarnings,
		private dbPriceInfos: PriceInfo,
		private dbLPWithdrawals: LiquidityWithdrawals,
		private dbSetOracles: SetOracles,
	) {
		this.l = opts.logger;
		this.opts = opts;
		this.lastEventTs = Date.now();
		this.listeningMode = ListeningMode.WS;
	}

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
	 */
	public async listen(provider: WebSocketProvider | JsonRpcProvider) {
		if (this.provider) {
			await this.provider.removeAllListeners();
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

		provider.on("block", (blockNumber) => {
			this.lastEventTs = Date.now();
			this.blockNumber = blockNumber;
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

		// Trade event
		proxy.on(
			"Trade",
			(
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
					Math.round(new Date().getTime() / 1000),
					event.log.blockNumber,
				);
			},
		);

		// SetOracles event
		proxy.on(
			"SetOracles",
			(
				perpetualId: number,
				baseQuoteS2: string[],
				baseQuoteS3: string[],
				event: ethers.ContractEventPayload,
			) => {
				const topic = event.log.topics[0];
				this.l.info("got SetOracles event", { perpetualId, topic });
				this.onSetOracleEvent(
					{
						perpetualId: perpetualId,
						baseQuoteS2: baseQuoteS2,
						baseQuoteS3: baseQuoteS3,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					Math.round(new Date().getTime() / 1000),
					event.log.blockNumber,
				);
			},
		);

		proxy.on(
			"Liquidate",
			(
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
					Math.round(new Date().getTime() / 1000),
					event.log.blockNumber,
				);
			},
		);

		proxy.on(
			"UpdateMarginAccount",
			(
				perpetualId: number,
				trader: string,
				fFundingPaymentCC: bigint,
				event: ethers.ContractEventPayload,
			) => {
				this.l.info("got update margin account event", {
					perpetualId,
					trader,
				});
				this.onUpdateMarginAccount(
					{
						perpetualId: perpetualId,
						trader: trader,
						fFundingPaymentCC: fFundingPaymentCC,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					Math.round(new Date().getTime() / 1000),
				);
			},
		);

		proxy.on(
			"LiquidityAdded",
			(
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
				this.onLiquidityAdded(
					{
						poolId: BigInt(poolId),
						user: user,
						tokenAmount: tokenAmount,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					Math.round(new Date().getTime() / 1000),
				);
			},
		);

		proxy.on(
			"LiquidityRemoved",
			(
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
				this.onLiquidityRemoved(
					{
						poolId: BigInt(poolId),
						user: user,
						tokenAmount: tokenAmount,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					Math.round(new Date().getTime() / 1000),
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
				(
					from: string,
					to: string,
					amountD18: bigint,
					priceD18: bigint,
					event: ethers.ContractEventPayload,
				) => {
					this.onP2PTransfer(
						{ from: from, to: to, amountD18: amountD18, priceD18: priceD18 },
						poolId,
						event.log.transactionHash,
						IS_COLLECTED_BY_EVENT,
						Math.round(new Date().getTime() / 1000),
					);
				},
			);
		}

		this.l.info(
			`starting liquidity withdrawal initiated events listener on ${this.listeningMode} provider`,
		);
		proxy.on(
			"LiquidityWithdrawalInitiated",
			(
				poolId: number,
				user: string,
				shareAmount: bigint,
				event: ethers.ContractEventPayload,
			) =>
				this.onLiquidityWithdrawalInitiated(
					{
						poolId: BigInt(poolId),
						user: user,
						shareAmount: shareAmount,
					},
					event.log.transactionHash,
					IS_COLLECTED_BY_EVENT,
					Math.round(new Date().getTime() / 1000),
				),
		);
	}

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
		);
	}

	public async onTradeEvent(
		eventData: TradeEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		timestampSec: number,
		blockNumber: number,
	) {
		this.dbTrades.insertTradeHistoryRecord(
			eventData,
			txHash,
			isCollectedByEvent,
			timestampSec,
			blockNumber,
		);
	}

	public async onSetOracleEvent(
		eventData: SetOraclesEvent,
		txHash: string,
		isCollectedByEvent:boolean,
		blockTimestamp:number,
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
