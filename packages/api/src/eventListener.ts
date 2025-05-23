import {
	ABK64x64ToFloat,
	containsFlag,
	ExchangeInfo,
	MarginAccount,
	MASK_MARKET_ORDER,
	mul64x64,
	NodeSDKConfig,
	ONE_64x64,
	PerpetualState,
	SmartContractOrder,
	TraderInterface,
} from "@d8x/perpetuals-sdk";
import { IncomingMessage } from "http";
import WebSocket from "ws";
import crypto from "crypto";

import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import IndexPriceInterface from "./indexPriceInterface";
import SDKInterface from "./sdkInterface";
import {
	ExecutionFailed,
	LimitOrderCreated,
	PriceUpdate,
	Trade,
	UpdateMarginAccount,
	UpdateMarginAccountTrimmed,
	WSMsg,
} from "utils/src/wsTypes";
import SturdyWebSocket from "sturdy-websocket";
import { Logger } from "winston";
import { TrackedWebsocketsProvider } from "./providers";
import { Contract, WebSocketProvider } from "ethers";
import RedisOI from "./redisOI";
/**
 * Class that listens to blockchain events on
 * - limitorder books
 *      - onExecutionFailed (trader)
 *      - onPerpetualLimitOrderCreated (trader)
 * - perpetual manager proxy
 *      - onUpdateMarkPrice (broadcast)
 *      - onUpdateFundingRate (broadcast via MarkPrice)
 *      - onUpdateMarginAccount (trader)
 *      - onPerpetualLimitOrderCancelled (trader)
 *      - onTrade (broadcast)
 * Subscriptions:
 * - subscribe to perpetual with trader-address
 * - will get most events as indicated above
 */

//onUpdateMarkPrice
//onUpdateUpdateFundingRate
//Order: onExecutionFailed
//       onPerpetualLimitOrderCreated
// proxy:
//      onUpdateMarginAccount
//      onPerpetualLimitOrderCancelled
//      onTrade

interface ClientSubscription {
	perpetualId: number;
	symbol: string;
	traderAddr: string;
}

interface EventFrequencyCount {
	createdCount: number;
	executedCount: number;
	lastResetTs: number;
}

type ControlledEventHandlerName =
	| "onTrade"
	| "onUpdateMarkPrice"
	| "onPerpetualLimitOrderCreated"
	| "onExecutionFailed";

export default class EventListener extends IndexPriceInterface {
	traderInterface!: TraderInterface;
	proxyContract: Contract | undefined;
	orderBookContracts: Record<string, Contract> = {};
	wsRPC!: string;
	isInitialized = false;
	fundingRate: Map<number, number>; // perpetualId -> funding rate
	lastBlockChainEventTs: number; //here we log the event occurence time to guess whether the connection is alive
	wsConn: SturdyWebSocket | undefined;
	// subscription for perpetualId and trader address. Multiple websocket-clients can subscribe
	// (hence array of websockets)
	subscriptions: Map<number, Map<string, WebSocket.WebSocket[]>>; // perpetualId -> traderAddr -> ws[]
	clients: Map<WebSocket.WebSocket, Array<ClientSubscription>>;

	// Current active websocket provider
	public currentWSRpcProvider: WebSocketProvider | undefined = undefined;
	// Whether resetRPCWebsocket is currently running
	public rpcResetting = false;
	// After how many calls to resetRPCWebsocket service will be restarted. This
	// is to prevent memory leaks from provider.WebsocketProvider
	public restartServiceAfter = 100 + Math.floor(Math.random() * 100);
	// Current counter, how many times resetRPCWebsocket was called
	private currentRestartCount = 0;

	private redisOITimeSeries: RedisOI;

	private mktOrderFrequency: EventFrequencyCount = {
		createdCount: 0,
		executedCount: 0,
		lastResetTs: 0,
	};

	// keep a record of calls to the event handler functions that are triggered upon receipt of a RPC websocket
	// event. This is to detect if an event is triggered multiple times (an RPC issue)
	eventControlCircularBuffer: Record<
		ControlledEventHandlerName,
		{ hash: string[]; pointer: number }
	>;

	constructor(public logger: Logger) {
		super();

		this.lastBlockChainEventTs = Date.now();
		this.fundingRate = new Map<number, number>();
		this.subscriptions = new Map<number, Map<string, WebSocket.WebSocket[]>>();
		this.clients = new Map<WebSocket.WebSocket, Array<ClientSubscription>>();
		this.resetEventFrequencies(this.mktOrderFrequency);
		this.eventControlCircularBuffer = {
			onTrade: { hash: new Array<string>(10), pointer: 0 },
			onUpdateMarkPrice: { hash: new Array<string>(10), pointer: 0 },
			onPerpetualLimitOrderCreated: { hash: new Array<string>(10), pointer: 0 },
			onExecutionFailed: { hash: new Array<string>(10), pointer: 0 },
		};
		this.redisOITimeSeries = new RedisOI(this.redisClient);
	}

