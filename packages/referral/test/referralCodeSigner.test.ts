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
    code: "MY_CODE12",
    referrerAddr: ethers.constants.AddressZero,
    agencyAddr: myAddr,
    createdOn: Date.now() / 1000,
    traderRebatePerc: 5,
    agencyRebatePerc: 80,
    referrerRebatePerc: 20,
    signature: "",
  };

  let sg = await codeSigner.getReferralCodeDataSignature(pyld);
  pyld.signature = sg;
  let b = ReferralCodeSigner.checkSignature(pyld);
  if (!b) {
    Error("signature check failed");
  }
}
main();
