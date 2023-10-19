import express, { Express, Request, Response } from "express";
import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import dotenv from "dotenv";
import SDKInterface from "./sdkInterface";
import { extractErrorMsg } from "utils";
import { Order, PerpetualState, NodeSDKConfig, MarginAccount } from "@d8x/perpetuals-sdk";
import EventListener from "./eventListener";
import BrokerIntegration from "./brokerIntegration";
import { Logger } from "winston";
import cors from "cors";
dotenv.config();
//https://roger13.github.io/SwagDefGen/
//setAllowance?

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

	constructor(broker: BrokerIntegration, sdkConfig: NodeSDKConfig, public logger: Logger) {
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

	public async initialize(sdkConfig: NodeSDKConfig, wsRPC: string) {
		this.sdkConfig = sdkConfig;
		await this.sdk.initialize(this.sdkConfig);
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
	public async checkTradeEventListenerHeartbeat(newWsRPC: string) : Promise<boolean> {
		const lastEventTs = this.eventListener.lastBlockchainEventTsMs();
		// last trade event longer than 2 mins ago and recent market order submission (so no execution observed)
		const checkMktOrderFreq = this.eventListener.doMarketOrderFrequenciesMatch();
		const lastEventTooOld = Date.now() - lastEventTs > 10 * 60_000;
		let [c, d] = this.eventListener.getMarketOrderFrequencies();
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
					` - restarting event listener. Last event too old? ${lastEventTooOld}; Trade/Post freq match? ${checkMktOrderFreq}`
			);
			try {
				this.eventListener.resetRPCWebsocket(newWsRPC);
			} catch (error) {
				this.logger.error("resetRPCWebsocket failed: "+error)
				return false;
			}
			
			this.lastRequestTsMs = Date.now();
		} else {
			this.logger.info(msg + msgFreq2 + ` - no restart`);
		}
		return true
	}

	public static JSONResponse(
		type: string,
		msg: string,
		dataObj: object | string
	): string {
		if (typeof dataObj == "string") {
			dataObj = JSON.parse(dataObj);
		}
		return JSON.stringify({ type: type, msg: msg, data: dataObj });
	}

	private initWebSocket() {
		let eventListener = this.eventListener;
		let sdk = this.sdk;
		this.wss.on(
			"connection",
			function connection(ws: WebSocket.WebSocket, req: IncomingMessage) {
				ws.on("error", console.error);
				ws.on("message", async (data: WebSocket.RawData) => {
					try {
						let obj = JSON.parse(data.toString());
						if (obj.type == "ping") {
							if (eventListener.isWsKnown(ws)) {
								ws.send(
									D8XBrokerBackendApp.JSONResponse("ping", "pong", {})
								);
							}
						} else if (obj.type == "unsubscribe") {
							eventListener.unsubscribe(ws, req);
						} else {
							console.log("received: ", obj);
							//type = subscription
							if (
								typeof obj.traderAddr != "string" ||
								typeof obj.symbol != "string"
							) {
								throw new Error(
									"wrong arguments. Requires traderAddr and symbol"
								);
							}
							let perpState: PerpetualState =
								await sdk.extractPerpetualStateFromExchangeInfo(
									obj.symbol
								);
							eventListener.subscribe(ws, obj.symbol, obj.traderAddr);
							ws.send(
								D8XBrokerBackendApp.JSONResponse(
									"subscription",
									obj.symbol,
									perpState
								)
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
								}
							)
						);
					}
				});
				ws.on("close", () => {
					eventListener.unsubscribe(ws, req);
				});
				ws.send(D8XBrokerBackendApp.JSONResponse("connect", `success`, {}));
			}
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
			this.logger.info(`⚡️[server]: HTTP is running at http://localhost:${this.port}`);
		});

		this.express.post("/", (req: Request, res: Response) => {
			res.status(201).send(
				D8XBrokerBackendApp.JSONResponse("/", "Express + TypeScript Server", {})
			);
		});

		this.express.get("/exchange-info", async (req: Request, res: Response) => {
			try {
				this.lastRequestTsMs = Date.now();
				let rsp = await this.sdk.exchangeInfo();
				res.send(D8XBrokerBackendApp.JSONResponse("exchange-info", "", rsp));
			} catch (err: any) {
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "exchange-info", {
						error: extractErrorMsg(err),
					})
				);
			}
		});

		this.express.get("/open-orders", async (req: Request, res: Response) => {
			// open-orders?traderAddr=0xCafee&symbol=BTC-USD-MATIC
			let rsp;
			try {
				this.lastRequestTsMs = Date.now();
				let addr: string;
				let symbol: string | undefined;
				if (
					typeof req.query.traderAddr != "string" ||
					(req.query.symbol != undefined && typeof req.query.symbol != "string")
				) {
					throw new Error("wrong arguments. Requires traderAddr and symbol");
				} else {
					addr = req.query.traderAddr;
					symbol = req.query.symbol;
					rsp = await this.sdk.openOrders(addr.toString(), symbol);
				}
				res.send(D8XBrokerBackendApp.JSONResponse("open-orders", "", rsp));
			} catch (err: any) {
				let usg = "open-orders?traderAddr=0xCafee&symbol=BTC-USD-MATIC";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "open-orders", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.get("/trading-fee", async (req: Request, res: Response) => {
			let rsp;
			try {
				this.lastRequestTsMs = Date.now();
				let traderAddr: string;
				let poolSymbol: string;
				if (
					typeof req.query.traderAddr != "string" ||
					typeof req.query.poolSymbol != "string"
				) {
					throw new Error(
						"wrong arguments. Requires traderAddr and poolSymbol"
					);
				} else {
					traderAddr = req.query.traderAddr;
					poolSymbol = req.query.poolSymbol;
					rsp = await this.sdk.queryFee(traderAddr, poolSymbol);
					res.send(D8XBrokerBackendApp.JSONResponse("trading-fee", "", rsp));
				}
			} catch (err: any) {
				const usg = "trading-fee?traderAddr=0xCafee&poolSymbol=MATIC";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "trading-fee", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.get("/position-risk", async (req: Request, res: Response) => {
			// http://localhost:3001/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=BTC-USD-MATIC
			// http://localhost:3001/position-risk?traderAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05&symbol=MATIC
			let rsp;
			try {
				this.lastRequestTsMs = Date.now();
				let addr: string;
				let symbol: string | undefined;
				if (
					typeof req.query.traderAddr != "string" ||
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
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "position-risk", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.get(
			"/max-order-size-for-trader",
			async (req: Request, res: Response) => {
				let rsp: string;
				try {
					this.lastRequestTsMs = Date.now();
					let addr: string;
					let symbol: string;
					if (
						typeof req.query.traderAddr != "string" ||
						typeof req.query.symbol != "string"
					) {
						throw new Error(
							"wrong arguments. Requires traderAddr and symbol"
						);
					} else {
						addr = req.query.traderAddr;
						symbol = req.query.symbol;
						rsp = await this.sdk.maxOrderSizeForTrader(
							addr.toString(),
							symbol.toString()
						);
						res.send(
							D8XBrokerBackendApp.JSONResponse(
								"max-order-size-for-trader",
								"",
								rsp
							)
						);
					}
				} catch (err: any) {
					const usg =
						"max-order-size-for-trader?traderAddr=0xCafee&symbol=MATIC-USD-MATIC";
					res.send(
						D8XBrokerBackendApp.JSONResponse(
							"error",
							"max-order-size-for-trader",
							{
								error: extractErrorMsg(err),
								usage: usg,
							}
						)
					);
				}
			}
		);

		this.express.get("/trader-loyalty", async (req: Request, res: Response) => {
			let rsp: string;
			try {
				this.lastRequestTsMs = Date.now();
				let addr: string;
				if (typeof req.query.traderAddr != "string") {
					throw new Error("wrong arguments. Requires traderAddr");
				} else {
					addr = req.query.traderAddr;
					rsp = await this.sdk.traderLoyalty(addr.toString());
					res.send(D8XBrokerBackendApp.JSONResponse("trader-loyalty", "", rsp));
				}
			} catch (err: any) {
				const usg = "trader-loyalty?traderAddr=0xCafee";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "trader-loyalty", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.get(
			"/perpetual-static-info",
			async (req: Request, res: Response) => {
				try {
					this.lastRequestTsMs = Date.now();
					if (typeof req.query.symbol != "string") {
						throw new Error("wrong argument. Requires a symbol.");
					}
					let rsp = this.sdk.perpetualStaticInfo(req.query.symbol);
					res.send(
						D8XBrokerBackendApp.JSONResponse("perpetual-static-info", "", rsp)
					);
				} catch (err: any) {
					const usg = "perpetual-static-info?symbol=BTC-USD-MATIC";
					res.send(
						D8XBrokerBackendApp.JSONResponse(
							"error",
							"perpetual-static-info",
							{
								error: extractErrorMsg(err),
								usage: usg,
							}
						)
					);
				}
			}
		);

		// see test/post.test.ts for an example
		this.express.post("/order-digest", async (req, res) => {
			try {
				this.lastRequestTsMs = Date.now();
				let orders: Order[] = <Order[]>req.body.orders;
				let traderAddr: string = req.body.traderAddr;
				let rsp = await this.sdk.orderDigest(orders, traderAddr);
				res.send(D8XBrokerBackendApp.JSONResponse("order-digest", "", rsp));
			} catch (err: any) {
				const usg = "{orders: <orderstruct>, traderAddr: string}";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "order-digest", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.post("/position-risk-on-collateral-action", async (req, res) => {
			try {
				this.lastRequestTsMs = Date.now();
				let traderAddr: string = req.body.traderAddr;
				let deltaCollateral: number = <number>req.body.amount;
				let curPositionRisk: MarginAccount = <MarginAccount>req.body.positionRisk;
				let rsp = await this.sdk.positionRiskOnCollateralAction(
					traderAddr,
					deltaCollateral,
					curPositionRisk
				);
				res.send(
					D8XBrokerBackendApp.JSONResponse(
						"position-risk-on-collateral-action",
						"",
						rsp
					)
				);
			} catch (err: any) {
				const usg =
					"{traderAddr: string, amount: number, positionRisk: <MarginAccount struct>}";
				res.send(
					D8XBrokerBackendApp.JSONResponse(
						"error",
						"position-risk-on-collateral-action",
						{
							error: extractErrorMsg(err),
							usage: usg,
						}
					)
				);
			}
		});

		this.express.get("/add-collateral", async (req: Request, res: Response) => {
			try {
				this.lastRequestTsMs = Date.now();
				if (
					typeof req.query.symbol != "string" ||
					typeof req.query.amount != "string"
				) {
					throw new Error("wrong arguments. Requires a symbol and an amount.");
				}
				let rsp = await this.sdk.addCollateral(
					req.query.symbol,
					req.query.amount
				);
				res.send(D8XBrokerBackendApp.JSONResponse("add-collateral", "", rsp));
			} catch (err: any) {
				const usg = "add-collateral?symbol=MATIC-USDC-USDC&amount='110.4'";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "add-collateral", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.get("/remove-collateral", async (req: Request, res: Response) => {
			try {
				this.lastRequestTsMs = Date.now();
				if (
					typeof req.query.symbol != "string" ||
					typeof req.query.amount != "string"
				) {
					throw new Error("wrong arguments. Requires a symbol and an amount.");
				}
				let rsp = await this.sdk.removeCollateral(
					req.query.symbol,
					req.query.amount
				);
				res.send(D8XBrokerBackendApp.JSONResponse("remove-collateral", "", rsp));
			} catch (err: any) {
				const usg = "remove-collateral?symbol=MATIC&amount='110.4'";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "remove-collateral", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.get("/available-margin", async (req: Request, res: Response) => {
			try {
				this.lastRequestTsMs = Date.now();
				if (
					typeof req.query.symbol != "string" ||
					typeof req.query.traderAddr != "string"
				) {
					throw new Error(
						"wrong arguments. Requires a symbol and a trader address."
					);
				}
				let rsp = await this.sdk.getAvailableMargin(
					req.query.symbol,
					req.query.traderAddr
				);
				res.send(D8XBrokerBackendApp.JSONResponse("available-margin", "", rsp));
			} catch (err: any) {
				const usg = "available-margin?symbol=BTC-USD-MATIC&traderAddr=0xCaffEe";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "available-margin", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});

		this.express.get("/cancel-order", async (req: Request, res: Response) => {
			try {
				this.lastRequestTsMs = Date.now();
				if (
					typeof req.query.symbol != "string" ||
					typeof req.query.orderId != "string"
				) {
					throw new Error(
						"wrong arguments. Requires a symbol and an order Id."
					);
				}
				let rsp = await this.sdk.cancelOrder(req.query.symbol, req.query.orderId);
				res.send(D8XBrokerBackendApp.JSONResponse("cancel-order", "", rsp));
			} catch (err: any) {
				const usg = "cancel-order?symbol=BTC-USD-MATIC&orderId=0xCaffEe";
				res.send(
					D8XBrokerBackendApp.JSONResponse("error", "cancel-order", {
						error: extractErrorMsg(err),
						usage: usg,
					})
				);
			}
		});
	}
}
