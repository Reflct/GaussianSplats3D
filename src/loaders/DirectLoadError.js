"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectLoadError = void 0;
class DirectLoadError extends Error {
    constructor(msg) {
        super(msg);
    }
}
exports.DirectLoadError = DirectLoadError;
