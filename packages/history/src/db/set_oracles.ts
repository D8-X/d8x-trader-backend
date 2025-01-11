import {  SetOraclesEvent } from "../contracts/types";
import { BigNumberish, Contract } from "ethers";
import { PrismaClient } from "@prisma/client";
import { IPerpetualManager } from "@d8x/perpetuals-sdk";
import { Logger } from "winston";

// used for PerpetualLongId
export class SetOracles {
    constructor(
        public chainId: BigNumberish,
        public prisma: PrismaClient,
        public l: Logger,
    ) {}

    private fromBytes4(hexStr: string) : string {
        const buffer = Buffer.from(hexStr.slice(2), "hex");
        const val = buffer.toString("ascii").replace(/\0/g, "");
        return val;
    }

    public async insertSetOraclesRecord(
		e: SetOraclesEvent,
		txHash: string,
		isCollectedByEvent: boolean,
		blockTimestamp: number,
		blockNumber: number,
	) {
		const perpId =Number(e.perpetualId.toString())
		const S2=this.fromBytes4(e.baseQuoteS2[0])+"-"+this.fromBytes4(e.baseQuoteS2[1])
		const S3=this.fromBytes4(e.baseQuoteS3[0])+"-"+this.fromBytes4(e.baseQuoteS3[1])
		await this.insertPerpetualLongId("SetOraclesEvent", perpId, S2, S3, txHash, blockTimestamp, blockNumber)
	}

	private async insertPerpetualLongId(
		evtName: string,
		perpId: number,
		S2:string,
		S3:string,
		txHash: string,
		blockTimestamp: number,
		blockNumber: number,
	) {
		let name = S2;
		if (S3=='-') {
			// linear (quote) perpetual 
			name = name+"-"+S2.split('-')[1]
		} else {
			// base: btc-usd btc-usd
			// or quanto: btc-usd eth-usd
			name = name+"-"+S3.split('-')[0]
		}
		console.log(`${evtName} at block ${blockNumber} ts ${blockTimestamp} ${perpId} ${S2} ${S3} -> ${name}`)
        txHash = txHash.toLowerCase();
        const exists = await this.prisma.perpetualLongId.findFirst({
			where: {
				tx_hash: {
					equals: txHash,
				},
			},
		});
		try{
			if (exists === null) {
				const farDate = new Date("9999-12-31")
				// we need to adjust the valid_to timestamp of
				// the predecessor
				const currDate = new Date(blockTimestamp * 1000);
				const predecessor = await this.prisma.perpetualLongId.findFirst({
					select: {
						tx_hash: true,
					},
					where: {
						AND: [{valid_to: {equals: farDate}}, 
							{valid_from: {lt: currDate}},
							{perpetual_id: {equals: perpId}}]
					},
					orderBy: [
						{
							valid_from: 'desc',
						}
					]
				})
				if (predecessor!=null) {
					this.l.info(`adjusting perpetualLongId ${predecessor.tx_hash}`, 
						{valid_to: currDate});
					// adjust valid_to
					await this.prisma.perpetualLongId.update({
						where: {
							tx_hash: predecessor.tx_hash,
						},
						data: {
							valid_to: currDate,
						}
					})
				}
				this.l.info(`adding perpetualLongId ${txHash}`, {
					perpetual_id: perpId,
					perpetual_name: name,
					valid_to: currDate,	
				});
				let data = {
					perpetual_id: perpId,
					perpetual_name: name,
					valid_from: currDate,
					valid_to: farDate,
					tx_hash: txHash
				}
				await this.prisma.perpetualLongId.create({
					data,
				});
			}
		} catch (e) {
			this.l.error(`insertPerpetualLongId`, {
				error: e,
			});
			return;
		}
    }


}//class