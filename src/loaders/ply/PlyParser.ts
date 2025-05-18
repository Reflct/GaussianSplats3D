import { PlayCanvasCompressedPlyParser } from "./PlayCanvasCompressedPlyParser";
import { INRIAV1PlyParser } from "./INRIAV1PlyParser";
import { INRIAV2PlyParser } from "./INRIAV2PlyParser";
import { PlyParserUtils } from "./PlyParserUtils";
import { PlyFormat } from "./PlyFormat";
import { UncompressedSplatArray } from "../UncompressedSplatArray";
import { SplatBuffer } from "../SplatBuffer";

/**
 * Main PlyParser class that delegates parsing to format-specific parsers
 */
export class PlyParser {
  /**
   * Parse PLY data to an uncompressed splat array
   * @param plyBuffer The buffer containing PLY data
   * @param outSphericalHarmonicsDegree Desired spherical harmonics degree
   * @returns Uncompressed splat array
   */
  static parseToUncompressedSplatArray(
    plyBuffer: ArrayBuffer,
    outSphericalHarmonicsDegree: number = 0
  ): UncompressedSplatArray {
    const plyFormat =
      PlyParserUtils.determineHeaderFormatFromPlyBuffer(plyBuffer);
    if (plyFormat === PlyFormat.PlayCanvasCompressed) {
      return PlayCanvasCompressedPlyParser.parseToUncompressedSplatArray(
        plyBuffer,
        outSphericalHarmonicsDegree
      );
    } else if (plyFormat === PlyFormat.INRIAV1) {
      return INRIAV1PlyParser.parseToUncompressedSplatArray(
        plyBuffer,
        outSphericalHarmonicsDegree
      );
    } else if (plyFormat === PlyFormat.INRIAV2) {
      return INRIAV2PlyParser.parseToUncompressedSplatArray(
        plyBuffer,
        outSphericalHarmonicsDegree
      );
    }
    throw new Error("Unknown PLY format");
  }

  /**
   * Parse PLY data to an uncompressed splat buffer
   * @param plyBuffer The buffer containing PLY data
   * @param outSphericalHarmonicsDegree Desired spherical harmonics degree
   * @returns Uncompressed splat buffer
   */
  static parseToUncompressedSplatBuffer(
    plyBuffer: ArrayBuffer,
    outSphericalHarmonicsDegree: number = 0
  ): SplatBuffer {
    const plyFormat =
      PlyParserUtils.determineHeaderFormatFromPlyBuffer(plyBuffer);
    if (plyFormat === PlyFormat.PlayCanvasCompressed) {
      return PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer(
        plyBuffer,
        outSphericalHarmonicsDegree
      );
    } else if (plyFormat === PlyFormat.INRIAV1) {
      return INRIAV1PlyParser.parseToUncompressedSplatBuffer(
        plyBuffer,
        outSphericalHarmonicsDegree
      );
    } else if (plyFormat === PlyFormat.INRIAV2) {
      // TODO: Implement!
      throw new Error(
        "parseToUncompressedSplatBuffer() is not implemented for INRIA V2 PLY files"
      );
    }
    throw new Error("Unknown PLY format");
  }
}