	// throws error on RPC issue
	public async initialize(
		sdkInterface: SDKInterface,
		sdkConfig: NodeSDKConfig,
		wsRPC: string,
	) {
		await super.priceInterfaceInitialize(sdkInterface);
		this.traderInterface = new TraderInterface(sdkConfig);
		await this.traderInterface.createProxyInstance();
		this.wsRPC = wsRPC;
		this.resetRPCWebsocket(this.wsRPC);
		sdkInterface.registerObserver(this);
		this.lastBlockChainEventTs = Date.now();

		// run _update only for the first time to set fundingRates and
		// openInterest
		await this._update("Initial Update Call", true);

		// Set to initialized only after all initializations are done
		this.isInitialized = true;
	}

	public async resetRPCWebsocket(newWsRPC: string) {
		try {
			return await this.resetRPCWebsocketInner(newWsRPC);
		} catch (e) {
			this.rpcResetting = false;
			this.logger.error("resetRPCWebsocket failed", { error: e });
		}
		return false;
	}

	// Perform the RPC reset
	private async resetRPCWebsocketInner(newWsRPC: string) {
		if (this.rpcResetting) {
			this.logger.warn("resetRPCWebsocket is already running, not resetting...");
			return;
		}
		this.rpcResetting = true;

		this.wsRPC = newWsRPC;
		this.logger.info("resetting WS RPC", { newWsRPC });

		// Close the underlying websockets connection without issuing
		// eth_unsubscribe calls. We do this because ethers implementation has a
		// bug where it sends async eth_unsubscribe requests from within
		// synchronous WebsocketProvider._stopEvent call. Therefore if we
		// attempt to remove event listeners before closing the websocket
		// connection, it will crash the service with unhandled promise error
		// while attempting to send(eth_unsubscribe) on a closed connection.
		if (this.currentWSRpcProvider !== undefined) {
			this.currentWSRpcProvider.destroy();
			this.logger.info("old rpc provider destroyed");
		}

		this.wsConn = new SturdyWebSocket(this.wsRPC, {
			wsConstructor: WebSocket,
			connectTimeout: 10000,
			maxReconnectAttempts: 3,
		});

		// Attempt to establish a ws connection to new RPC
		this.logger.info("creating new websocket rpc provider");
		this.currentWSRpcProvider = new TrackedWebsocketsProvider(this.wsConn!);

		// On provider error - retry after short cooldown
		this.currentWSRpcProvider.on("error", (error: Error) => () => {
			this.logger.error(
				`[ERROR] resetRPCWebsocket provider error: ${error.message}`,
			);
			this.currentWSRpcProvider!.destroy();
		});

		this.logger.info("waiting for provider to be ready");
		// Attempt to wait 20 seconds for provider to be ready.
		try {
			await new Promise((resolve, reject) => {
				setTimeout(() => reject("timeout"), 1000 * 20);
				this.currentWSRpcProvider!._detectNetwork().then(resolve);
			});
		} catch (e) {
			this.logger.error("provider ready wait timeout");
			this.currentRestartCount++;
			this.rpcResetting = false;
			return false;
		}
		this.logger.info("provider is ready");

		this.proxyContract = new Contract(
			this.traderInterface.getProxyAddress(),
			this.traderInterface.getABI("proxy")!,
			this.currentWSRpcProvider,
		);

		this.addProxyEventHandlers();
		for (const symbol of Object.keys(this.orderBookContracts)) {
			this.addOrderBookEventHandlers(symbol);
		}
		this.lastBlockChainEventTs = Date.now();
		this.resetEventFrequencies(this.mktOrderFrequency);

		this.rpcResetting = false;
		this.currentRestartCount++;
		this.logger.info("resetRPCWebsocket done");

		// Check whether we should exit current process
		if (this.currentRestartCount >= this.restartServiceAfter) {
			this.logger.info(
				"restartServiceAfter counter reached, restarting service...",
			);
			process.exit(0);
		} else {
			const diff = this.restartServiceAfter - this.currentRestartCount;
			this.logger.info("service not restarting", {
				resetRPCWebsocket_calls_until_restart: diff,
			});
		}
	}

	/**
	 * Unlisten/Remove event handlers for an order-book
	 * @param symbol symbol for order-book
	 */
	private removeOrderBookEventHandlers(symbol: string) {
		const contract = this.orderBookContracts[symbol];
		if (contract != undefined) {
			contract.removeAllListeners();
		}
	}

