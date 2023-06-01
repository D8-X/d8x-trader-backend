import {
	dec18ToFloat,
	ABK64x64ToFloat,
	DECIMALS18,
	ONE_64x64,
	floatToABK64x64,
	floatToDec18,
	floatToDecN,
	decNToFloat,
} from "../src/utils/bigint";

async function main() {
	let x00 = 12.345;

	let x01 = floatToABK64x64(x00);
	console.log(`${x00} as ABDK = ${x01}`);

	let x02 = ABK64x64ToFloat(x01);
	console.log(`${x01} as float = ${x02}`);

	let x11 = floatToDec18(x00);
	console.log(`${x00} as dec18 = ${x11}`);

	let x12 = dec18ToFloat(x11);
	console.log(`${x11} as float = ${x12}`);

	let numDec = 6;
	let x31 = floatToDecN(x00, numDec);
	console.log(`${x00} as dec${numDec} = ${x31}`);

	let x32 = decNToFloat(x31, 6);
	console.log(`${x31} (dec${numDec}) as float = ${x32}`);

	let x2 = dec18ToFloat(DECIMALS18);
	console.log(`one from dec18 = ${x2}`);

	let x3 = ABK64x64ToFloat(ONE_64x64);
	console.log(`one from ABDK = ${x3}`);
}

main();
