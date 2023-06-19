// Construct an error response object
export const errorResp = (error: string, usage: string) => {
	return { error, usage };
};

// Check whether all required params are present in queryParams
export const correctQueryArgs = (
	queryParams: Record<string, any>,
	required: string[]
) => {
	for (let i = 0; i < required.length; i++) {
		if (!(required[i] in queryParams)) {
			return false;
		}
	}
	return true;
};
