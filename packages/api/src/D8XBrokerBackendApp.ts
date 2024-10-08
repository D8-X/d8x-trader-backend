import express, { Express, Request, Response } from "express";
import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import SDKInterface from "./sdkInterface";
import { extractErrorMsg, isValidAddress, isValidPerpSymbol } from "utils";
import { Order, PerpetualState, NodeSDKConfig, MarginAccount } from "@d8x/perpetuals-sdk";
import EventListener from "./eventListener";
import BrokerIntegration from "./brokerIntegration";
import { Logger } from "winston";
import cors from "cors";
import RPCManager from "./rpcManager";
dotenv.config();
//https://roger13.github.io/SwagDefGen/
//setAllowance?

// Make sure bigint is serialized to string when stringifying. Without this we
// get "unable to serialize bigint" error.
//
//@ts-ignore
BigInt.prototype.toJSON = function () {
	return this.toString();
};

export default class D8XBrokerBackendApp {
	public express: express.Application;
	private sdk: SDKInterface;
	private sdkConfig: NodeSDKConfig;
	private port: number;
	private portWS: number;
	private wss: WebSocketServer;
	private eventListener: EventListener;
	private CORS_ON: boolean;
	private lastRequestTsMs: number; // last API request, used to inform whether wsRPC should be switched on event-listener

	constructor(
		broker: BrokerIntegration,
		sdkConfig: NodeSDKConfig,
		public logger: Logger,
	) {
		dotenv.config();
		this.express = express();
		if (process.env.MAIN_API_PORT_HTTP == undefined) {
			throw Error("define MAIN_API_PORT_HTTP in .env");
		}
		this.CORS_ON = !(
			process.env.CORS_ON == undefined || process.env.CORS_ON == "FALSE"
		);
		if (process.env.MAIN_API_PORT_WEBSOCKET == undefined) {
			throw Error("define MAIN_API_PORT_WEBSOCKET in .env");
		}
		this.port = Number(process.env.MAIN_API_PORT_HTTP);
		this.portWS = Number(process.env.MAIN_API_PORT_WEBSOCKET);
		this.wss = new WebSocketServer({ port: this.portWS });

		this.sdkConfig = sdkConfig;
		this.eventListener = new EventListener(this.logger);
		this.sdk = new SDKInterface(broker);

		this.middleWare();
		this.lastRequestTsMs = Date.now();
	}

	public async initialize(
		sdkConfig: NodeSDKConfig,
		rpcManager: RPCManager,
		wsRPC: string,
	) {
		this.sdkConfig = sdkConfig;
		await this.sdk.initialize(this.sdkConfig, rpcManager);
		await this.eventListener.initialize(this.sdk, sdkConfig, wsRPC);
		this.initWebSocket();
		this.routes();
	}

	/**
	 * Check last event occurrences and determine whether
	 * to re-connect to RPC or not (and connect)
	 * @param newWsRPC new rpc address
	 * @returns true if rest successful
	 */
	public async checkTradeEventListenerHeartbeat(newWsRPC: string): Promise<boolean> {
		const lastEventTs = this.eventListener.lastBlockchainEventTsMs();
		// last trade event longer than 2 mins ago and recent market order submission (so no execution observed)
		const checkMktOrderFreq = this.eventListener.doMarketOrderFrequenciesMatch();
		const lastEventTooOld = Date.now() - lastEventTs > 10 * 60_000;
		const [c, d] = this.eventListener.getMarketOrderFrequencies();
		const msg = `Last event: ${
			Math.floor((Date.now() - lastEventTs) / 1000 / 6) / 10
		}mins.`;
		const msgFreq2 = ` Order posted vs executed : ${c}:${d} `;
		console.log();

		if (lastEventTooOld || !checkMktOrderFreq) {
			// no event since timeSeconds, restart listener
			this.logger.info(
				msg +
					msgFreq2 +
					` - restarting event listener. Last event too old? ${lastEventTooOld}; Trade/Post freq match? ${checkMktOrderFreq}`,
			);
			try {
				this.eventListener.resetRPCWebsocket(newWsRPC);
			} catch (error) {
				this.logger.error("resetRPCWebsocket failed: " + error);
				return false;
			}

			this.lastRequestTsMs = Date.now();
		} else {
			this.logger.info(msg + msgFreq2 + ` - no restart`);
		}
		return true;
	}

	public static JSONResponse(
		type: string,
		msg: string,
		dataObj: object | string,
	): string {
		if (typeof dataObj == "string") {
			dataObj = JSON.parse(dataObj);
		}
		return JSON.stringify({ type: type, msg: msg, data: dataObj });
	}

