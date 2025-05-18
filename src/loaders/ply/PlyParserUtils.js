"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlyParserUtils = void 0;
const PlyFormat_1 = require("./PlyFormat");
/**
 * Field size identifiers
 */
var FieldSizeId;
(function (FieldSizeId) {
    FieldSizeId[FieldSizeId["Double"] = 0] = "Double";
    FieldSizeId[FieldSizeId["Int"] = 1] = "Int";
    FieldSizeId[FieldSizeId["UInt"] = 2] = "UInt";
    FieldSizeId[FieldSizeId["Float"] = 3] = "Float";
    FieldSizeId[FieldSizeId["Short"] = 4] = "Short";
    FieldSizeId[FieldSizeId["UShort"] = 5] = "UShort";
    FieldSizeId[FieldSizeId["UChar"] = 6] = "UChar";
})(FieldSizeId || (FieldSizeId = {}));
/**
 * Map from field type string to field size identifier
 */
const FieldSizeStringMap = {
    double: FieldSizeId.Double,
    int: FieldSizeId.Int,
    uint: FieldSizeId.UInt,
    float: FieldSizeId.Float,
    short: FieldSizeId.Short,
    ushort: FieldSizeId.UShort,
    uchar: FieldSizeId.UChar,
};
/**
 * Map from field size identifier to byte size
 */
const FieldSize = {
    [FieldSizeId.Double]: 8,
    [FieldSizeId.Int]: 4,
    [FieldSizeId.UInt]: 4,
    [FieldSizeId.Float]: 4,
    [FieldSizeId.Short]: 2,
    [FieldSizeId.UShort]: 2,
    [FieldSizeId.UChar]: 1,
};
/**
 * Utility class for parsing PLY files
 */
