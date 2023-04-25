import { Prisma } from "@prisma/client";

/**
 * Convert arbitrary data to json string
 */
export const toJson = (data: any): string => {
	return JSON.stringify(data, (key, value) => {
		if (typeof value === "bigint") {
			return value.toString();
		}
		if (value instanceof Prisma.Decimal) {
			return value.toFixed();
		}
		return value;
	});
};
