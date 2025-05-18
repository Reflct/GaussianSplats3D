"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayCanvasCompressedPlyParser = void 0;
const UncompressedSplatArray_1 = require("../UncompressedSplatArray");
const SplatBuffer_1 = require("../SplatBuffer");
const Util_1 = require("../../Util");
const THREE = __importStar(require("three"));
const HeaderMagicBytes = new Uint8Array([112, 108, 121, 10]);
const HeaderEndTokenBytes = new Uint8Array([
    10, 101, 110, 100, 95, 104, 101, 97, 100, 101, 114, 10,
]);
const HeaderEndToken = "end_header";
const DataTypeMap = new Map([
    ["char", Int8Array],
    ["uchar", Uint8Array],
    ["short", Int16Array],
    ["ushort", Uint16Array],
    ["int", Int32Array],
    ["uint", Uint32Array],
    ["float", Float32Array],
    ["double", Float64Array],
]);
/**
 * Unpacks a normalized unsigned integer from a bit field
 */
const unpackUnorm = (value, bits) => {
    const t = (1 << bits) - 1;
    return (value & t) / t;
};
/**
 * Unpacks a 11-10-11 bit vector from a 32-bit value
 */
const unpack111011 = (result, value) => {
    result.x = unpackUnorm(value >>> 21, 11);
    result.y = unpackUnorm(value >>> 11, 10);
    result.z = unpackUnorm(value, 11);
};
/**
 * Unpacks a 8-8-8-8 bit vector from a 32-bit value
 */
const unpack8888 = (result, value) => {
    result.x = unpackUnorm(value >>> 24, 8);
    result.y = unpackUnorm(value >>> 16, 8);
    result.z = unpackUnorm(value >>> 8, 8);
    result.w = unpackUnorm(value, 8);
};
/**
 * Unpack quaternion with 2,10,10,10 format (largest element, 3x10bit element)
 */
const unpackRot = (result, value) => {
    const norm = 1.0 / (Math.sqrt(2) * 0.5);
    const a = (unpackUnorm(value >>> 20, 10) - 0.5) * norm;
    const b = (unpackUnorm(value >>> 10, 10) - 0.5) * norm;
    const c = (unpackUnorm(value, 10) - 0.5) * norm;
    const m = Math.sqrt(1.0 - (a * a + b * b + c * c));
    switch (value >>> 30) {
        case 0:
            result.set(m, a, b, c);
            break;
        case 1:
            result.set(a, m, b, c);
            break;
        case 2:
            result.set(a, b, m, c);
            break;
        case 3:
            result.set(a, b, c, m);
            break;
    }
};
/**
 * Linear interpolation between two values
 */
const lerp = (a, b, t) => {
    return a * (1 - t) + b * t;
};
/**
 * Gets the storage array for a property of an element
 */
const getElementPropStorage = (element, name) => {
    return element.properties.find((p) => p.name === name && p.storage)?.storage;
};
/**
 * Parser for the PlayCanvas compressed PLY format
 */
