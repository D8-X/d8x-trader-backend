import { Signer } from "@ethersproject/abstract-signer";
import { keccak256 } from "@ethersproject/keccak256";
import { BigNumber, ethers } from "ethers";
import { defaultAbiCoder } from "@ethersproject/abi";
import { APIReferralCodePayload, APIReferralCodeSelectionPayload } from "../referralTypes";
import { Provider, StaticJsonRpcProvider } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";

export default class ReferralCodeSigner {
  private privateKey: string;
  private provider: Provider | undefined;
  private rpcURL: string;
  private signer: ethers.Wallet | undefined;

  constructor(_privateKey: string, _rpcURL: string) {
    this.privateKey = _privateKey;
    this.rpcURL = _rpcURL;
  }

  public async createSignerInstance() {
    this.provider = new StaticJsonRpcProvider(this.rpcURL);
    const wallet = new Wallet(this.privateKey!);
    this.signer = wallet.connect(this.provider);
  }

  public async getSignatureForNewCode(rc: APIReferralCodePayload): Promise<string> {
    if (this.signer == undefined) {
      throw Error("no signer defined, call createSignerInstance()");
    }
    return await ReferralCodeSigner.getSignatureForNewCode(rc, this.signer);
  }

  public async getSignatureForCodeSelection(rc: APIReferralCodeSelectionPayload): Promise<string> {
    if (this.signer == undefined) {
      throw Error("no signer defined, call createSignerInstance()");
    }
    return await ReferralCodeSigner.getSignatureForCodeSelection(rc, this.signer);
  }

  public async getAddress(): Promise<string> {
    if (this.signer == undefined) {
      throw Error("no signer defined, call createSignerInstance()");
    }
    return await this.signer.getAddress();
  }

  public static async getSignatureForNewCode(rc: APIReferralCodePayload, signer: Signer): Promise<string> {
    let digest = ReferralCodeSigner._referralCodeNewCodePayloadToMessage(rc);
    let digestBuffer = Buffer.from(digest.substring(2, digest.length), "hex");
    return await signer.signMessage(digestBuffer);
  }

  public static async getSignatureForCodeSelection(
    rc: APIReferralCodeSelectionPayload,
    signer: Signer
  ): Promise<string> {
    let digest = ReferralCodeSigner._codeSelectionPayloadToMessage(rc);
    let digestBuffer = Buffer.from(digest.substring(2, digest.length), "hex");
    return await signer.signMessage(digestBuffer);
  }

  /**
   * Create digest for referralCodePayload that is to be signed
   * @param rc payload
   * @returns the hex-string to be signed
   */
  private static _referralCodeNewCodePayloadToMessage(rc: APIReferralCodePayload): string {
    let abiCoder = defaultAbiCoder;
    const traderRebateInt = Math.round(rc.traderRebatePerc * 100);
    const referrerRebateInt = Math.round(rc.referrerRebatePerc * 100);
    const agencyRebateInt = Math.round(rc.agencyRebatePerc * 100);
    const agencyAddrForSignature = rc.agencyAddr == "" ? ethers.constants.AddressZero : rc.agencyAddr;
    let digest = keccak256(
      abiCoder.encode(
        ["string", "address", "address", "uint256", "uint32", "uint32", "uint32"],
        [
          rc.code,
          rc.referrerAddr,
          agencyAddrForSignature,
          Math.round(rc.createdOn),
          traderRebateInt,
          agencyRebateInt,
          referrerRebateInt,
        ]
      )
    );
    return digest;
  }

  /**
   * Create digest for APIReferralCodeSelectionPayload that is to be signed
   * @param rc payload
   * @returns the hex-string to be signed
   */
  private static _codeSelectionPayloadToMessage(rc: APIReferralCodeSelectionPayload): string {
    let abiCoder = defaultAbiCoder;
    let digest = keccak256(
      abiCoder.encode(["string", "address", "uint256"], [rc.code, rc.traderAddr, Math.round(rc.createdOn)])
    );
    return digest;
  }

  /**
   * Check whether signature is correct on payload:
   * - either the agency signed
   * - or the referrer signed and the agency is 'set to 0'
   * @param rc referralcode payload with a signature
   * @returns true if correctly signed, false otherwise
   */
  public static async checkNewCodeSignature(rc: APIReferralCodePayload): Promise<boolean> {
    if (rc.signature == undefined || rc.signature == "") {
      return false;
    }
    try {
      let digest = ReferralCodeSigner._referralCodeNewCodePayloadToMessage(rc);
      let digestBuffer = Buffer.from(digest.substring(2, digest.length), "hex");
      const signerAddress = await ethers.utils.verifyMessage(digestBuffer, rc.signature);
      if (rc.agencyAddr.toLowerCase() == signerAddress.toLowerCase()) {
        return true;
      } else if (rc.referrerAddr == signerAddress) {
        // without agency. We ensure agency-address is zero and no rebate for the agency
        const zeroAgencyAddr = rc.agencyAddr == "" || ethers.constants.AddressZero == rc.agencyAddr;
        const zeroAgencyRebate = rc.agencyRebatePerc == 0;
        return zeroAgencyAddr && zeroAgencyRebate;
      } else {
        return false;
      }
    } catch (err) {
      return false;
    }
  }

  public static async checkCodeSelectionSignature(rc: APIReferralCodeSelectionPayload): Promise<boolean> {
    if (rc.signature == undefined || rc.signature == "") {
      return false;
    }
    try {
      let digest = ReferralCodeSigner._codeSelectionPayloadToMessage(rc);
      let digestBuffer = Buffer.from(digest.substring(2, digest.length), "hex");
      const signerAddress = await ethers.utils.verifyMessage(digestBuffer, rc.signature);
      return rc.traderAddr.toLowerCase() == signerAddress.toLowerCase();
    } catch (err) {
      return false;
    }
  }
}