	private initWebSocket() {
		const eventListener = this.eventListener;
		const sdk = this.sdk;
		this.wss.on(
			"connection",
			function connection(ws: WebSocket.WebSocket, req: IncomingMessage) {
				ws.on("error", console.error);
				ws.on("message", async (data: WebSocket.RawData) => {
					try {
						const obj = JSON.parse(data.toString());
						if (obj.type == "ping") {
							if (eventListener.isWsKnown(ws)) {
								ws.send(
									D8XBrokerBackendApp.JSONResponse("ping", "pong", {}),
								);
							}
						} else if (obj.type == "unsubscribe") {
							eventListener.unsubscribe(ws, req);
						} else {
							//type = subscription
							if (
								typeof obj.traderAddr != "string" ||
								typeof obj.symbol != "string" ||
								!isValidAddress(obj.traderAddr) ||
								!isValidPerpSymbol(obj.symbol)
							) {
								throw new Error(
									"wrong arguments. Requires traderAddr and symbol",
								);
							}

							// Make sure the client provided symbol is
							// in uppercase, since SDK provides uppercase
							// symbols for perpetuals.
							obj.symbol = obj.symbol.toUpperCase();

							const perpState: PerpetualState =
								await sdk.extractPerpetualStateFromExchangeInfo(
									obj.symbol,
								);
							eventListener.subscribe(ws, obj.symbol, obj.traderAddr);
							ws.send(
								D8XBrokerBackendApp.JSONResponse(
									"subscription",
									obj.symbol,
									perpState,
								),
							);
						}
					} catch (err: any) {
						const usage = "{symbol: BTC-USD-MATIC, traderAddr: 0xCAFE...}";
						ws.send(
							D8XBrokerBackendApp.JSONResponse(
								"error",
								"websocket subscribe",
								{
									usage: usage,
									error: extractErrorMsg(err),
								},
							),
						);
					}
				});
				ws.on("close", () => {
					eventListener.unsubscribe(ws, req);
				});
				ws.send(D8XBrokerBackendApp.JSONResponse("connect", `success`, {}));
			},
		);
		this.logger.info(`⚡️[server]: WS is running at ws://localhost:${this.portWS}`);
	}

	private middleWare() {
		this.express.use(express.urlencoded({ extended: false }));
		if (this.CORS_ON) {
			this.express.use(cors()); //needs to be above express.json
		}
		this.express.use(express.json());
	}