class PlyParserUtils {
    /**
     * Decode a section header from header lines
     * @param headerLines Lines of the header
     * @param fieldNameIdMap Map from field names to field IDs
     * @param headerStartLine Line number where section starts
     * @returns Section header information
     */
    static decodeSectionHeader(headerLines, fieldNameIdMap, headerStartLine = 0) {
        const extractedLines = [];
        let processingSection = false;
        let headerEndLine = -1;
        let vertexCount = 0;
        let endOfHeader = false;
        let sectionName = null;
        const fieldIds = [];
        const fieldTypes = [];
        const allFieldNames = [];
        const usedFieldNames = [];
        const fieldTypesByName = {};
        for (let i = headerStartLine; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith("element")) {
                if (processingSection) {
                    headerEndLine--;
                    break;
                }
                else {
                    processingSection = true;
                    headerStartLine = i;
                    headerEndLine = i;
                    const lineComponents = line.split(" ");
                    let validComponents = 0;
                    for (let lineComponent of lineComponents) {
                        const trimmedComponent = lineComponent.trim();
                        if (trimmedComponent.length > 0) {
                            validComponents++;
                            if (validComponents === 2) {
                                sectionName = trimmedComponent;
                            }
                            else if (validComponents === 3) {
                                vertexCount = parseInt(trimmedComponent);
                            }
                        }
                    }
                }
            }
            else if (line.startsWith("property")) {
                const fieldMatch = line.match(/(\w+)\s+(\w+)\s+(\w+)/);
                if (fieldMatch) {
                    const fieldTypeStr = fieldMatch[2];
                    const fieldName = fieldMatch[3];
                    allFieldNames.push(fieldName);
                    const fieldId = fieldNameIdMap[fieldName];
                    fieldTypesByName[fieldName] = fieldTypeStr;
                    const fieldType = FieldSizeStringMap[fieldTypeStr];
                    if (fieldId !== undefined) {
                        usedFieldNames.push(fieldName);
                        fieldIds.push(fieldId);
                        fieldTypes[fieldId] = fieldType;
                    }
                }
            }
            if (line === PlyParserUtils.HeaderEndToken) {
                endOfHeader = true;
                break;
            }
            if (processingSection) {
                extractedLines.push(line);
                headerEndLine++;
            }
        }
        const fieldOffsets = [];
        let bytesPerVertex = 0;
        for (let fieldName of allFieldNames) {
            const fieldType = fieldTypesByName[fieldName];
            if (fieldTypesByName.hasOwnProperty(fieldName)) {
                const fieldId = fieldNameIdMap[fieldName];
                if (fieldId !== undefined) {
                    fieldOffsets[fieldId] = bytesPerVertex;
                }
            }
            bytesPerVertex += FieldSize[FieldSizeStringMap[fieldType]];
        }
        const sphericalHarmonics = PlyParserUtils.decodeSphericalHarmonicsFromSectionHeader(allFieldNames, fieldNameIdMap);
        return {
            headerLines: extractedLines,
            headerStartLine: headerStartLine,
            headerEndLine: headerEndLine,
            fieldTypes: fieldTypes,
            fieldIds: fieldIds,
            fieldOffsets: fieldOffsets,
            bytesPerVertex: bytesPerVertex,
            vertexCount: vertexCount,
            dataSizeBytes: bytesPerVertex * vertexCount,
            endOfHeader: endOfHeader,
            sectionName: sectionName,
            sphericalHarmonicsDegree: sphericalHarmonics.degree,
            sphericalHarmonicsCoefficientsPerChannel: sphericalHarmonics.coefficientsPerChannel,
            sphericalHarmonicsDegree1Fields: sphericalHarmonics.degree1Fields,
            sphericalHarmonicsDegree2Fields: sphericalHarmonics.degree2Fields,
        };
    }
    /**
     * Decode spherical harmonics information from section header
     * @param fieldNames Field names from header
     * @param fieldNameIdMap Map from field names to field IDs
     * @returns Spherical harmonics information
     */
    static decodeSphericalHarmonicsFromSectionHeader(fieldNames, fieldNameIdMap) {
        let sphericalHarmonicsFieldCount = 0;
        let coefficientsPerChannel = 0;
        for (let fieldName of fieldNames) {
            if (fieldName.startsWith("f_rest"))
                sphericalHarmonicsFieldCount++;
        }
        coefficientsPerChannel = sphericalHarmonicsFieldCount / 3;
        let degree = 0;
        if (coefficientsPerChannel >= 3)
            degree = 1;
        if (coefficientsPerChannel >= 8)
            degree = 2;
        let degree1Fields = [];
        let degree2Fields = [];
        for (let rgb = 0; rgb < 3; rgb++) {
            if (degree >= 1) {
                for (let i = 0; i < 3; i++) {
                    const fieldId = fieldNameIdMap["f_rest_" + (i + coefficientsPerChannel * rgb)];
                    if (fieldId !== undefined) {
                        degree1Fields.push(fieldId);
                    }
                }
            }
            if (degree >= 2) {
                for (let i = 0; i < 5; i++) {
                    const fieldId = fieldNameIdMap["f_rest_" + (i + coefficientsPerChannel * rgb + 3)];
                    if (fieldId !== undefined) {
                        degree2Fields.push(fieldId);
                    }
                }
            }
        }
        return {
            degree: degree,
            coefficientsPerChannel: coefficientsPerChannel,
            degree1Fields: degree1Fields,
            degree2Fields: degree2Fields,
        };
    }
    /**
     * Get section names from header lines
     * @param headerLines Lines of the header
     * @returns Array of section names
     */
    static getHeaderSectionNames(headerLines) {
        const sectionNames = [];
        for (let headerLine of headerLines) {
            if (headerLine.startsWith("element")) {
                const lineComponents = headerLine.split(" ");
                let validComponents = 0;
                for (let lineComponent of lineComponents) {
                    const trimmedComponent = lineComponent.trim();
                    if (trimmedComponent.length > 0) {
                        validComponents++;
                        if (validComponents === 2) {
                            sectionNames.push(trimmedComponent);
                        }
                    }
                }
            }
        }
        return sectionNames;
    }
    /**
     * Check if text contains the end header token
     * @param endHeaderTestText Text to check
     * @returns True if end header token is found
     */
    static checkTextForEndHeader(endHeaderTestText) {
        if (endHeaderTestText.includes(PlyParserUtils.HeaderEndToken)) {
            return true;
        }
        return false;
    }
    /**
     * Check if buffer contains the end header token
     * @param buffer Buffer to check
     * @param searchOffset Offset to start searching from
     * @param chunkSize Size of chunk to search
     * @param decoder Text decoder
     * @returns True if end header token is found
     */
    static checkBufferForEndHeader(buffer, searchOffset, chunkSize, decoder) {
        const endHeaderTestChunk = new Uint8Array(buffer, Math.max(0, searchOffset - chunkSize), chunkSize);
        const endHeaderTestText = decoder.decode(endHeaderTestChunk);
        return PlyParserUtils.checkTextForEndHeader(endHeaderTestText);
    }
    /**
     * Extract header from buffer and convert to text
     * @param plyBuffer Buffer containing PLY data
     * @returns Header text
     */
    static extractHeaderFromBufferToText(plyBuffer) {
        const decoder = new TextDecoder();
        let headerOffset = 0;
        let headerText = "";
        const readChunkSize = 100;
        while (true) {
            if (headerOffset + readChunkSize >= plyBuffer.byteLength) {
                throw new Error("End of file reached while searching for end of header");
            }
            const headerChunk = new Uint8Array(plyBuffer, headerOffset, readChunkSize);
            headerText += decoder.decode(headerChunk);
            headerOffset += readChunkSize;
            if (PlyParserUtils.checkBufferForEndHeader(plyBuffer, headerOffset, readChunkSize * 2, decoder)) {
                break;
            }
        }
        return headerText;
    }
    /**
     * Read header from buffer
     * @param plyBuffer Buffer containing PLY data
     * @returns Header text
     */
    static readHeaderFromBuffer(plyBuffer) {
        return PlyParserUtils.extractHeaderFromBufferToText(plyBuffer);
    }
    /**
     * Convert header text to lines
     * @param headerText Header text
     * @returns Array of header lines
     */
    static convertHeaderTextToLines(headerText) {
        const headerLines = headerText.split("\n");
        const prunedLines = [];
        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            prunedLines.push(line);
            if (line === PlyParserUtils.HeaderEndToken) {
                break;
            }
        }
        return prunedLines;
    }
    /**
     * Determine PLY format from header text
     * @param headerText Header text
     * @returns PLY format
     */
    static determineHeaderFormatFromHeaderText(headerText) {
        const headerLines = PlyParserUtils.convertHeaderTextToLines(headerText);
        let format = PlyFormat_1.PlyFormat.INRIAV1;
        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith("element chunk") ||
                line.match(/[A-Za-z]*packed_[A-Za-z]*/)) {
                format = PlyFormat_1.PlyFormat.PlayCanvasCompressed;
            }
            else if (line.startsWith("element codebook_centers")) {
                format = PlyFormat_1.PlyFormat.INRIAV2;
            }
            else if (line === PlyParserUtils.HeaderEndToken) {
                break;
            }
        }
        return format;
    }
    /**
     * Determine PLY format from buffer
     * @param plyBuffer Buffer containing PLY data
     * @returns PLY format
     */
    static determineHeaderFormatFromPlyBuffer(plyBuffer) {
        const headerText = PlyParserUtils.extractHeaderFromBufferToText(plyBuffer);
        return PlyParserUtils.determineHeaderFormatFromHeaderText(headerText);
    }
    /**
     * Read vertex data from buffer
     * @param vertexData Buffer containing vertex data
     * @param header Section header
     * @param row Row index
     * @param dataOffset Offset into data
     * @param fieldsToRead Fields to read
     * @param rawVertex Output array
     * @param normalize Whether to normalize UChar values to 0-1
     */
    static readVertex(vertexData, header, row, dataOffset, fieldsToRead, rawVertex, normalize = true) {
        const offset = row * header.bytesPerVertex + dataOffset;
        const fieldOffsets = header.fieldOffsets;
        const fieldTypes = header.fieldTypes;
        for (let fieldId of fieldsToRead) {
            const fieldType = fieldTypes[fieldId];
            if (fieldType === FieldSizeId.Float) {
                rawVertex[fieldId] = vertexData.getFloat32(offset + fieldOffsets[fieldId], true);
            }
            else if (fieldType === FieldSizeId.Short) {
                rawVertex[fieldId] = vertexData.getInt16(offset + fieldOffsets[fieldId], true);
            }
            else if (fieldType === FieldSizeId.UShort) {
                rawVertex[fieldId] = vertexData.getUint16(offset + fieldOffsets[fieldId], true);
            }
            else if (fieldType === FieldSizeId.Int) {
                rawVertex[fieldId] = vertexData.getInt32(offset + fieldOffsets[fieldId], true);
            }
            else if (fieldType === FieldSizeId.UInt) {
                rawVertex[fieldId] = vertexData.getUint32(offset + fieldOffsets[fieldId], true);
            }
            else if (fieldType === FieldSizeId.UChar) {
                if (normalize) {
                    rawVertex[fieldId] =
                        vertexData.getUint8(offset + fieldOffsets[fieldId]) / 255.0;
                }
                else {
                    rawVertex[fieldId] = vertexData.getUint8(offset + fieldOffsets[fieldId]);
                }
            }
        }
    }
}
exports.PlyParserUtils = PlyParserUtils;
/**
 * Token indicating the end of the header section
 */
PlyParserUtils.HeaderEndToken = "end_header";
