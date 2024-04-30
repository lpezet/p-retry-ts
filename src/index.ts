import retry, {type OperationOptions} from 'retry';
import isNetworkError from "./isNetworkError";

export class AbortError extends Error {
	public originalError: Error;
	constructor(message: string | Error) {
		super();

		if (message instanceof Error) {
			this.originalError = message;
			({message} = message);
		} else {
			this.originalError = new Error(message);
			this.originalError.stack = this.stack;
		}

		this.name = 'AbortError';
		this.message = message;
	}
}

export class FailedAttemptError extends Error {
	public attemptNumber = 0;
	public retriesLeft = 0;
	public cause?: Error;
	constructor(cause?: Error) {
		super(cause?.message);
		this.cause = cause;
	}
}

export type Options = {
	/**
	Callback invoked on each retry. Receives the error thrown by `input` as the first argument with properties `attemptNumber` and `retriesLeft` which indicate the current attempt number and the number of attempts left, respectively.

	The `onFailedAttempt` function can return a promise. For example, to add a [delay](https://github.com/sindresorhus/delay):

	```
	import pRetry from 'p-retry';
	import delay from 'delay';

	const run = async () => { ... };

	const result = await pRetry(run, {
		onFailedAttempt: async error => {
			console.log('Waiting for 1 second before retrying');
			await delay(1000);
		}
	});
	```

	If the `onFailedAttempt` function throws, all retries will be aborted and the original promise will reject with the thrown error.
	*/
	onFailedAttempt?: (error: FailedAttemptError) => void | Promise<void>;

	/**
	Decide if a retry should occur based on the error. Returning true triggers a retry, false aborts with the error.

	It is not called for `TypeError` (except network errors) and `AbortError`.

	@param error - The error thrown by the input function.

	@example
	```
	import pRetry from 'p-retry';

	const run = async () => { … };

	const result = await pRetry(run, {
		shouldRetry: error => !(error instanceof CustomError);
	});
	```

	In the example above, the operation will be retried unless the error is an instance of `CustomError`.
	*/
	shouldRetry?: (error: FailedAttemptError) => boolean | Promise<boolean>;

	/**
	You can abort retrying using [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController).

	```
	import pRetry from 'p-retry';

	const run = async () => { … };
	const controller = new AbortController();

	cancelButton.addEventListener('click', () => {
		controller.abort(new Error('User clicked cancel button'));
	});

	try {
		await pRetry(run, {signal: controller.signal});
	} catch (error) {
		console.log(error.message);
		//=> 'User clicked cancel button'
	}
	```
	*/
	signal?: AbortSignal;
	retries?: number;
} & OperationOptions;

const decorateErrorWithCounts = (error: Error, attemptNumber: number, options: Options): FailedAttemptError => {
	// Minus 1 from attemptNumber because the first attempt does not count as a retry
	const retriesLeft = (options.retries || 0) - (attemptNumber - 1);
	const fae = new FailedAttemptError(error);
	fae.attemptNumber = attemptNumber;
	fae.retriesLeft = retriesLeft;
	return fae;
};

export default async function pRetry<T>(input: (attemptCount: number) => PromiseLike<T> | T,
	options?: Options): Promise<T> {
	return new Promise((resolve, reject) => {
		const defaultedOptions: Options = {
			onFailedAttempt() {}, // eslint-disable-line @typescript-eslint/no-empty-function
			retries: 10,
			shouldRetry: () => true,
			...options,
		};

		const operation = retry.operation(defaultedOptions);

		const abortHandler = () => {
			operation.stop();
			reject(defaultedOptions.signal?.reason);
		};

		if (defaultedOptions.signal && !defaultedOptions.signal.aborted) {
			defaultedOptions.signal.addEventListener('abort', abortHandler, {once: true});
		}

		const cleanUp = () => {
			defaultedOptions.signal?.removeEventListener('abort', abortHandler);
			operation.stop();
		};

		operation.attempt(async attemptNumber => {
			try {
				const result = await input(attemptNumber);
				cleanUp();
				resolve(result);
			} catch (error) {
				try {
					if (!(error instanceof Error)) {
						throw new TypeError(`Non-error was thrown: "${error}". You should only throw errors.`); // eslint-disable-line @typescript-eslint/restrict-template-expressions
					}

					if (error instanceof AbortError) {
						throw error.originalError;
					}

					if (error instanceof TypeError && !isNetworkError(error)) {
						throw error; // eslint-disable-line @typescript-eslint/no-throw-literal
					}

					const fae = decorateErrorWithCounts(error, attemptNumber, defaultedOptions);

					if (defaultedOptions.shouldRetry && !(await defaultedOptions.shouldRetry(fae))) {
						operation.stop();
						reject(error);
					}

					if (defaultedOptions.onFailedAttempt) {
						await defaultedOptions.onFailedAttempt(fae);
					}

					if (!operation.retry(fae)) {
						throw operation.mainError(); // eslint-disable-line @typescript-eslint/no-throw-literal
					}
				} catch (finalError) {
					const faee = decorateErrorWithCounts(finalError as Error, attemptNumber, defaultedOptions);
					cleanUp();
					reject(faee);
				}
			}
		});
	});
}
