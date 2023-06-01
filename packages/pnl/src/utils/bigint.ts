export const DECIMALS18 = BigInt(Math.pow(10, 18));
export const ONE_64x64 = BigInt(Math.pow(2, 64));

/**
 *
 * @param {bigint} x BigNumber in Dec18 format
 * @returns {number} x as a float (number)
 */
export const dec18ToFloat = (x: bigint) => {
	var sign = x < 0 ? -1 : 1;
	var s = BigInt(sign);
	x = x * s;
	var xInt = x / DECIMALS18;
	var xDec = x - xInt * DECIMALS18;
	var k = 18 - xDec.toString().length;
	var sPad = "0".repeat(k);
	var NumberStr = xInt.toString() + "." + sPad + xDec.toString();
	return parseFloat(NumberStr) * sign;
};

/**
 *
 * @param {bigint} x BigNumber in Dec-N format
 * @returns {number} x as a float (number)
 */
export function decNToFloat(x: bigint, numDec: number) {
	//x: BigNumber in DecN format to float
	const DECIMALS = BigInt(Math.pow(10, numDec));
	let sign = x < 0 ? -1 : 1;
	let s = BigInt(sign);
	x = x * s;
	let xInt = x / DECIMALS;
	let xDec = x - xInt * DECIMALS;
	let k = numDec - xDec.toString().length;
	let sPad = "0".repeat(k);
	let NumberStr = xInt.toString() + "." + sPad + xDec.toString();
	return parseFloat(NumberStr) * sign;
}

/**
 *
 * @param {number} x number (float)
 * @returns {bigint} x as a BigNumber in Dec18 format
 */
export function floatToDec18(x: number): bigint {
	if (x === 0) {
		return BigInt(0);
	}
	let sg = Math.sign(x);
	x = Math.abs(x);
	let strX = x.toFixed(18);
	const arrX = strX.split(".");
	let xInt = BigInt(arrX[0]);
	let xDec = BigInt(arrX[1]);
	let xIntBig = xInt * DECIMALS18;
	return (xIntBig + xDec) * BigInt(sg);
}

/**
 *
 * @param {number} x number (float)
 * @returns {bigint} x as a BigNumber
 */
export function floatToDecN(x: number, numDec: number): bigint {
	// float number to dec 18
	if (x === 0) {
		return BigInt(0);
	}
	const DECIMALS = BigInt(Math.pow(10, numDec));
	let sg = Math.sign(x);
	x = Math.abs(x);
	let strX = x.toFixed(18);
	const arrX = strX.split(".");
	let xInt = BigInt(arrX[0]);
	let xDec = BigInt(arrX[1]);
	let xIntBig = xInt * DECIMALS;
	return (xIntBig + xDec) * BigInt(sg);
}

/**
 * Convert ABK64x64 bigint-format to float.
 * Result = x/2^64 if big number, x/2^29 if number
 * @param  {bigint|number} x number in ABDK-format or 2^29
 * @returns {number} x/2^64 in number-format (float)
 */
export function ABK64x64ToFloat(x: bigint): number {
	let sign = x < 0 ? -1 : 1;
	let s = BigInt(sign);
	x = x * s;
	let xInt = x / ONE_64x64;
	let xDec = x - xInt * ONE_64x64;
	xDec = (xDec * DECIMALS18) / ONE_64x64;
	let k = 18 - xDec.toString().length;
	let sPad = "0".repeat(k);
	let NumberStr = xInt.toString() + "." + sPad + xDec.toString();
	return parseFloat(NumberStr) * sign;
}

/**
 * Converts x into ABDK64x64 format
 * @param {number} x   number (float)
 * @returns {bigint} x * 2^64 in big number format
 */
export function floatToABK64x64(x: number): bigint {
	if (x === 0) {
		return BigInt(0);
	}
	let sg = Math.sign(x);
	x = Math.abs(x);
	let strX = Number(x).toFixed(18);
	const arrX = strX.split(".");
	let xInt = BigInt(arrX[0]);
	let xDec = BigInt(arrX[1]);
	let xIntBig = xInt * ONE_64x64;
	let xDecBig = (xDec * ONE_64x64) / DECIMALS18;
	return (xIntBig + xDecBig) * BigInt(sg);
}

/**
 * Convert ABK64x64/2^35 bigint-format to float.
 * Divide by 2^64 to get a float, but it's already "divided" by 2^35,
 * so there's only 2^29 left
 * @param  {bigint|number} x number in ABDK-format/2^35
 * @returns {number} x/2^64 in number-format (float)
 */
export const ABDK29ToFloat = (x: bigint) => {
	return x / BigInt(Math.pow(2, 29));
};
