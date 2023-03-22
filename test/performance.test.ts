async function main() {
  const baseurl = "https://xc-testnet.pyth.network/api/";
  let priceIds = [
    "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b",
    "0xd2c2c1f2bba8e0964f9589e060c2ee97f5e19057267ac3284caef3bd50bd2cb5",
    "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6",
    "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
  ];
  const query1 = "latest_price_feeds?ids[]=0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b";
  const baseQuery2 = "latest_price_feeds?";
  const N = 100;
  const VAAvsPx = new Array<number>();
  let a1, a2;
  let mu = 0;
  for (let k = 0; k < N; k++) {
    let b = Math.random() < 0.5 ? false : true;
    let query2 = baseQuery2;
    for (let j = 0; j < priceIds.length; j++) {
      query2 = query2 + "ids[]=" + priceIds[j] + "&";
    }
    if (b == true) {
      a1 = fetch(baseurl + query1);
      a2 = fetch(baseurl + query2);
    } else {
      a2 = fetch(baseurl + query2);
      a1 = fetch(baseurl + query1);
    }
    let res = await Promise.all([a1, a2]);
    let R1 = await res[0].json();
    let R2 = await res[1].json();
    let t1 = R1[0].price.publish_time;
    let t2 = R2[0].price.publish_time;
    VAAvsPx.push(t2 - t1);
    mu = mu + t2 - t1;
    console.log("diff=", t2 - t1);
  }
  mu = mu / N;
  console.log("Mean VAA ts - latest px:", mu);
}
main();