	/**
	 * Unlisten/Remove all event handlers
	 */
	private stopListening() {
		if (this.proxyContract != undefined) {
			this.logger.info("removing websocket listeners");
			this.proxyContract.removeAllListeners();
		}
		for (const symbol of Object.keys(this.orderBookContracts)) {
			this.logger.info("removing event listeners");
			this.removeOrderBookEventHandlers(symbol);
		}
	}

	/**
	 * On Error of Websocket connection -> rethrow
	 * @param error error from websocket
	 */
	private onError(error: Error) {
		this.logger.error(`Websocket error:${error.message}`);
		throw error;
	}

	private resetEventFrequencies(freq: EventFrequencyCount) {
		freq.createdCount = 0;
		freq.executedCount = 0;
		freq.lastResetTs = Date.now();
	}

	public getMarketOrderFrequencies(): [number, number] {
		return [
			this.mktOrderFrequency.createdCount,
			this.mktOrderFrequency.executedCount,
		];
	}

	public doMarketOrderFrequenciesMatch(): boolean {
		const c = this.mktOrderFrequency.createdCount;
		const e = this.mktOrderFrequency.executedCount;
		const maxCount = Math.max(c, e);
		if (maxCount < 5) {
			return true;
		}
		const relDev = Math.abs(c - e) / Math.max(c, e);
		if (Date.now() - this.mktOrderFrequency.lastResetTs > 10 * 60_000) {
			this.resetEventFrequencies(this.mktOrderFrequency);
		}
		return relDev < 0.5;
	}

	/**
	 * Time elapsed since last event was received.
	 * Can be used to check "alive" status
	 * @returns milliseconds of last event
	 */
	public lastBlockchainEventTsMs(): number {
		return this.lastBlockChainEventTs;
	}

	private symbolFromPerpetualId(perpetualId: number): string {
		const symbol = this.traderInterface.getSymbolFromPerpId(perpetualId);
		return symbol || "";
	}

	/**
	 * Subscribe to perpetual
	 * Unsubscribes from all other perpetuals.
	 * @param ws websocket client
	 * @param perpetualsSymbol symbol of the form BTC-USD-MATIC
	 * @param traderAddr address of the trader
	 * @returns true if newly subscribed
	 */
	public subscribe(
		ws: WebSocket.WebSocket,
		perpetualsSymbol: string,
		traderAddr: string,
	): boolean {
		const id = this.traderInterface.getPerpIdFromSymbol(perpetualsSymbol);
		if (this.clients.get(ws) == undefined) {
			this.clients.set(ws, new Array<ClientSubscription>());
		}
		const clientSubscriptions = this.clients.get(ws);

		// check that not already subscribed
		for (let k = 0; k < clientSubscriptions!.length; k++) {
			if (
				clientSubscriptions![k].perpetualId == id &&
				clientSubscriptions![k].traderAddr == traderAddr
			) {
				// already subscribed
				console.log(
					`client tried to subscribe again for perpetual ${id} and trader ${traderAddr}`,
				);
				return false;
			}
		}
		clientSubscriptions!.push({
			perpetualId: id,
			symbol: perpetualsSymbol,
			traderAddr: traderAddr,
		});

		console.log(
			`${new Date(Date.now())}: #ws=${this.clients.size}, new client ${traderAddr}`,
		);
		let perpSubscribers = this.subscriptions.get(id);
		if (perpSubscribers == undefined) {
			this.subscriptions.set(id, new Map<string, WebSocket.WebSocket[]>());
			this.addOrderBookEventHandlers(perpetualsSymbol);
			perpSubscribers = this.subscriptions.get(id);
		}
		let traderSubscribers = perpSubscribers!.get(traderAddr);
		if (traderSubscribers == undefined) {
			perpSubscribers!.set(traderAddr, new Array<WebSocket>());
			traderSubscribers = perpSubscribers!.get(traderAddr);
		}
		traderSubscribers!.push(ws);
		console.log(`subscribed to perp ${perpetualsSymbol} with id ${id}`);
		return true;
	}

	private _getIP(req: IncomingMessage): string {
		const headers = req.headers["x-forwarded-for"];
		let v: string = "(x-forwarded-for not defined)";
		if (typeof headers == "string") {
			v = String(headers);
			v = v!.split(",")[0].trim();
		} else {
			console.log(req.headers);
		}

		return v;
	}

	public unsubscribe(ws: WebSocket.WebSocket, req: IncomingMessage) {
		console.log(
			`${new Date(Date.now())}: #ws=${this.clients.size}, client unsubscribed`,
		);
		//subscriptions: Map<number, Map<string, WebSocket.WebSocket[]>>;
		//clients: Map<WebSocket.WebSocket, Array<ClientSubscription>>;
		const clientSubscriptions = this.clients.get(ws);
		if (clientSubscriptions == undefined) {
			console.log("unknown client unsubscribed, ip=", this._getIP(req));
			return;
		}
		this._unsubscribe(clientSubscriptions, undefined, ws);
		this.clients.delete(ws);
	}

