interface WSMsg {
  name: string;
  obj: Object;
}

interface PriceUpdate {
  perpetualId: number;
  midPrice: number;
  markPrice: number;
  indexPrice: number;
  fundingRate: number;
  openInterest: number;
}

interface LimitOrderCreated {
  perpetualId: number;
  trader: string;
  brokerAddr: string;
  orderId: string;
}
