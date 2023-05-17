export const DECIMALS18 = BigInt(Math.pow(10, 18));
export const ONE_64x64 = BigInt(Math.pow(2, 64));

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