	private _unsubscribe(
		clientSubscriptions: ClientSubscription[],
		exceptionPoolId: number | undefined,
		ws: WebSocket.WebSocket,
	) {
		for (let k = 0; k < clientSubscriptions?.length; k++) {
			const id = clientSubscriptions[k].perpetualId;
			const poolId = Math.floor(id / 1e5);
			if (poolId == exceptionPoolId) {
				continue;
			}
			const traderMap = this.subscriptions.get(id);
			if (traderMap == undefined) {
				continue;
			}
			const subscribers = traderMap.get(clientSubscriptions[k].traderAddr);
			if (subscribers != undefined) {
				const idx = subscribers!.indexOf(ws, 0);
				if (idx > -1) {
					subscribers!.splice(idx, 1);
				}
			}
			if (subscribers == undefined || subscribers?.length == 0) {
				traderMap.delete(clientSubscriptions[k].traderAddr);
			}
			if (this.subscriptions.get(id)?.size == 0) {
				console.log(`no more subscribers for perpetualId ${id}`);
				// unsubscribe events
				this.removeOrderBookEventHandlers(clientSubscriptions[k].symbol);
			}
		}
	}

	public isWsKnown(ws: WebSocket.WebSocket): boolean {
		return this.clients.get(ws) != undefined;
	}

	/**
	 * Handles updates from sdk interface
	 * @param msg
	 * @param firstTimeUpdate - if true, allow to run the _update even if not
	 * initialized
	 * @returns
	 */
	protected async _update(msg: String, firstTimeUpdate: boolean = false) {
		// we receive a message from the observable sdk on update exchange info;
		// we update price info and inform subscribers. Whenever this is a first
		// time update - allow it to pass through to initialize the funding rate
		// and openInterest
		if (!this.isInitialized && !firstTimeUpdate) {
			return;
		}
		console.log("received update from sdkInterface", msg);
		const info: ExchangeInfo = await this.traderInterface.exchangeInfo();
		// update fundingRate: Map<number, number>; // perpetualId -> funding rate
		const pools = info.pools;
		const nowTs = Date.now();
		for (let k = 0; k < pools.length; k++) {
			const pool = pools[k];
			for (let j = 0; j < pool.perpetuals.length; j++) {
				const perp: PerpetualState = pool.perpetuals[j];
				this.fundingRate.set(perp.id, perp.currentFundingRateBps / 1e4);
				this.redisOITimeSeries.addOIObs(perp.id, perp.openInterestBC, nowTs)
				if (this.isPredictionMkt.get(perp.id)) {
					this.emaPrices.set(perp.id, perp.markPrice - perp.markPremium);
				}
				this.updateMarkPrice(
					perp.id,
					perp.midPrice,
					perp.markPrice,
					perp.indexPrice,
				);

				console.log(`[_update] setting fundingRate and openInterest`, {
					fundingRate: perp.currentFundingRateBps / 1e4,
					openInterest: perp.openInterestBC,
					perpetualId: perp.id,
				});
			}
		}
	}

	/**
	 * Send websocket message
	 * @param perpetualId perpetual id
	 * @param message JSON-message to be sent
	 * @param traderAddr optional: only send to this trader. Otherwise broadcast
	 */
	private sendToSubscribers(perpetualId: number, message: string, traderAddr?: string) {
		// traderAddr -> ws

		const subscribers: Map<string, WebSocket.WebSocket[]> | undefined =
			this.subscriptions.get(perpetualId);
		if (subscribers == undefined) {
			// console.log(`no subscribers for perpetual ${perpetualId}`);
			return;
		}
		if (traderAddr != undefined) {
			const traderWs: WebSocket[] | undefined = subscribers.get(traderAddr);
			if (traderWs == undefined) {
				console.log(
					`no subscriber to trader ${traderAddr} in perpetual ${perpetualId}`,
				);
				return;
			}
			// send to all subscribers of this perpetualId and traderAddress
			for (let k = 0; k < traderWs.length; k++) {
				traderWs[k].send(message);
			}
		} else {
			// broadcast
			for (const [trader, wsArr] of subscribers) {
				for (let k = 0; k < wsArr.length; k++) {
					wsArr[k].send(message);
				}
			}
		}
	}

