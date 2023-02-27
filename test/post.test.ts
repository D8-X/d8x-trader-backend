import axios from "axios";
import { ethers } from "ethers";
import { Order } from "@d8x/perpetuals-sdk";

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
    timestamp: Math.floor(Date.now() / 1000),
    deadline: Math.floor(Date.now() / 1000 + 8 * 60 * 60), // order expires 8 hours from now
  };
  let order2: Order = {
    symbol: "MATIC-USD-MATIC",
    side: "BUY",
    type: "MARKET",
    limitPrice: 1,
    quantity: 5,
    leverage: 2,
    timestamp: Math.floor(Date.now() / 1000),
    deadline: Math.floor(Date.now() / 1000 + 8 * 60 * 60), // order expires 8 hours from now
  };
  // let options = {
  //   method: "POST",
  //   url: "http://localhost:3001/orderDigest/",
  //   body: JSON.stringify(order),
  //   headers: {
  //     "Content-Type": "application/json",
  //     Accept: "application/json",
  //   },
  // };
  //const resp = await axios.post(options);
  //let data = await axios.get("http://localhost:3001/exchangeInfo/"); //, { json: JSON.stringify(order) }).json();
  let s = JSON.stringify({ orders: [order1, order2], traderAddr: wallet.address });
  console.log(s);
  return ["orderDigest", s];
}

function _positionRiskOnTrade() {
  let wallet = new ethers.Wallet(pk);
  let order: Order = {
    symbol: "MATIC-USD-MATIC",
    side: "SELL",
    type: "LIMIT",
    limitPrice: 1,
    quantity: 5,
    leverage: 2,
    timestamp: Math.floor(Date.now() / 1000),
    deadline: Math.floor(Date.now() / 1000 + 8 * 60 * 60), // order expires 8 hours from now
  };
  let options = {
    method: "POST",
    url: "http://localhost:3001/orderDigest/",
    body: JSON.stringify(order),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  //const resp = await axios.post(options);
  //let data = await axios.get("http://localhost:3001/exchangeInfo/"); //, { json: JSON.stringify(order) }).json();
  let s = JSON.stringify({ order: order, traderAddr: wallet.address });
  console.log(s);
  return ["positionRiskOnTrade", s];
}

async function send() {
  let message = _orderDigest();
  // let message = _positionRiskOnTrade();

  let data = await axios.post(`http://localhost:3001/${message[0]}/`, message[1], {
    headers: {
      // Overwrite Axios's automatically set Content-Type
      "Content-Type": "application/json",
    },
  });
  console.log(data.data);
}
send();
