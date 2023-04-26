export const DECIMALS18 = BigInt(Math.pow(10, 18));

// This is used instead of d8x-sdk since d8x sdk does not support ethers v6
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
