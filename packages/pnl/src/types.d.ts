declare namespace NodeJS {
	export interface ProcessEnv {
		DATABASE_URL: string;
		RPC_URL: string;
		SC_ADDRESS_PERPETUAL_MANAGER_PROXY: string;
	}
}