class PlayCanvasCompressedPlyParser {
    /**
     * Decode the header text of a PLY file
     */
    static decodeHeaderText(headerText) {
        let element;
        let chunkElement;
        let vertexElement;
        let shElement;
        const headerLines = headerText
            .split("\n")
            .filter((line) => !line.startsWith("comment "));
        let bytesPerSplat = 0;
        let done = false;
        for (let i = 1; i < headerLines.length; ++i) {
            const words = headerLines[i].split(" ");
            switch (words[0]) {
                case "format":
                    if (words[1] !== "binary_little_endian") {
                        throw new Error("Unsupported ply format");
                    }
                    break;
                case "element":
                    element = {
                        name: words[1],
                        count: parseInt(words[2], 10),
                        properties: [],
                        storageSizeBytes: 0,
                    };
                    if (element.name === "chunk")
                        chunkElement = element;
                    else if (element.name === "vertex")
                        vertexElement = element;
                    else if (element.name === "sh")
                        shElement = element;
                    break;
                case "property": {
                    if (!element) {
                        throw new Error("Property defined outside of element");
                    }
                    if (!DataTypeMap.has(words[1])) {
                        throw new Error(`Unrecognized property data type '${words[1]}' in ply header`);
                    }
                    const StorageType = DataTypeMap.get(words[1]);
                    const storageSizeByes = StorageType.BYTES_PER_ELEMENT * element.count;
                    if (element.name === "vertex")
                        bytesPerSplat += StorageType.BYTES_PER_ELEMENT;
                    element.properties.push({
                        type: words[1],
                        name: words[2],
                        storage: null,
                        byteSize: StorageType.BYTES_PER_ELEMENT,
                        storageSizeByes: storageSizeByes,
                    });
                    element.storageSizeBytes += storageSizeByes;
                    break;
                }
                case HeaderEndToken:
                    done = true;
                    break;
                default:
                    throw new Error(`Unrecognized header value '${words[0]}' in ply header`);
            }
            if (done)
                break;
        }
        let sphericalHarmonicsDegree = 0;
        let sphericalHarmonicsPerSplat = 0;
        if (shElement) {
            sphericalHarmonicsPerSplat = shElement.properties.length;
            if (shElement.properties.length >= 45) {
                sphericalHarmonicsDegree = 3;
            }
            else if (shElement.properties.length >= 24) {
                sphericalHarmonicsDegree = 2;
            }
            else if (shElement.properties.length >= 9) {
                sphericalHarmonicsDegree = 1;
            }
        }
        return {
            chunkElement,
            vertexElement,
            shElement,
            bytesPerSplat,
            headerSizeBytes: headerText.indexOf(HeaderEndToken) + HeaderEndToken.length + 1,
            sphericalHarmonicsDegree,
            sphericalHarmonicsPerSplat,
        };
    }
    /**
     * Decode the header of a PLY buffer
     */
    static decodeHeader(plyBuffer) {
        /**
         * Searches for the first occurrence of a sequence within a buffer.
         * @example
         * find(new Uint8Array([1, 2, 3, 4]), new Uint8Array([3, 4])); // 2
         * @param {Uint8Array} buf - The buffer in which to search.
         * @param {Uint8Array} search - The sequence to search for.
         * @return {number} The index of the first occurrence of the search sequence in the buffer, or -1 if not found.
         */
        const find = (buf, search) => {
            const endIndex = buf.length - search.length;
            let i;
            let j;
            for (i = 0; i <= endIndex; ++i) {
                for (j = 0; j < search.length; ++j) {
                    if (buf[i + j] !== search[j]) {
                        break;
                    }
                }
                if (j === search.length) {
                    return i;
                }
            }
            return -1;
        };
        /**
         * Checks if array 'a' starts with the same elements as array 'b'.
         * @example
         * startsWith(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2])); // true
         * @param {Uint8Array} a - The array to check against.
         * @param {Uint8Array} b - The array of elements to look for at the start of 'a'.
         * @return {boolean} - True if 'a' starts with all elements of 'b', otherwise false.
         */
        const startsWith = (a, b) => {
            if (a.length < b.length) {
                return false;
            }
            for (let i = 0; i < b.length; ++i) {
                if (a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
        };
        // const buf = new Uint8Array(plyBuffer as unknown as ArrayBuffer);
        const buf = new Uint8Array(plyBuffer);
        let endHeaderTokenOffset;
        if (buf.length >= HeaderMagicBytes.length &&
            !startsWith(buf, HeaderMagicBytes)) {
            throw new Error("Invalid PLY header");
        }
        endHeaderTokenOffset = find(buf, HeaderEndTokenBytes);
        if (endHeaderTokenOffset === -1) {
            throw new Error("End of PLY header not found");
        }
        const headerText = new TextDecoder("ascii").decode(buf.slice(0, endHeaderTokenOffset));
        const { chunkElement, vertexElement, shElement, sphericalHarmonicsDegree, sphericalHarmonicsPerSplat, bytesPerSplat, } = PlayCanvasCompressedPlyParser.decodeHeaderText(headerText);
        return {
            headerSizeBytes: endHeaderTokenOffset + HeaderEndTokenBytes.length,
            bytesPerSplat,
            chunkElement,
            vertexElement,
            shElement,
            sphericalHarmonicsDegree,
            sphericalHarmonicsPerSplat,
        };
    }
    /**
     * Read element data from a buffer
     */
    static readElementData(element, readBuffer, readOffset, fromIndex, toIndex, propertyFilter = null) {
        if (!element)
            return readOffset;
        const dataView = readBuffer instanceof DataView ? readBuffer : new DataView(readBuffer);
        fromIndex = fromIndex || 0;
        toIndex = toIndex || element.count - 1;
        for (let e = fromIndex; e <= toIndex; ++e) {
            for (let j = 0; j < element.properties.length; ++j) {
                const property = element.properties[j];
                const StorageType = DataTypeMap.get(property.type);
                const requiredStorageSizeBytes = StorageType.BYTES_PER_ELEMENT * element.count;
                if ((!property.storage ||
                    property.storage.byteLength < requiredStorageSizeBytes) &&
                    (!propertyFilter || propertyFilter(property.name))) {
                    property.storage = new StorageType(element.count);
                }
                if (property.storage) {
                    switch (property.type) {
                        case "char":
                            property.storage[e] = dataView.getInt8(readOffset);
                            break;
                        case "uchar":
                            property.storage[e] = dataView.getUint8(readOffset);
                            break;
                        case "short":
                            property.storage[e] = dataView.getInt16(readOffset, true);
                            break;
                        case "ushort":
                            property.storage[e] = dataView.getUint16(readOffset, true);
                            break;
                        case "int":
                            property.storage[e] = dataView.getInt32(readOffset, true);
                            break;
                        case "uint":
                            property.storage[e] = dataView.getUint32(readOffset, true);
                            break;
                        case "float":
                            property.storage[e] = dataView.getFloat32(readOffset, true);
                            break;
                        case "double":
                            property.storage[e] = dataView.getFloat64(readOffset, true);
                            break;
                    }
                }
                readOffset += property.byteSize;
            }
        }
        return readOffset;
    }
    /**
     * Read PLY data from a buffer
     */
    static readPly(plyBuffer, propertyFilter = null) {
        const header = PlayCanvasCompressedPlyParser.decodeHeader(plyBuffer);
        let readIndex = PlayCanvasCompressedPlyParser.readElementData(header.chunkElement, plyBuffer, header.headerSizeBytes, undefined, undefined, propertyFilter);
        readIndex = PlayCanvasCompressedPlyParser.readElementData(header.vertexElement, plyBuffer, readIndex, undefined, undefined, propertyFilter);
        PlayCanvasCompressedPlyParser.readElementData(header.shElement, plyBuffer, readIndex, undefined, undefined, propertyFilter);
        return {
            chunkElement: header.chunkElement,
            vertexElement: header.vertexElement,
            shElement: header.shElement,
            sphericalHarmonicsDegree: header.sphericalHarmonicsDegree,
            sphericalHarmonicsPerSplat: header.sphericalHarmonicsPerSplat,
        };
    }
    /**
     * Get element storage arrays from elements
     */
    static getElementStorageArrays(chunkElement, vertexElement, shElement) {
        const storageArrays = {};
        if (vertexElement) {
            const minR = getElementPropStorage(chunkElement, "min_r");
            const minG = getElementPropStorage(chunkElement, "min_g");
            const minB = getElementPropStorage(chunkElement, "min_b");
            const maxR = getElementPropStorage(chunkElement, "max_r");
            const maxG = getElementPropStorage(chunkElement, "max_g");
            const maxB = getElementPropStorage(chunkElement, "max_b");
            const minX = getElementPropStorage(chunkElement, "min_x");
            const minY = getElementPropStorage(chunkElement, "min_y");
            const minZ = getElementPropStorage(chunkElement, "min_z");
            const maxX = getElementPropStorage(chunkElement, "max_x");
            const maxY = getElementPropStorage(chunkElement, "max_y");
            const maxZ = getElementPropStorage(chunkElement, "max_z");
            const minScaleX = getElementPropStorage(chunkElement, "min_scale_x");
            const minScaleY = getElementPropStorage(chunkElement, "min_scale_y");
            const minScaleZ = getElementPropStorage(chunkElement, "min_scale_z");
            const maxScaleX = getElementPropStorage(chunkElement, "max_scale_x");
            const maxScaleY = getElementPropStorage(chunkElement, "max_scale_y");
            const maxScaleZ = getElementPropStorage(chunkElement, "max_scale_z");
            const position = getElementPropStorage(vertexElement, "packed_position");
            const rotation = getElementPropStorage(vertexElement, "packed_rotation");
            const scale = getElementPropStorage(vertexElement, "packed_scale");
            const color = getElementPropStorage(vertexElement, "packed_color");
            storageArrays["colorExtremes"] = {
                minR,
                maxR,
                minG,
                maxG,
                minB,
                maxB,
            };
            storageArrays["positionExtremes"] = {
                minX,
                maxX,
                minY,
                maxY,
                minZ,
                maxZ,
            };
            storageArrays["scaleExtremes"] = {
                minScaleX,
                maxScaleX,
                minScaleY,
                maxScaleY,
                minScaleZ,
                maxScaleZ,
            };
            storageArrays["position"] = position;
            storageArrays["rotation"] = rotation;
            storageArrays["scale"] = scale;
            storageArrays["color"] = color;
        }
        if (shElement) {
            const shStorageArrays = {};
            for (let i = 0; i < 45; i++) {
                const fRestKey = `f_rest_${i}`;
                const fRest = getElementPropStorage(shElement, fRestKey);
                if (fRest) {
                    shStorageArrays[fRestKey] = fRest;
                }
                else {
                    break;
                }
            }
            storageArrays["sh"] = shStorageArrays;
        }
        return storageArrays;
    }
    /**
     * Parse data to uncompressed splat buffer section
     */
    static parseToUncompressedSplatBufferSection(chunkElement, vertexElement, fromIndex, toIndex, chunkSplatIndexOffset, vertexDataBuffer, outBuffer, outOffset, propertyFilter = null) {
        PlayCanvasCompressedPlyParser.readElementData(vertexElement, vertexDataBuffer, 0, fromIndex, toIndex, propertyFilter);
        const outBytesPerSplat = SplatBuffer_1.SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[0]
            .BytesPerSplat;
        const { positionExtremes, scaleExtremes, colorExtremes, position, rotation, scale, color, } = PlayCanvasCompressedPlyParser.getElementStorageArrays(chunkElement, vertexElement);
        const tempSplat = UncompressedSplatArray_1.UncompressedSplatArray.createSplat();
        for (let i = fromIndex; i <= toIndex; ++i) {
            if (!positionExtremes || !scaleExtremes || !colorExtremes)
                continue;
            PlayCanvasCompressedPlyParser.decompressBaseSplat(i, chunkSplatIndexOffset, position, positionExtremes, scale, scaleExtremes, rotation, colorExtremes, color, tempSplat);
            const outBase = i * outBytesPerSplat + outOffset;
            SplatBuffer_1.SplatBuffer.writeSplatDataToSectionBuffer(tempSplat, outBuffer, outBase, 0, 0);
        }
    }
    /**
     * Parse data to uncompressed splat array section
     */
    static parseToUncompressedSplatArraySection(chunkElement, vertexElement, fromIndex, toIndex, chunkSplatIndexOffset, vertexDataBuffer, splatArray, propertyFilter = null) {
        PlayCanvasCompressedPlyParser.readElementData(vertexElement, vertexDataBuffer, 0, fromIndex, toIndex, propertyFilter);
        const { positionExtremes, scaleExtremes, colorExtremes, position, rotation, scale, color, } = PlayCanvasCompressedPlyParser.getElementStorageArrays(chunkElement, vertexElement);
        for (let i = fromIndex; i <= toIndex; ++i) {
            const tempSplat = UncompressedSplatArray_1.UncompressedSplatArray.createSplat();
            if (positionExtremes && scaleExtremes && colorExtremes) {
                PlayCanvasCompressedPlyParser.decompressBaseSplat(i, chunkSplatIndexOffset, position, positionExtremes, scale, scaleExtremes, rotation, colorExtremes, color, tempSplat);
                splatArray.addSplat(tempSplat);
            }
        }
    }
    /**
     * Parse spherical harmonics data to uncompressed splat array section
     */
    static parseSphericalHarmonicsToUncompressedSplatArraySection(chunkElement, shElement, fromIndex, toIndex, vertexDataBuffer, vertexReadOffset, outSphericalHarmonicsDegree, readSphericalHarmonicsDegree, splatArray, propertyFilter = null) {
        PlayCanvasCompressedPlyParser.readElementData(shElement, vertexDataBuffer, vertexReadOffset, fromIndex, toIndex, propertyFilter);
        if (outSphericalHarmonicsDegree > 0 && shElement) {
            const { sh } = PlayCanvasCompressedPlyParser.getElementStorageArrays(chunkElement, undefined, shElement);
            // Use a loop instead of Object.values to build the array with type safety
            let shArrays = [];
            if (sh) {
                for (const key in sh) {
                    if (sh[key] !== undefined && sh[key] !== null) {
                        shArrays.push(sh[key]);
                    }
                }
            }
            for (let i = fromIndex; i <= toIndex; ++i) {
                PlayCanvasCompressedPlyParser.decompressSphericalHarmonics(i, shArrays, outSphericalHarmonicsDegree, readSphericalHarmonicsDegree, splatArray.splats[i]);
            }
        }
    }
    /**
     * Parse PLY data to an uncompressed splat array
     */
    static parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree) {
        const { chunkElement, vertexElement, shElement, sphericalHarmonicsDegree } = PlayCanvasCompressedPlyParser.readPly(plyBuffer);
        outSphericalHarmonicsDegree =
            outSphericalHarmonicsDegree !== undefined
                ? Math.min(outSphericalHarmonicsDegree, sphericalHarmonicsDegree)
                : sphericalHarmonicsDegree;
        const splatArray = new UncompressedSplatArray_1.UncompressedSplatArray(outSphericalHarmonicsDegree);
        if (!vertexElement)
            return splatArray;
        const { positionExtremes, scaleExtremes, colorExtremes, position, rotation, scale, color, } = PlayCanvasCompressedPlyParser.getElementStorageArrays(chunkElement, vertexElement);
        let shArrays = [];
        if (outSphericalHarmonicsDegree > 0 && shElement) {
            const { sh } = PlayCanvasCompressedPlyParser.getElementStorageArrays(chunkElement, undefined, shElement);
            // Use a loop instead of Object.values to build the array with type safety
            shArrays = [];
            if (sh) {
                for (const key in sh) {
                    if (sh[key] !== undefined && sh[key] !== null) {
                        shArrays.push(sh[key]);
                    }
                }
            }
        }
        if (!positionExtremes || !scaleExtremes || !colorExtremes) {
            return splatArray;
        }
        for (let i = 0; i < vertexElement.count; ++i) {
            splatArray.addDefaultSplat();
            const newSplat = splatArray.getSplat(splatArray.splatCount - 1);
            PlayCanvasCompressedPlyParser.decompressBaseSplat(i, 0, position, positionExtremes, scale, scaleExtremes, rotation, colorExtremes, color, newSplat);
            if (outSphericalHarmonicsDegree > 0) {
                PlayCanvasCompressedPlyParser.decompressSphericalHarmonics(i, shArrays, outSphericalHarmonicsDegree, sphericalHarmonicsDegree, newSplat);
            }
        }
        return splatArray;
    }
    /**
     * Parse PLY data to an uncompressed splat buffer
     */
    static parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree) {
        const { chunkElement, vertexElement, shElement, sphericalHarmonicsDegree } = PlayCanvasCompressedPlyParser.readPly(plyBuffer);
        outSphericalHarmonicsDegree =
            outSphericalHarmonicsDegree !== undefined
                ? Math.min(outSphericalHarmonicsDegree, sphericalHarmonicsDegree)
                : sphericalHarmonicsDegree;
        const { splatBuffer, splatBufferDataOffsetBytes } = SplatBuffer_1.SplatBuffer.preallocateUncompressed(vertexElement?.count || 0, outSphericalHarmonicsDegree);
        const { positionExtremes, scaleExtremes, colorExtremes, position, rotation, scale, color, } = PlayCanvasCompressedPlyParser.getElementStorageArrays(chunkElement, vertexElement);
        if (!positionExtremes || !scaleExtremes || !colorExtremes) {
            return splatBuffer;
        }
        let shArrays = [];
        if (outSphericalHarmonicsDegree > 0 && shElement) {
            const { sh } = PlayCanvasCompressedPlyParser.getElementStorageArrays(chunkElement, undefined, shElement);
            // Use a loop instead of Object.values to build the array with type safety
            shArrays = [];
            if (sh) {
                for (const key in sh) {
                    if (sh[key] !== undefined && sh[key] !== null) {
                        shArrays.push(sh[key]);
                    }
                }
            }
        }
        const outBytesPerSplat = SplatBuffer_1.SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree].BytesPerSplat;
        const newSplat = UncompressedSplatArray_1.UncompressedSplatArray.createSplat(outSphericalHarmonicsDegree);
        for (let i = 0; i < (vertexElement?.count || 0); ++i) {
            PlayCanvasCompressedPlyParser.decompressBaseSplat(i, 0, position, positionExtremes, scale, scaleExtremes, rotation, colorExtremes, color, newSplat);
            if (outSphericalHarmonicsDegree > 0) {
                PlayCanvasCompressedPlyParser.decompressSphericalHarmonics(i, shArrays, outSphericalHarmonicsDegree, sphericalHarmonicsDegree, newSplat);
            }
            const outBase = i * outBytesPerSplat + splatBufferDataOffsetBytes;
            SplatBuffer_1.SplatBuffer.writeSplatDataToSectionBuffer(newSplat, splatBuffer.bufferData, outBase, 0, outSphericalHarmonicsDegree);
        }
        return splatBuffer;
    }
}
exports.PlayCanvasCompressedPlyParser = PlayCanvasCompressedPlyParser;
/**
 * Decompress base splat data
 */
