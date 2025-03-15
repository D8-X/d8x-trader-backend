import RedisOI from "./redisOI"
import { constructRedis } from "utils";
import type { RedisClientType } from "redis";

async function testOI() {
    const redisClient: RedisClientType = constructRedis("PX Interface");
    const oi = new RedisOI(redisClient);
    const ts = Math.floor(Date.now());
    await oi.addOIObs(10001, 12,ts)
    await oi.addOIObs(10001, 25,ts+2)
    await oi.addOIObs(10001, 19,ts+1)
    const m = await oi.getMax24h(10001);
    console.log(m)
    // should be 25
    const m2 = await oi.getMax24h(10002);
    console.log(m2)
    // should be 0

    let m3 = oi.get(10003);
    console.log(m3, m3==0)
    m3 = oi.get(10001);
    console.log(m3, m3==25);
    await redisClient.quit()
}
testOI()