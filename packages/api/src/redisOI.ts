import { RedisClientType } from "redis";

const REDIS_OI_KEY = "oi-ts"
/**
 * RedisOI is used to store time-series of open interest (oi)
 * to redis (using redis time-series with 24h retention).
 * getMax24h retrieves the 24h max.
 */
export default class RedisOI {
    private lastOi: Map<number, {ts: number, value: number}>;
    private redisClient: RedisClientType;
    
    constructor(redisClient: RedisClientType) {
        this.redisClient = redisClient;
        this.lastOi = new Map<number, {ts:number, value: number}>();
    }

    private async timeSeriesExists(perpetualId: number) : Promise<boolean> {
        const key = `${REDIS_OI_KEY}:${perpetualId}`
        const exists = await this.redisClient.exists(key);
        return exists == 1;
    }

    private async createTimeSeriesKey(perpetualId: number) {
        const key = `${REDIS_OI_KEY}:${perpetualId}`;
        try {
            if (!this.redisClient.isOpen) {
                await this.redisClient.connect();
            }
            if (await this.timeSeriesExists(perpetualId)) {
                return;
            }
            await this.redisClient.sendCommand([
                'ts.create', 
                key, 
                'RETENTION', 
                (24 * 60 * 60 * 1000).toString(),
                'DUPLICATE_POLICY',
                'LAST'
            ]);
        } catch (err) {
            console.error('Redis TimeSeries error:', err);
        }
    }

    /**
     * Gets the last observation 
     * @param perpetualId perpetual id
     * @returns last observation or 0 
     */
    public get(perpetualId: number) : number {
        const item = this.lastOi.get(perpetualId)
        if (item==undefined) {
            return 0;
        }
        return item.value;
    }
   
    public async addOIObs(perpetualId: number, value: number, tsMs: number) {
        const item = this.lastOi.get(perpetualId)
        if (item==undefined) {
            await this.createTimeSeriesKey(perpetualId);
            this.lastOi.set(perpetualId, {ts: tsMs, value: value});
        } else if (item!.ts < tsMs) {
            this.lastOi.set(perpetualId, {ts: tsMs, value: value})
        }
        const key = `${REDIS_OI_KEY}:${perpetualId}`
        await this.redisClient.sendCommand(['TS.ADD', key, tsMs.toString(), value.toString()]) 
    }

    public static async getMax24h(perpetualId: number, redisClient : RedisClientType) {
        const key = `${REDIS_OI_KEY}:${perpetualId}`
        const bucketSize = 24 * 60 * 60 * 1000;
        // recall that we have a 24h retention
        let res : any;
        try {
            res = await redisClient.sendCommand([
                'ts.range', 
                key, 
                '-',
                '+',
                'AGGREGATION',
                'MAX',
                bucketSize.toString()
            ])
        } catch(err) {
            return 0;
        }
        if (Array.isArray(res) && res.length>0) {
            const lastEntry = res[res.length-1];
            if (Array.isArray(lastEntry) && lastEntry.length>0) {
                const val = lastEntry[1];
                if(typeof val=='string') {
                    return Number(val);
                }
            }
        }
        return 0;
    }
    
    public async getMax24h(perpetualId: number) : Promise<number> {
       return RedisOI.getMax24h(perpetualId, this.redisClient) 
    }

}