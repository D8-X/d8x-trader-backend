/**
 * Convert arbitrary data to json string
 */
export const toJson = (data: any): string => {
	return JSON.stringify(data, (key, value) =>
		typeof value === "bigint" ? value.toString() : value
	);
};
