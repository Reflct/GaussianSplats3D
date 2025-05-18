"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlyParser = void 0;
const PlayCanvasCompressedPlyParser_1 = require("./PlayCanvasCompressedPlyParser");
const INRIAV1PlyParser_1 = require("./INRIAV1PlyParser");
const INRIAV2PlyParser_1 = require("./INRIAV2PlyParser");
const PlyParserUtils_1 = require("./PlyParserUtils");
const PlyFormat_1 = require("./PlyFormat");
/**
 * Main PlyParser class that delegates parsing to format-specific parsers
 */
class PlyParser {
    /**
     * Parse PLY data to an uncompressed splat array
     * @param plyBuffer The buffer containing PLY data
     * @param outSphericalHarmonicsDegree Desired spherical harmonics degree
     * @returns Uncompressed splat array
     */
    static parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree = 0) {
        const plyFormat = PlyParserUtils_1.PlyParserUtils.determineHeaderFormatFromPlyBuffer(plyBuffer);
        if (plyFormat === PlyFormat_1.PlyFormat.PlayCanvasCompressed) {
            return PlayCanvasCompressedPlyParser_1.PlayCanvasCompressedPlyParser.parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree);
        }
        else if (plyFormat === PlyFormat_1.PlyFormat.INRIAV1) {
            return INRIAV1PlyParser_1.INRIAV1PlyParser.parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree);
        }
        else if (plyFormat === PlyFormat_1.PlyFormat.INRIAV2) {
            return INRIAV2PlyParser_1.INRIAV2PlyParser.parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree);
        }
        throw new Error("Unknown PLY format");
    }
    /**
     * Parse PLY data to an uncompressed splat buffer
     * @param plyBuffer The buffer containing PLY data
     * @param outSphericalHarmonicsDegree Desired spherical harmonics degree
     * @returns Uncompressed splat buffer
     */
    static parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree = 0) {
        const plyFormat = PlyParserUtils_1.PlyParserUtils.determineHeaderFormatFromPlyBuffer(plyBuffer);
        if (plyFormat === PlyFormat_1.PlyFormat.PlayCanvasCompressed) {
            return PlayCanvasCompressedPlyParser_1.PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree);
        }
        else if (plyFormat === PlyFormat_1.PlyFormat.INRIAV1) {
            return INRIAV1PlyParser_1.INRIAV1PlyParser.parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree);
        }
        else if (plyFormat === PlyFormat_1.PlyFormat.INRIAV2) {
            // TODO: Implement!
            throw new Error("parseToUncompressedSplatBuffer() is not implemented for INRIA V2 PLY files");
        }
        throw new Error("Unknown PLY format");
    }
}
exports.PlyParser = PlyParser;
