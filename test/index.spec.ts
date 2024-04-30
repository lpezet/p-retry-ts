import pRetry, {AbortError, FailedAttemptError} from 'src/index';

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const fixture = Symbol('fixture');
const fixtureError = new Error('fixture');

describe('index', () => {
	it('retries', async () => {
		let index = 0;
		const returnValue = await pRetry(async attemptNumber => {
			await sleep(2);
			index++;
			return attemptNumber === 3 ? fixture : Promise.reject(fixtureError);
		});
		expect(returnValue).toBe(fixture);
		expect(index).toBe(3);
	});

	it('aborts', async () => {
		// t.plan(2);
		let index = 0;
		await expect(() => pRetry(async attemptNumber => {
			await sleep(2);
			index++;
			return attemptNumber === 3 ? Promise.reject(new AbortError(fixtureError)) : Promise.reject(fixtureError);
		})).rejects.toThrow(fixtureError.message);
		expect(index).toBe(3);
	});

	it('no retry on TypeError', async () => {
		const typeErrorFixture = new TypeError('type-error-fixture');

		let index = 0;
		await expect(() => pRetry(async attemptNumber => {
			await sleep(2);
			index++;
			return attemptNumber === 3 ? fixture : Promise.reject(typeErrorFixture);
		})).rejects.toThrow(typeErrorFixture.message);
		expect(index).toBe(1);
	});

	it('retry on TypeError - failed to fetch', async () => {
		const typeErrorFixture = new TypeError('Failed to fetch');
		let index = 0;

		const returnValue = await pRetry(async attemptNumber => {
			await sleep(2);
			index++;
			return attemptNumber === 3 ? fixture : Promise.reject(typeErrorFixture);
		});
		expect(returnValue).toBe(fixture);
		expect(index).toBe(3);
	});


		
	it('AbortError - string', () => {
		const error = new AbortError('fixture').originalError;
		expect(error.constructor.name).toBe('Error');
		expect(error.message).toBe('fixture');
	});

	it('AbortError - error', () => {
		const error = new AbortError(new Error('fixture')).originalError;
		expect(error.constructor.name).toBe('Error');
		expect(error.message).toBe('fixture');
	});

	it('onFailedAttempt is called expected number of times', async () => {
		const retries = 5;
		let index = 0;
		let attemptNumber = 0;

		await pRetry(
			async attemptNumber => {
				await sleep(2);
				index++;
				return attemptNumber === 3 ? fixture : Promise.reject(fixtureError);
			},
			{
				onFailedAttempt(error) {
					expect(error instanceof FailedAttemptError).toBeTruthy();
					expect(error.cause).toBe(fixtureError);
					expect(error.attemptNumber).toBe(++attemptNumber);

					switch (index) {
						case 1: {
							expect(error.retriesLeft).toBe(retries);
							break;
						}

						case 2: {
							expect(error.retriesLeft).toBe(4);
							break;
						}

						case 3: {
							expect(error.retriesLeft).toBe(3);
							break;
						}

						case 4: {
							expect(error.retriesLeft).toBe(2);
							break;
						}

						default: {
							fail('onFailedAttempt was called more than 4 times');
						}
					}
				},
				retries,
			},
		);

		expect(index).toBe(3);
		expect(attemptNumber).toBe(2);
	});

	it('onFailedAttempt is called before last rejection', async () => {
		const r = 2;
		let i = 0;
		let j = 0;

		await expect(pRetry(
			async () => {
				i++;
				throw fixtureError;
			},
			{
				onFailedAttempt(error) {
					expect(error instanceof FailedAttemptError).toBeTruthy();
					expect(error.cause).toBe(fixtureError);
					expect(error.attemptNumber).toBe(++j);
					expect(error.retriesLeft).toBe(r - i + 1);
				},
				retries: r,
			},
		)).rejects.toThrow(fixtureError.message);

		expect(i).toBe(3);
		expect(j).toBe(3);
	}, 10000);

	it('onFailedAttempt can return a promise to add a delay', async () => {
		const waitFor = 1000;
		const start = Date.now();
		let isCalled: boolean = false;

		await pRetry(
			async () => {
				if (isCalled) {
					return fixture;
				}

				isCalled = true;

				throw fixtureError;
			},
			{
				async onFailedAttempt() {
					await sleep(waitFor);
				},
			},
		);
		expect(Date.now() > start + waitFor).toBeTruthy();
	});

	it('onFailedAttempt can throw, causing all retries to be aborted', async () => {
		const error = new Error('thrown from onFailedAttempt');

		try {
			await pRetry(async () => {
				throw fixtureError;
			}, {
				onFailedAttempt() {
					throw error;
				},
			});
		} catch (error_) {
			expect(error_).toEqual(error);
		}
	});

	it('throws useful error message when non-error is thrown', async () => {
		await expect(() => pRetry(() => {
			throw 'foo'; // eslint-disable-line @typescript-eslint/no-throw-literal
		})).rejects.toThrow(/Non-error/);
	});

	it('aborts with an AbortSignal', async () => {
		let index = 0;
		const controller = new AbortController();

		await expect(() => pRetry(async attemptNumber => {
			index++;
			if (attemptNumber === 3) {
				controller.abort();
			}
			throw fixtureError;
		}, {
			signal: controller.signal,
		})).rejects.toThrow(); // is Error

		expect(index).toBe(3);
	});

	it('preserves the abort reason', async () => {
		let index = 0;
		const controller = new AbortController();

		await expect(() => pRetry(async attemptNumber => {
			await sleep(2);
			index++;
			if (attemptNumber === 3) {
				controller.abort(fixtureError);
				return;
			}

			throw fixtureError;
		}, {
			signal: controller.signal,
		})).rejects.toThrow(fixtureError.message);

		expect(index).toBe(3);
	});

	it('should retry only when shouldRetry returns true', async () => {
		const shouldRetryError = new Error('should-retry');
		const customError = new Error('custom-error');

		let index = 0;

		await expect(() => pRetry(async () => {
			await sleep(2);
			index++;
			const error = index < 3 ? shouldRetryError : customError;
			throw error;
		}, {
			async shouldRetry(error) {
				return error.message === shouldRetryError.message;
			},
			retries: 10,
		})).rejects.toThrow(customError.message);

		expect(index).toBe(3);
	});


});

