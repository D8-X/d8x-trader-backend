import ReferralCodeSigner from "../src/svc/referralCodeSigner";
import { ReferralCodePayload } from "../src/referralTypes";
import { ethers } from "ethers";

const pk = <string>process.env.PK;

async function main() {
  const rpcURL = "https://matic-mumbai.chainstacklabs.com";
  const codeSigner = new ReferralCodeSigner(pk, rpcURL);

  await codeSigner.createSignerInstance();
  let myAddr = await codeSigner.getAddress();

  let pyld: ReferralCodePayload = {
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

  let sg = await codeSigner.getReferralCodeDataSignature(pyld);
  pyld.signature = sg;
  console.log("Payload = ", pyld);
  let b = ReferralCodeSigner.checkSignature(pyld);
  if (!b) {
    Error("signature check failed");
  }
}
main();
