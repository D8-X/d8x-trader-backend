async function main() {
  const baseurl = "https://pyth.testnet.quantena.tech/api/";
  const query1 = "latest_price_feeds?ids[]=0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b";
  const query2 = "latest_vaas_px?ids[]=0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b";
  const N = 20;
  const VAAvsPx = new Array<number>();
  let a1, a2;
  let mu = 0;
  for (let k = 0; k < N; k++) {
    let b = Math.random() < 0.5 ? false : true;
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
    let t2 = R2[0][1].publish_time;
    VAAvsPx.push(t2 - t1);
    mu = mu + t2 - t1;
    console.log("diff=", t2 - t1);
  }
  mu = mu / N;
  console.log("Mean VAA ts - latest px:", mu);
}
main();