	/**
	 * onUpdateMarkPrice
	 * onUpdateFundingRate
	 * onUpdateMarginAccount
	 * onPerpetualLimitOrderCancelled
	 * onTrade
	 */
	private addProxyEventHandlers() {
		if (!this.proxyContract) {
			throw new Error("proxy contract not defined");
		}
		const proxyContract = this.proxyContract;

		proxyContract.on(
			"TransferAddressTo",
			(module: string, oldAddress: string, newAddress: string) => {
				console.log("restart", { module, oldAddress, newAddress });
				process.exit(1);
			},
		);

		proxyContract.on(
			"UpdateMarkPrice",
			(perpetualId, fMidPricePremium, fMarkPricePremium, fSpotIndexPrice) => {
				this.onUpdateMarkPrice(
					perpetualId,
					fMidPricePremium,
					fMarkPricePremium,
					fSpotIndexPrice,
				);
			},
		);
		proxyContract.on(
			"UpdateFundingRate",
			(perpetualId: number, fFundingRate: bigint) => {
				this.onUpdateFundingRate(perpetualId, fFundingRate);
			},
		);

		/*
        event UpdateMarginAccount(
            uint24 indexed perpetualId,
            address indexed trader,
            int128 fFundingPaymentCC,
        );
    */
		proxyContract.on(
			"UpdateMarginAccount",
			(perpetualId: number, trader: string, fFundingPaymentCC: bigint) => {
				this.onUpdateMarginAccount(perpetualId, trader, fFundingPaymentCC);
			},
		);
		proxyContract.on(
			"TokensDeposited",
			(perpetualId: number, trader: string, amount: bigint) => {
				this.onUpdateMarginCollateral(perpetualId, trader, amount);
			},
		);
		proxyContract.on(
			"TokensWithdrawn",
			(perpetualId: number, trader: string, amount: bigint) => {
				this.onUpdateMarginCollateral(perpetualId, trader, amount * -1n);
			},
		);

		proxyContract.on(
			"Trade",
			(
				perpetualId: number,
				trader: string,
				order: SmartContractOrder,
				orderDigest: string,
				newPositionSizeBC: bigint,
				price: bigint,
			) => {
				this.onTrade(
					perpetualId,
					trader,
					order,
					orderDigest,
					newPositionSizeBC,
					price,
				);
			},
		);

		proxyContract.on(
			"PerpetualLimitOrderCancelled",
			(perpetualId: number, digest: string) => {
				this.onPerpetualLimitOrderCancelled(perpetualId, digest);
			},
		);
	}

	/**
	 * Event handler registration for order book
	 * @param symbol order book symbol
	 */
	private addOrderBookEventHandlers(symbol: string) {
		const provider = this.currentWSRpcProvider!;
		this.orderBookContracts[symbol] = new Contract(
			this.traderInterface.getOrderBookAddress(symbol),
			this.traderInterface.getABI("lob")!,
			provider,
		);
		provider.on("error", (error: Error) => this.onError(error));
		const contract = this.orderBookContracts[symbol];

		contract.on(
			"PerpetualLimitOrderCreated",
			(
				perpetualId: number,
				trader: string,
				brokerAddr: string,
				Order: SmartContractOrder,
				digest: string,
			) => {
				this.onPerpetualLimitOrderCreated(
					perpetualId,
					trader,
					brokerAddr,
					Order,
					digest,
				);
			},
		);
		contract.on(
			"ExecutionFailed",
			(perpetualId: number, trader: string, digest: string, reason: string) => {
				this.onExecutionFailed(perpetualId, trader, digest, reason);
			},
		);
	}

	/**
	 * emit UpdateFundingRate(_perpetual.id, fFundingRate)
	 * We store the funding rate locally and send it with other events to the price subscriber
	 * @param perpetualId
	 * @param fFundingRate
	 */
	private onUpdateFundingRate(perpetualId: number, fFundingRate: bigint) {
		this.lastBlockChainEventTs = Date.now();
		const rate = ABK64x64ToFloat(fFundingRate);
		this.fundingRate.set(perpetualId, rate);
	}

	/**
	 * Relay the MarginAccount event to the websocket subscribers. Only trader
	 * address is needed for frontend clients.
	 * @param perpetualId id of the perpetual
	 * @param trader trader address
	 * @param fFundingPaymentCC funding payment made
	 */
	public async onUpdateMarginAccount(
		perpetualId: number,
		trader: string,
		fFundingPaymentCC: bigint,
	): Promise<void> {
		// Set the open interest from exchange info (1 min delay at max)
		const symbol = this.symbolFromPerpetualId(perpetualId);
		const state =
			await this.sdkInterface!.extractPerpetualStateFromExchangeInfo(symbol);
		this.redisOITimeSeries.addOIObs(perpetualId, state.openInterestBC, Date.now());

		const obj: UpdateMarginAccountTrimmed = {
			traderAddr: trader,
		};
		// send data to subscriber
		const wsMsg: WSMsg = { name: "UpdateMarginAccount", obj: obj };
		const jsonMsg: string = D8XBrokerBackendApp.JSONResponse(
			"onUpdateMarginAccount",
			"",
			wsMsg,
		);

		this.logger.info("received UpdateMarginAccount", { perpetualId, trader });

		this.sendToSubscribers(perpetualId, jsonMsg, trader);
	}

