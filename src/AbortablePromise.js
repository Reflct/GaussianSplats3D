"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbortedPromiseError = exports.AbortablePromise = void 0;
/**
 * AbortablePromise: A quick & dirty wrapper for JavaScript's Promise class that allows the underlying
 * asynchronous operation to be cancelled. It is only meant for simple situations where no complex promise
 * chaining or merging occurs. It needs a significant amount of work to truly replicate the full
 * functionality of JavaScript's Promise class. Look at Util.fetchWithProgress() for example usage.
 *
 * This class was primarily added to allow splat scene downloads to be cancelled. It has not been tested
 * very thoroughly and the implementation is kinda janky. If you can at all help it, please avoid using it :)
 */
class AbortablePromise {
    constructor(promiseFunc, abortHandler) {
        this.promise = new Promise((resolve, reject) => {
            promiseFunc(resolve, reject);
        });
        this.abortHandler = abortHandler;
        this.id = AbortablePromise.idGen++;
    }
    then(onResolve, onReject) {
        return new AbortablePromise((resolve, reject) => {
            this.promise.then((value) => {
                const result = onResolve(value);
                if (result instanceof AbortablePromise) {
                    result.then(resolve, reject);
                }
                else {
                    Promise.resolve(result).then(resolve, reject);
                }
            }, (reason) => {
                if (onReject) {
                    Promise.resolve(onReject(reason)).then(resolve, reject);
                }
                else {
                    reject(reason);
                }
            });
        }, this.abortHandler);
    }
    catch(onFail) {
        return new AbortablePromise((resolve, reject) => {
            this.promise.then(resolve).catch((reason) => {
                Promise.resolve(onFail(reason)).then(resolve, reject);
            });
        }, this.abortHandler);
    }
    abort(reason) {
        if (this.abortHandler)
            this.abortHandler(reason);
    }
}
exports.AbortablePromise = AbortablePromise;
AbortablePromise.idGen = 0;
class AbortedPromiseError extends Error {
    constructor(msg) {
        super(msg);
    }
}
exports.AbortedPromiseError = AbortedPromiseError;
