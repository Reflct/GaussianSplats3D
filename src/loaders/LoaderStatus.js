"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoaderStatus = void 0;
var LoaderStatus;
(function (LoaderStatus) {
    LoaderStatus[LoaderStatus["Downloading"] = 0] = "Downloading";
    LoaderStatus[LoaderStatus["Processing"] = 1] = "Processing";
    LoaderStatus[LoaderStatus["Done"] = 2] = "Done";
})(LoaderStatus || (exports.LoaderStatus = LoaderStatus = {}));