	private async onUpdateMarginCollateral(
		perpetualId: number,
		trader: string,
		amount: bigint,
	) {
		this.lastBlockChainEventTs = Date.now();
		const symbol = this.sdkInterface!.getSymbolFromPerpId(perpetualId)!;
		const pos = (<MarginAccount[]>(
			JSON.parse(await this.sdkInterface!.positionRisk(trader, symbol))
		))[0];
		if (pos.positionNotionalBaseCCY == 0 && amount < 0) {
			// position is zero after a withdrawal: this will be caught as a margin account update, ignore
			return;
		}
		// either an opening trade, or trader just deposited to an existing position
		const obj: UpdateMarginAccount = {
			// positionRisk
			symbol: symbol,
			positionNotionalBaseCCY: pos.positionNotionalBaseCCY,
			side: pos.side,
			entryPrice: pos.entryPrice,
			leverage: pos.leverage,
			markPrice: pos.markPrice,
			unrealizedPnlQuoteCCY: pos.unrealizedPnlQuoteCCY,
			unrealizedFundingCollateralCCY: pos.unrealizedFundingCollateralCCY,
			collateralCC: pos.collateralCC,
			liquidationPrice: pos.liquidationPrice,
			liquidationLvg: pos.liquidationLvg,
			collToQuoteConversion: pos.collToQuoteConversion,
			// extra info
			perpetualId: perpetualId,
			traderAddr: trader,
			fundingPaymentCC: 0,
		};
		// send data to subscriber
		const wsMsg: WSMsg = { name: "UpdateMarginAccount", obj: obj };
		const jsonMsg: string = D8XBrokerBackendApp.JSONResponse(
			"onUpdateMarginAccount",
			"",
			wsMsg,
		);
		// send to subscribers of trader/perpetual
		this.sendToSubscribers(perpetualId, jsonMsg, trader);
	}

	/**
	 * Handle the event UpdateMarkPrice and update relevant
	 * data
	 * @param perpetualId perpetual Id
	 * @param fMidPricePremium premium for spot price in ABDK
	 * @param fMarkPricePremium premium rate in ABDK format
	 * @param fMarkIndexPrice spot index price or ema used for mark price in ABDK format
	 */
	public onUpdateMarkPrice(
		perpetualId: number,
		fMidPricePremium: bigint,
		fMarkPricePremium: bigint,
		fMarkIndexPrice: bigint,
	): void {
		if (!this.isInitialized) {
			console.log("onUpdateMarkPrice: eventListener not initialized");
			return;
		}
		const isPred = this.isPredictionMkt.get(perpetualId)!;

		this.lastBlockChainEventTs = Date.now();

		const hash =
			(fMidPricePremium + fMarkPricePremium + fMarkIndexPrice).toString() +
			perpetualId.toString();
		if (!this.grantEventControlPassage(hash, "onUpdateMarkPrice")) {
			console.log("onUpdateMarkPrice duplicate");
			return;
		}
		const pxIdxName = this.sdkInterface!.getSymbolFromPerpId(perpetualId)!;
		const currIdx = this.idxPrices.get(pxIdxName)!;

		let newMarkPrice, newMidPrice: number;
		const midPrem = ABK64x64ToFloat(fMidPricePremium);
		const mrkPrem = ABK64x64ToFloat(fMarkPricePremium);
		this.midPremium.set(perpetualId, midPrem);
		this.mrkPremium.set(perpetualId, mrkPrem);
		if (isPred) {
			// set ema price for prediction markets.
			// we don't set the index price for regular markets as this
			// would be outdated
			const ema = ABK64x64ToFloat(fMarkIndexPrice);
			this.emaPrices.set(perpetualId, ema);
			newMidPrice = currIdx * (1 + mrkPrem);
			newMarkPrice = Math.max(Math.min(ema * (1 + mrkPrem), 2), 1); //clamp
		} else {
			newMarkPrice = currIdx * (1 + mrkPrem);
			newMidPrice = currIdx * (1 + midPrem);
		}
		console.log("eventListener: onUpdateMarkPrice");

		// notify websocket listeners (using prices based on most recent websocket price)
		this.updateMarkPrice(perpetualId, newMidPrice, newMarkPrice, currIdx);

		// update data in sdkInterface's exchangeInfo
		const fundingRate = this.fundingRate.get(perpetualId) || 0;

		const oi = this.redisOITimeSeries.get(perpetualId);
		const symbol = this.symbolFromPerpetualId(perpetualId);

		if (this.sdkInterface != undefined && symbol != undefined) {
			this.sdkInterface.updateExchangeInfoNumbersOfPerpetual(
				symbol,
				[newMidPrice, newMarkPrice, currIdx, oi, fundingRate * 1e4],
				[
					"midPrice",
					"markPrice",
					"indexPrice",
					"openInterestBC",
					"currentFundingRateBps",
				],
			);
		} else {
			const errStr = `onUpdateMarkPrice: no perpetual found for id ${perpetualId} ${symbol} or no sdkInterface available`;
			throw new Error(errStr);
		}
	}

