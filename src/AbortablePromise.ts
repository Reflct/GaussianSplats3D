/**
 * AbortablePromise: A quick & dirty wrapper for JavaScript's Promise class that allows the underlying
 * asynchronous operation to be cancelled. It is only meant for simple situations where no complex promise
 * chaining or merging occurs. It needs a significant amount of work to truly replicate the full
 * functionality of JavaScript's Promise class. Look at Util.fetchWithProgress() for example usage.
 *
 * This class was primarily added to allow splat scene downloads to be cancelled. It has not been tested
 * very thoroughly and the implementation is kinda janky. If you can at all help it, please avoid using it :)
 */
export class AbortablePromise<T = any> {
  static idGen: number = 0;
  promise: Promise<T>;
  abortHandler?: (reason?: any) => void;
  id: number;

  constructor(
    promiseFunc: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: any) => void
    ) => void,
    abortHandler?: (reason?: any) => void
  ) {
    this.promise = new Promise<T>((resolve, reject) => {
      promiseFunc(resolve, reject);
    });
    this.abortHandler = abortHandler;
    this.id = AbortablePromise.idGen++;
  }

  then<TResult1 = T, TResult2 = never>(
    onResolve: (
      value: T
    ) => TResult1 | PromiseLike<TResult1> | AbortablePromise<TResult1>,
    onReject?: (reason: any) => TResult2 | PromiseLike<TResult2>
  ): AbortablePromise<TResult1 | TResult2> {
    return new AbortablePromise<TResult1 | TResult2>((resolve, reject) => {
      this.promise.then(
        (value) => {
          const result = onResolve(value);
          if (result instanceof AbortablePromise) {
            result.then(resolve, reject);
          } else {
            Promise.resolve(result).then(resolve, reject);
          }
        },
        (reason) => {
          if (onReject) {
            Promise.resolve(onReject(reason)).then(resolve, reject);
          } else {
            reject(reason);
          }
        }
      );
    }, this.abortHandler);
  }

  catch<TResult = never>(
    onFail: (reason: any) => TResult | PromiseLike<TResult>
  ): AbortablePromise<T | TResult> {
    return new AbortablePromise<T | TResult>((resolve, reject) => {
      this.promise.then(resolve).catch((reason) => {
        Promise.resolve(onFail(reason)).then(resolve, reject);
      });
    }, this.abortHandler);
  }

  abort(reason?: any) {
    if (this.abortHandler) this.abortHandler(reason);
  }
}

export class AbortedPromiseError extends Error {
  constructor(msg?: string) {
    super(msg);
  }
}
