import axios from "axios";
import { ethers } from "ethers";
import { MarginAccount, Order } from "@d8x/perpetuals-sdk";

//const HOST_URL = "https://dev.testnet.d8x.exchange/api/v1/"; // use this to test after deployment
// const HOST_URL =  "http://localhost:3001/"; // use this to test before deployment
const HOST_URL = "https://api-mainnet.d8x.trade/";

const pk = <string>process.env.PK;

function _orderDigest() {
	let wallet = new ethers.Wallet(pk);
	let order1: Order = {
		symbol: "MATIC-USD-MATIC",
		side: "SELL",
		type: "LIMIT",
		limitPrice: 1,
		quantity: 5,
		leverage: 2,
		executionTimestamp: Math.floor(Date.now() / 1000),
		deadline: Math.floor(Date.now() / 1000 + 8 * 60 * 60), // order expires 8 hours from now
	};
	let order2: Order = {
		symbol: "MATIC-USD-MATIC",
		side: "BUY",
		type: "MARKET",
		limitPrice: 1,
		quantity: 5,
		leverage: 2,
		executionTimestamp: Math.floor(Date.now() / 1000),
		deadline: Math.floor(Date.now() / 1000 + 8 * 60 * 60), // order expires 8 hours from now
	};
	let s = JSON.stringify({ orders: [order1, order2], traderAddr: wallet.address });
	console.log(s);
	return ["orderDigest", s];
}

function _positionRiskOnTrade() {
	let wallet = new ethers.Wallet(pk);
	let order: Order = {
		symbol: "MATIC-USD-MATIC",
		side: "SELL",
		type: "MARKET",
		limitPrice: 1,
		quantity: 200,
		leverage: 1,
		executionTimestamp: Math.floor(Date.now() / 1000),
		deadline: Math.floor(Date.now() / 1000 + 8 * 60 * 60), // order expires 8 hours from now
	};
	let s = JSON.stringify({ order: order, traderAddr: wallet.address });
	console.log(s);
	return ["positionRiskOnTrade", s];
}

async function _positionRiskOnCollateral() {
	let wallet = new ethers.Wallet(pk);
	let rsp = await axios.get(
		`${HOST_URL}position-risk?traderAddr=${wallet.address}&symbol=BTC-USDC-USDC`,
	);
	// console.log(curPositionRisk.data.data);
	let curPositionRisk = <MarginAccount>rsp.data.data;
	console.log(curPositionRisk);
	let s = JSON.stringify({
		traderAddr: wallet.address,
		amount: -100,
		positionRisk: curPositionRisk,
	});
	console.log(s);
	return ["positionRiskOnCollateralAction", s];
}

async function send() {
	// let message = _orderDigest();
	//let message = _positionRiskOnTrade();
	let message = await _positionRiskOnCollateral();

	let data = await axios.post(`${HOST_URL}${message[0]}/`, message[1], {
		headers: {
			// Overwrite Axios's automatically set Content-Type
			"Content-Type": "application/json",
		},
	});
	console.log(data.data);
}
send();