	/**
	 * Internal function to update prices.
	 * Called either by blockchain event handler (onUpdateMarkPrice),
	 * or on update of the observable sdkInterface (after exchangeInfo update),
	 * or from parent class on websocket update.
	 * Informs websocket subscribers
	 * @param perpetualId id of the perpetual for which prices are being updated
	 * @param newMidPrice mid price in decimals
	 * @param newMarkPrice mark price
	 * @param newIndexPrice index price
	 */
	protected updateMarkPrice(
		perpetualId: number,
		newMidPrice: number,
		newMarkPrice: number,
		newIndexPrice: number,
	) {
		if (!this.isInitialized) {
			console.log("updateMarkPrice: eventListener not initialized");
			return;
		}

		const fundingRate = this.fundingRate.get(perpetualId) || 0;

		const oi = this.redisOITimeSeries.get(perpetualId);
		const symbol = this.symbolFromPerpetualId(perpetualId);
		const obj: PriceUpdate = {
			symbol: symbol,
			perpetualId: perpetualId,
			midPrice: newMidPrice,
			markPrice: newMarkPrice,
			indexPrice: newIndexPrice,
			fundingRate: fundingRate * 1e4, // in bps so it matches exchangeInfo
			openInterest: oi,
		};
		const wsMsg: WSMsg = { name: "PriceUpdate", obj: obj };
		const jsonMsg: string = D8XBrokerBackendApp.JSONResponse(
			"onUpdateMarkPrice",
			"",
			wsMsg,
		);
		// send to all subscribers
		this.sendToSubscribers(perpetualId, jsonMsg);
	}

	/**
	 * @param perpetualId perpetual id
	 * @param trader trader address
	 * @param order order struct
	 * @param orderDigest order id
	 * @param newPositionSizeBC new pos size in base currency ABDK
	 * @param price price in ABDK format
	 */
	private onTrade(
		perpetualId: number,
		trader: string,
		order: SmartContractOrder,
		orderDigest: string,
		newPositionSizeBC: bigint,
		price: bigint,
	) {
		const isMarketOrder = containsFlag(BigInt(order.flags), MASK_MARKET_ORDER);
		if (isMarketOrder) {
			this.mktOrderFrequency.executedCount += 1;
			console.log(`onTrade ${trader} Market Order in perpetual ${perpetualId}`);
		} else {
			console.log(
				`onTrade ${trader} Conditional Order in perpetual ${perpetualId}`,
			);
		}
		this.lastBlockChainEventTs = Date.now();

		const orderHash = this.hashOrder(order);
		if (!this.grantEventControlPassage(orderHash, "onTrade")) {
			console.log("onTrade duplicate");
			return;
		}

		const symbol = this.symbolFromPerpetualId(perpetualId);
		// return transformed trade info
		const data: Trade = {
			symbol: symbol,
			perpetualId: perpetualId,
			traderAddr: trader,
			orderId: orderDigest,
			newPositionSizeBC: ABK64x64ToFloat(newPositionSizeBC),
			executionPrice: ABK64x64ToFloat(price),
		};
		const wsMsg: WSMsg = { name: "Trade", obj: data };
		const jsonMsg: string = D8XBrokerBackendApp.JSONResponse("onTrade", "", wsMsg);
		// broadcast
		this.sendToSubscribers(perpetualId, jsonMsg);
	}

	/**
	 * Hash an order
	 * @param Order SmartContractOrder that is to be hashed
	 * @returns hash of order
	 */
	private hashOrder(Order: SmartContractOrder): string {
		const jsonString = JSON.stringify(Order);
		const hash = crypto.createHash("sha256").update(jsonString).digest("hex");
		return hash;
	}

