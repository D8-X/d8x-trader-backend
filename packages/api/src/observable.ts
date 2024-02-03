import Observer from "./observer";

export default class Observable {
	private observers: Set<Observer>;

	constructor() {
		this.observers = new Set<Observer>();
	}

	public registerObserver(obs: Observer) {
		this.observers.add(obs);
	}

	public notifyObservers(updateType: string) {
		for (const current of this.observers) {
			current.update(updateType);
		}
	}
}