PlayCanvasCompressedPlyParser.decompressBaseSplat = (function () {
    const p = new THREE.Vector3();
    const r = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Vector4();
    const OFFSET = UncompressedSplatArray_1.UncompressedSplatArray.OFFSET;
    return function (index, chunkSplatIndexOffset, positionArray, positionExtremes, scaleArray, scaleExtremes, rotationArray, colorExtremes, colorArray, outSplat) {
        outSplat = outSplat || UncompressedSplatArray_1.UncompressedSplatArray.createSplat();
        // Ensure arrays are not null/undefined
        if (!positionArray || !rotationArray || !scaleArray || !colorArray) {
            return outSplat;
        }
        const chunkIndex = Math.floor((chunkSplatIndexOffset + index) / 256);
        unpack111011(p, positionArray[index]);
        unpackRot(r, rotationArray[index]);
        unpack111011(s, scaleArray[index]);
        unpack8888(c, colorArray[index]);
        // Handle potentially null/undefined extremes
        if (positionExtremes?.minX && positionExtremes?.maxX) {
            outSplat[OFFSET.X] = lerp(positionExtremes.minX[chunkIndex], positionExtremes.maxX[chunkIndex], p.x);
        }
        else {
            outSplat[OFFSET.X] = p.x;
        }
        if (positionExtremes?.minY && positionExtremes?.maxY) {
            outSplat[OFFSET.Y] = lerp(positionExtremes.minY[chunkIndex], positionExtremes.maxY[chunkIndex], p.y);
        }
        else {
            outSplat[OFFSET.Y] = p.y;
        }
        if (positionExtremes?.minZ && positionExtremes?.maxZ) {
            outSplat[OFFSET.Z] = lerp(positionExtremes.minZ[chunkIndex], positionExtremes.maxZ[chunkIndex], p.z);
        }
        else {
            outSplat[OFFSET.Z] = p.z;
        }
        outSplat[OFFSET.ROTATION0] = r.x;
        outSplat[OFFSET.ROTATION1] = r.y;
        outSplat[OFFSET.ROTATION2] = r.z;
        outSplat[OFFSET.ROTATION3] = r.w;
        if (scaleExtremes?.minScaleX && scaleExtremes?.maxScaleX) {
            outSplat[OFFSET.SCALE0] = Math.exp(lerp(scaleExtremes.minScaleX[chunkIndex], scaleExtremes.maxScaleX[chunkIndex], s.x));
        }
        else {
            outSplat[OFFSET.SCALE0] = Math.exp(s.x);
        }
        if (scaleExtremes?.minScaleY && scaleExtremes?.maxScaleY) {
            outSplat[OFFSET.SCALE1] = Math.exp(lerp(scaleExtremes.minScaleY[chunkIndex], scaleExtremes.maxScaleY[chunkIndex], s.y));
        }
        else {
            outSplat[OFFSET.SCALE1] = Math.exp(s.y);
        }
        if (scaleExtremes?.minScaleZ && scaleExtremes?.maxScaleZ) {
            outSplat[OFFSET.SCALE2] = Math.exp(lerp(scaleExtremes.minScaleZ[chunkIndex], scaleExtremes.maxScaleZ[chunkIndex], s.z));
        }
        else {
            outSplat[OFFSET.SCALE2] = Math.exp(s.z);
        }
        if (colorExtremes?.minR && colorExtremes?.maxR) {
            outSplat[OFFSET.FDC0] = (0, Util_1.clamp)(Math.round(lerp(colorExtremes.minR[chunkIndex], colorExtremes.maxR[chunkIndex], c.x) * 255), 0, 255);
        }
        else {
            outSplat[OFFSET.FDC0] = (0, Util_1.clamp)(Math.floor(c.x * 255), 0, 255);
        }
        if (colorExtremes?.minG && colorExtremes?.maxG) {
            outSplat[OFFSET.FDC1] = (0, Util_1.clamp)(Math.round(lerp(colorExtremes.minG[chunkIndex], colorExtremes.maxG[chunkIndex], c.y) * 255), 0, 255);
        }
        else {
            outSplat[OFFSET.FDC1] = (0, Util_1.clamp)(Math.floor(c.y * 255), 0, 255);
        }
        if (colorExtremes?.minB && colorExtremes?.maxB) {
            outSplat[OFFSET.FDC2] = (0, Util_1.clamp)(Math.round(lerp(colorExtremes.minB[chunkIndex], colorExtremes.maxB[chunkIndex], c.z) * 255), 0, 255);
        }
        else {
            outSplat[OFFSET.FDC2] = (0, Util_1.clamp)(Math.floor(c.z * 255), 0, 255);
        }
        outSplat[OFFSET.OPACITY] = (0, Util_1.clamp)(Math.floor(c.w * 255), 0, 255);
        return outSplat;
    };
})();
/**
 * Decompress spherical harmonics data
 */