	/**
	 * Check if event was already called with the same data.
	 * @param hash hash that identifies the event (such as order hash)
	 * @param eventHandlerName name of the event handler that received the event
	 *    onPerpetualLimitOrderCreated,onTrade,onUpdateMarkPrice
	 */
	private grantEventControlPassage(
		hash: string,
		eventHandlerName: ControlledEventHandlerName,
	): boolean {
		if (this.eventControlCircularBuffer[eventHandlerName].hash.includes(hash)) {
			return false;
		}
		const idx = this.eventControlCircularBuffer[eventHandlerName].pointer;
		this.eventControlCircularBuffer[eventHandlerName].hash[idx] = hash;
		this.eventControlCircularBuffer[eventHandlerName].pointer =
			(idx + 1) % this.eventControlCircularBuffer[eventHandlerName].hash.length;
		return true;
	}

	/**
	 * event PerpetualLimitOrderCreated(
	 *    uint24 indexed perpetualId,
	 *    address indexed trader,
	 *    address referrerAddr,
	 *    address brokerAddr,
	 *    Order order,
	 *    bytes32 digest
	 *)
	 * @param perpetualId id of the perpetual
	 * @param trader address of the trader
	 * @param brokerAddr address of the broker
	 * @param order order struct
	 * @param digest order id
	 */
	private onPerpetualLimitOrderCreated(
		perpetualId: number,
		trader: string,
		brokerAddr: string,
		order: SmartContractOrder,
		digest: string,
	): void {
		this.lastBlockChainEventTs = Date.now();
		const isMarketOrder = containsFlag(BigInt(order.flags), MASK_MARKET_ORDER);
		if (isMarketOrder) {
			this.mktOrderFrequency.createdCount += 1;
		}
		const orderHash = this.hashOrder(order);
		if (!this.grantEventControlPassage(orderHash, "onPerpetualLimitOrderCreated")) {
			console.log("onPerpetualLimitOrderCreated duplicate");
			return;
		}
		console.log("onPerpetualLimitOrderCreated");
		// send to subscriber who sent the order
		const symbol = this.symbolFromPerpetualId(perpetualId);
		const obj: LimitOrderCreated = {
			symbol: symbol,
			perpetualId: perpetualId,
			traderAddr: trader,
			brokerAddr: brokerAddr,
			orderId: digest,
		};
		const wsMsg: WSMsg = { name: "PerpetualLimitOrderCreated", obj: obj };
		const jsonMsg: string = D8XBrokerBackendApp.JSONResponse(
			"onPerpetualLimitOrderCreated",
			"",
			wsMsg,
		);
		// only send to trader that subscribed
		this.sendToSubscribers(perpetualId, jsonMsg, trader);
	}

	/**
	 * Event emitted by perpetual proxy: event PerpetualLimitOrderCancelled(bytes32 indexed orderHash);
	 * event PerpetualLimitOrderCancelled(bytes32 indexed orderHash);
	 * @param orderId string order id/digest
	 */
	public onPerpetualLimitOrderCancelled(perpetualId: number, orderId: string) {
		this.lastBlockChainEventTs = Date.now();

		console.log("onPerpetualLimitOrderCancelled");
		const wsMsg: WSMsg = {
			name: "PerpetualLimitOrderCancelled",
			obj: { orderId: orderId },
		};
		const jsonMsg: string = D8XBrokerBackendApp.JSONResponse(
			"onPerpetualLimitOrderCancelled",
			"",
			wsMsg,
		);
		// currently broadcasted:
		this.sendToSubscribers(perpetualId, jsonMsg);
	}

	/**
	 * event ExecutionFailed(
	 *    uint24 indexed perpetualId,
	 *    address indexed trader,
	 *    bytes32 digest,
	 *    string reason
	 * );
	 * @param perpetualId id of the perpetual
	 * @param trader address of the trader
	 * @param digest digest of the order/cancel order
	 * @param reason reason why the execution failed
	 */
	private onExecutionFailed(
		perpetualId: number,
		trader: string,
		digest: string,
		reason: string,
	) {
		this.lastBlockChainEventTs = Date.now();
		if (!this.grantEventControlPassage(digest, "onExecutionFailed")) {
			console.log("onExecutionFailed duplicate");
			return;
		}
		console.log("onExecutionFailed:", reason);
		const symbol = this.symbolFromPerpetualId(perpetualId);
		const obj: ExecutionFailed = {
			symbol: symbol,
			perpetualId: perpetualId,
			traderAddr: trader,
			orderId: digest,
			reason: reason,
		};
		const wsMsg: WSMsg = { name: "ExecutionFailed", obj: obj };
		const jsonMsg: string = D8XBrokerBackendApp.JSONResponse(
			"onExecutionFailed",
			"",
			wsMsg,
		);
		// send to subscribers
		this.sendToSubscribers(perpetualId, jsonMsg, trader);
	}
}
