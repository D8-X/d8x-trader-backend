import { ReferralCodeSigner } from "@d8x/perpetuals-sdk";
import { APIReferralCodePayload } from "@d8x/perpetuals-sdk";
import { ethers } from "ethers";

const pk = <string>process.env.PK;

async function main() {
  const rpcURL = "https://matic-mumbai.chainstacklabs.com";
  const codeSigner = new ReferralCodeSigner(pk, rpcURL);

  let myAddr = await codeSigner.getAddress();

  let pyld: APIReferralCodePayload = {
    code: "MY_CODE11",
    referrerAddr: myAddr,
    agencyAddr: "",
    createdOn: 1695015897,
    traderRebatePerc: 5,
    agencyRebatePerc: 80,
    referrerRebatePerc: 20,
    signature: "",
  };
  pyld = {
    code: "MY_CODE_46",
    referrerAddr: myAddr,
    agencyAddr: "",
    createdOn: 1695015897,
    traderRebatePerc: 6,
    agencyRebatePerc: 0,
    referrerRebatePerc: 94,
    signature: "",
  };

  let sg = await codeSigner.getSignatureForNewCode(pyld);
  pyld.signature = sg;
  console.log("Payload = ", pyld);
  let b = ReferralCodeSigner.checkNewCodeSignature(pyld);
  if (!b) {
    Error("signature check failed");
  }
}
main();
