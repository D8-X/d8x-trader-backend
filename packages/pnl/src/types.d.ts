declare namespace NodeJS {
	export interface ProcessEnv {
		DATABASE_URL: string;
		HTTP_RPC_URL: string;
		WS_RPC_URL: string;
		SC_ADDRESS_PERPETUAL_MANAGER_PROXY: string;
	}
}
