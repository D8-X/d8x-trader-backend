import { PrismaClient } from "@prisma/client";
import { Logger } from "winston";

export interface MarginTokenData {
	poolId: number;
	tokenAddr: string;
	tokenDecimals: number;
	tokenName: string;
}
export class MarginTokenInfo {
	constructor(
		public prisma: PrismaClient,
		public l: Logger,
	) {}

	/**
	 * Insert new pool margin token
	 * @param poolId
	 * @param tokenAddr
	 * @param tokenName
	 * @param tokenDecimals
	 */
	public async insert(m: MarginTokenData) {
		await this.prisma.marginTokenInfo.create({
			data: {
				pool_id: m.poolId,
				token_addr: m.tokenAddr,
				token_name: m.tokenName,
				token_decimals: m.tokenDecimals,
			},
		});
		this.l.info("inserted new margin token info", {
			m,
		});
	}

	public async replace(m: MarginTokenData) {
		await this.prisma.marginTokenInfo.delete({
			where: {
				pool_id: m.poolId,
			},
		});
		await this.insert(m);
		this.l.info("replaced margin token info", {
			m,
		});
	}

	public async getMarginTokenInfo(
		poolId: number,
	): Promise<undefined | MarginTokenData> {
		const res = await this.prisma.marginTokenInfo.findFirst({
			where: {
				pool_id: {
					equals: poolId,
				},
			},
		});
		if (res == null) {
			return undefined;
		}
		return {
			poolId: poolId,
			tokenAddr: res.token_addr,
			tokenDecimals: res.token_decimals,
			tokenName: res.token_name,
		};
	}
}
