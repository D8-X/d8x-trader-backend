import D8XBrokerBackendApp from "./D8XBrokerBackendApp";
import NoBroker from "./noBroker";

async function start() {
  let d8XBackend = new D8XBrokerBackendApp(new NoBroker());
  await d8XBackend.initialize();
}
start();
