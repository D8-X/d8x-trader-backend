export default abstract class AbstractPayExecutor {
  public abstract transactPayment(
    tokenAddr: string,
    amounts: bigint[],
    paymentToAddr: string[],
    id: bigint,
    msg: string
  ): Promise<string>;

  public abstract getBrokerAddress(): string;
}
