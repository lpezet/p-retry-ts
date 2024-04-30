// Source: https://github.com/yzqzy/p-retry-cjs/blob/c3a5f45508e2e50190e1b43294620232a34228ac/src/isNetworkError.ts
const objectToString = Object.prototype.toString;

const isError = (value: string) =>
	objectToString.call(value) === "[object Error]";

const errorMessages = new Set([
	"Failed to fetch", // Chrome
	"NetworkError when attempting to fetch resource.", // Firefox
	"The Internet connection appears to be offline.", // Safari 16
	"Load failed", // Safari 17+
	"Network request failed", // `cross-fetch`
	"fetch failed", // Undici (Node.js)
]);

export default function isNetworkError(error: any) {
	const isValid =
		error &&
		isError(error) &&
		error.name === "TypeError" &&
		typeof error.message === "string";

	if (!isValid) {
		return false;
	}

	// We do an extra check for Safari 17+ as it has a very generic error message.
	// Network errors in Safari have no stack.
	if (error.message === "Load failed") {
		return error.stack === undefined;
	}

	return errorMessages.has(error.message);
}