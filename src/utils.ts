export function extractErrorMsg(error: any): string {
  let message;
  if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return message;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