	private routes() {
		this.express.listen(this.port, async () => {
			this.logger.info(
				`⚡️[server]: HTTP is running at http://localhost:${this.port}`,
			);
		});

		this.express.post("/", (req: Request, res: Response) => {
			res.status(201).send(
				D8XBrokerBackendApp.JSONResponse("/", "Express + TypeScript Server", {}),
			);
		});

		this.express.get("/exchange-info", async (req: Request, res: Response) => {
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				const rsp = await this.sdk.exchangeInfo();
				res.send(D8XBrokerBackendApp.JSONResponse("exchange-info", "", rsp));
			} catch (err: any) {
				console.log("Error in /exchange-info");
				console.log(err);
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "exchange-info", {
						error: "exchange info failed",
					}),
				);
			}
		});

		this.express.get("/open-orders", async (req: Request, res: Response) => {
			// open-orders?traderAddr=0xCafee&symbol=BTC-USD-MATIC
			let rsp;
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				let addr: string;
				let symbol: string | undefined;
				if (
					typeof req.query.traderAddr != "string" ||
					!isValidAddress(req.query.traderAddr) ||
					(req.query.symbol != undefined &&
						typeof req.query.symbol != "string") ||
					(req.query.symbol != undefined &&
						!isValidPerpSymbol(req.query.symbol))
				) {
					throw new Error("wrong arguments. Requires traderAddr and symbol");
				} else {
					addr = req.query.traderAddr;
					symbol = req.query.symbol;
					rsp = await this.sdk.openOrders(addr.toString(), symbol);
				}
				res.send(D8XBrokerBackendApp.JSONResponse("open-orders", "", rsp));
			} catch (err: any) {
				const usg = "open-orders?traderAddr=0xCafee&symbol=BTC-USD-MATIC";
				console.log("error open-orders");
				console.log(err);
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "open-orders", {
						error: "error for open-orders",
						usage: usg,
					}),
				);
			}
		});

		this.express.get("/trading-fee", async (req: Request, res: Response) => {
			let rsp;
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				let traderAddr: string;
				let poolSymbol: string;
				if (
					typeof req.query.traderAddr != "string" ||
					typeof req.query.poolSymbol != "string" ||
					!isValidAddress(req.query.traderAddr)
				) {
					throw new Error(
						"wrong arguments. Requires traderAddr and poolSymbol",
					);
				} else {
					traderAddr = req.query.traderAddr;
					poolSymbol = req.query.poolSymbol;
					rsp = await this.sdk.queryFee(traderAddr, poolSymbol);
					res.send(D8XBrokerBackendApp.JSONResponse("trading-fee", "", rsp));
				}
			} catch (err: any) {
				const usg = "trading-fee?traderAddr=0xCafee&poolSymbol=MATIC";
				console.log("error trading-fee", extractErrorMsg(err));
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "trading-fee", {
						error: "error for trading-fee",
						usage: usg,
					}),
				);
			}
		});

		this.express.get("/position-risk", async (req: Request, res: Response) => {
			// http://localhost:3001/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=BTC-USD-MATIC
			// http://localhost:3001/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC
			let rsp;
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				let addr: string;
				let symbol: string | undefined;
				if (
					typeof req.query.traderAddr != "string" ||
					!isValidAddress(req.query.traderAddr) ||
					(req.query.symbol != undefined && typeof req.query.symbol != "string")
				) {
					throw new Error("wrong arguments. Requires traderAddr");
				} else {
					addr = req.query.traderAddr;
					symbol = req.query.symbol;
					rsp = await this.sdk.positionRisk(addr.toString(), symbol);
					res.send(D8XBrokerBackendApp.JSONResponse("position-risk", "", rsp));
				}
			} catch (err: any) {
				const usg = "position-risk?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
				console.log("error for position-risk:", extractErrorMsg(err));
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "position-risk", {
						error: "error for position risk",
						usage: usg,
					}),
				);
			}
		});

		this.express.get(
			"/max-order-size-for-trader",
			async (req: Request, res: Response) => {
				let rsp: string;
				res.setHeader("Content-Type", "application/json");
				try {
					this.lastRequestTsMs = Date.now();
					let addr: string;
					let symbol: string;
					if (
						typeof req.query.traderAddr != "string" ||
						!isValidAddress(req.query.traderAddr) ||
						typeof req.query.symbol != "string"
					) {
						throw new Error(
							"wrong arguments. Requires traderAddr and symbol",
						);
					} else {
						addr = req.query.traderAddr;
						symbol = req.query.symbol;
						rsp = await this.sdk.maxOrderSizeForTrader(
							addr.toString(),
							symbol.toString(),
						);
						res.send(
							D8XBrokerBackendApp.JSONResponse(
								"max-order-size-for-trader",
								"",
								rsp,
							),
						);
					}
				} catch (err: any) {
					console.log(
						"error for max-order-size-for-trader:",
						extractErrorMsg(err),
					);
					const usg =
						"max-order-size-for-trader?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
					res.send(
						D8XBrokerBackendApp.JSONResponse(
							"error",
							"max-order-size-for-trader",
							{
								error: "error for max-order-size-for-trader",
								usage: usg,
							},
						),
					);
				}
			},
		);

		this.express.get(
			"/perpetual-static-info",
			async (req: Request, res: Response) => {
				res.setHeader("Content-Type", "application/json");
				try {
					this.lastRequestTsMs = Date.now();
					if (typeof req.query.symbol != "string") {
						throw new Error("wrong argument. Requires a symbol.");
					}
					const rsp = this.sdk.perpetualStaticInfo(req.query.symbol);
					res.send(
						D8XBrokerBackendApp.JSONResponse(
							"perpetual-static-info",
							"",
							rsp,
						),
					);
				} catch (err: any) {
					const usg = "perpetual-static-info?symbol=BTC-USD-MATIC";
					console.log(
						"error for max-order-size-for-trader:",
						extractErrorMsg(err),
					);
					res.send(
						D8XBrokerBackendApp.JSONResponse(
							"error",
							"perpetual-static-info",
							{
								error: "error for perpetual-static-info",
								usage: usg,
							},
						),
					);
				}
			},
		);

		// see test/post.test.ts for an example
		this.express.post("/order-digest", async (req, res) => {
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				const orders: Order[] = <Order[]>req.body.orders;
				const traderAddr: string = req.body.traderAddr;
				const rsp = await this.sdk.orderDigest(orders, traderAddr);
				res.send(D8XBrokerBackendApp.JSONResponse("order-digest", "", rsp));
			} catch (err: any) {
				const usg = "{orders: <orderstruct>, traderAddr: string}";
				console.log("error for order-digest:", extractErrorMsg(err));
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "order-digest", {
						error: "error for order digest",
						usage: usg,
					}),
				);
			}
		});

		this.express.post("/position-risk-on-collateral-action", async (req, res) => {
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				const traderAddr: string = req.body.traderAddr;
				const deltaCollateral: number = <number>req.body.amount;
				const curPositionRisk: MarginAccount = <MarginAccount>(
					req.body.positionRisk
				);
				const rsp = await this.sdk.positionRiskOnCollateralAction(
					traderAddr,
					deltaCollateral,
					curPositionRisk,
				);
				res.send(
					D8XBrokerBackendApp.JSONResponse(
						"position-risk-on-collateral-action",
						"",
						rsp,
					),
				);
			} catch (err: any) {
				const usg =
					"{traderAddr: string, amount: number, positionRisk: <MarginAccount struct>}";
				console.log(
					"error for position-risk-on-collateral-action:",
					extractErrorMsg(err),
				);
				res.setHeader("Content-Type", "application/json");
				res.send(
					D8XBrokerBackendApp.JSONResponse(
						"error",
						"position-risk-on-collateral-action",
						{
							error: "error for position-risk-on-collateral-action",
							usage: usg,
						},
					),
				);
			}
		});

		this.express.get("/add-collateral", async (req: Request, res: Response) => {
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				if (typeof req.query.symbol != "string") {
					throw new Error("wrong arguments. Requires a symbol.");
				}
				const rsp = await this.sdk.addCollateral(req.query.symbol);
				res.send(D8XBrokerBackendApp.JSONResponse("add-collateral", "", rsp));
			} catch (err: any) {
				const usg = "add-collateral?symbol=MATIC-USDC-USDC";
				console.log("error for add-collateral:", extractErrorMsg(err));
				res.setHeader("Content-Type", "application/json");
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "add-collateral", {
						error: "error for add-collateral",
						usage: usg,
					}),
				);
			}
		});

		this.express.get("/order-book", async (req: Request, res: Response) => {
			res.setHeader("Content-Type", "application/json");
			try {
				if (typeof req.query.symbol != "string") {
					throw new Error(
						"wrong arguments. Requires a symbol of the form WOKB-USD-WOKB.",
					);
				}
				const rsp = await this.sdk.queryOrderBooks(req.query.symbol);
				res.send(D8XBrokerBackendApp.JSONResponse("order-books", "", rsp));
			} catch (err: any) {
				const usg = "order-book?symbol=WOKB-USD-WOKB";
				console.log("order-book:", extractErrorMsg(err));
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "order-book", {
						error: "error",
						usage: usg,
					}),
				);
			}
		});

		this.express.get("/remove-collateral", async (req: Request, res: Response) => {
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				if (typeof req.query.symbol != "string") {
					throw new Error("wrong arguments. Requires a symbol.");
				}
				const rsp = await this.sdk.removeCollateral(req.query.symbol);
				res.send(D8XBrokerBackendApp.JSONResponse("remove-collateral", "", rsp));
			} catch (err: any) {
				const usg = "remove-collateral?symbol=MATIC";
				console.log("error for remove-collateral:", extractErrorMsg(err));
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "remove-collateral", {
						error: "error",
						usage: usg,
					}),
				);
			}
		});

		this.express.get("/available-margin", async (req: Request, res: Response) => {
			res.setHeader("Content-Type", "application/json");

			try {
				this.lastRequestTsMs = Date.now();
				if (
					typeof req.query.symbol != "string" ||
					typeof req.query.traderAddr != "string"
				) {
					throw new Error(
						"wrong arguments. Requires a symbol and a trader address.",
					);
				}
				const rsp = await this.sdk.getAvailableMargin(
					req.query.symbol,
					req.query.traderAddr,
				);
				res.send(D8XBrokerBackendApp.JSONResponse("available-margin", "", rsp));
			} catch (err: any) {
				const usg = "available-margin?symbol=BTC-USD-MATIC&traderAddr=0xCaffEe";
				console.log("error for available-margin:", extractErrorMsg(err));
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "available-margin", {
						error: "",
						usage: usg,
					}),
				);
			}
		});

		this.express.get("/cancel-order", async (req: Request, res: Response) => {
			res.setHeader("Content-Type", "application/json");
			try {
				this.lastRequestTsMs = Date.now();
				if (
					typeof req.query.symbol != "string" ||
					typeof req.query.orderId != "string"
				) {
					throw new Error(
						"wrong arguments. Requires a symbol and an order Id.",
					);
				}
				const rsp = await this.sdk.cancelOrder(
					req.query.symbol,
					req.query.orderId,
				);
				res.send(D8XBrokerBackendApp.JSONResponse("cancel-order", "", rsp));
			} catch (err: any) {
				const usg = "cancel-order?symbol=BTC-USD-MATIC&orderId=0xCaffEe";
				console.log("error for cancel-order:", extractErrorMsg(err));
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "cancel-order", {
						error: "",
						usage: usg,
					}),
				);
			}
		});
	}
}
