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

// Construct an error response object
export const errorResp = (error: string, usage: string) => {
	return { error, usage };
};

// Check whether all required params are present in queryParams
export const correctQueryArgs = (
	queryParams: Record<string, any>,
	required: string[]
) => {
	for (let i = 0; i < required.length; i++) {
		if (!(required[i] in queryParams)) {
			return false;
		}
	}
	return true;
};
