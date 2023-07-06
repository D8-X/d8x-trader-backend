import { ethers } from "ethers";

import { APIReferralCodePayload, APIReferralCodeSelectionPayload } from "@d8x/perpetuals-sdk";
import { ReferralCodeSigner } from "@d8x/perpetuals-sdk";
let PK = process.env.PK ?? "";
let RPC = process.env.RPC ?? "https://matic-mumbai.chainstacklabs.com";

async function test() {
  await testCreateCodeFromAgency();
  await testCreateCodeFromReferrer();
  await testSelectCode();
}

async function testCreateCodeFromAgency() {
  if (PK == "") {
    throw Error("define PK");
  }
  const ts = Math.round(Date.now() / 1000);
  let mynewcode: APIReferralCodePayload = {
    code: "REBATE100XX",
    referrerAddr: "0x863AD9Ce46acF07fD9390147B619893461036194",
    agencyAddr: "0x9d5aaB428e98678d0E645ea4AeBd25f744341a05",
    createdOn: ts,
    traderRebatePerc: 15,
    agencyRebatePerc: 50,
    referrerRebatePerc: 35,
    signature: "",
  };
  let rc = new ReferralCodeSigner(PK, RPC);

  mynewcode.signature = await rc.getSignatureForNewCode(mynewcode);
  console.log(mynewcode);
  if (!(await ReferralCodeSigner.checkNewCodeSignature(mynewcode))) {
    throw Error("ops didn't fly");
  } else {
    console.log("success!");
  }
}

async function testCreateCodeFromReferrer() {
  if (PK == "") {
    throw Error("define PK");
  }
  const ts = 1687716653;
  let mynewcode: APIReferralCodePayload = {
    code: "REBATE100XX",
    referrerAddr: "0x9d5aaB428e98678d0E645ea4AeBd25f744341a05",
    agencyAddr: "",
    createdOn: ts,
    traderRebatePerc: 10,
    agencyRebatePerc: 0, //<-- must be zero without agency
    referrerRebatePerc: 90,
    signature: "",
  };
  let rc = new ReferralCodeSigner(PK, RPC);

  mynewcode.signature = await rc.getSignatureForNewCode(mynewcode);
  console.log(mynewcode);
  if (!(await ReferralCodeSigner.checkNewCodeSignature(mynewcode))) {
    throw Error("ops didn't fly");
  } else {
    console.log("success!");
  }
}

async function testSelectCode() {
  if (PK == "") {
    throw Error("define PK");
  }
  const ts = Math.round(Date.now() / 1000);
  const wallet = new ethers.Wallet(PK);
  const address = wallet.address;
  let mycodeselection: APIReferralCodeSelectionPayload = {
    code: "REBATE100XX", //"REBATE100",
    traderAddr: address,
    createdOn: ts,
    signature: "",
  };
  let rc = new ReferralCodeSigner(PK, RPC);

  mycodeselection.signature = await rc.getSignatureForCodeSelection(mycodeselection);
  console.log(mycodeselection);
  if (!(await ReferralCodeSigner.checkCodeSelectionSignature(mycodeselection))) {
    throw Error("ops didn't fly");
  } else {
    console.log("success!");
  }
}
test();