PlayCanvasCompressedPlyParser.decompressSphericalHarmonics = (function () {
    const shCoeffMap = [0, 3, 8, 15];
    const shIndexMap = [
        0, 1, 2, 9, 10, 11, 12, 13, 24, 25, 26, 27, 28, 29, 30, 3, 4, 5, 14, 15,
        16, 17, 18, 31, 32, 33, 34, 35, 36, 37, 6, 7, 8, 19, 20, 21, 22, 23, 38,
        39, 40, 41, 42, 43, 44,
    ];
    return function (index, shArray, outSphericalHarmonicsDegree, readSphericalHarmonicsDegree, outSplat) {
        outSplat = outSplat || UncompressedSplatArray_1.UncompressedSplatArray.createSplat();
        let outSHCoeff = shCoeffMap[outSphericalHarmonicsDegree];
        let readSHCoeff = shCoeffMap[readSphericalHarmonicsDegree];
        for (let j = 0; j < 3; ++j) {
            for (let k = 0; k < 15; ++k) {
                const outIndex = shIndexMap[j * 15 + k];
                if (k < outSHCoeff && k < readSHCoeff) {
                    const shValue = shArray[j * readSHCoeff + k];
                    if (shValue) {
                        outSplat[UncompressedSplatArray_1.UncompressedSplatArray.OFFSET.FRC0 + outIndex] =
                            shValue[index] * (8 / 255) - 4;
                    }
                }
            }
        }
        return outSplat;
    };
})();
