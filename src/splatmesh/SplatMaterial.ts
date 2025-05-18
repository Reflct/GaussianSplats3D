import * as THREE from "three";
import { Constants } from "../Constants";

// Define a more compatible uniform type
interface ShaderUniform<T> {
  value: T;
}

// Type for the collection of uniforms
type UniformsType = {
  [uniform: string]: ShaderUniform<any>;
};

export class SplatMaterial {
  static buildVertexShaderBase(
    dynamicMode = false,
    enableOptionalEffects = false,
    maxSphericalHarmonicsDegree = 0,
    customVars = ""
  ): string {
    let vertexShaderSource = `
        precision highp float;
        #include <common>

        attribute uint splatIndex;
        uniform highp usampler2D centersColorsTexture;
        uniform highp sampler2D sphericalHarmonicsTexture;
        uniform highp sampler2D sphericalHarmonicsTextureR;
        uniform highp sampler2D sphericalHarmonicsTextureG;
        uniform highp sampler2D sphericalHarmonicsTextureB;

        uniform highp usampler2D sceneIndexesTexture;
        uniform vec2 sceneIndexesTextureSize;
        uniform int sceneCount;
    `;

    if (enableOptionalEffects) {
      vertexShaderSource += `
            uniform float sceneOpacity[${Constants.MaxScenes}];
            uniform int sceneVisibility[${Constants.MaxScenes}];
        `;
    }

    if (dynamicMode) {
      vertexShaderSource += `
            uniform highp mat4 transforms[${Constants.MaxScenes}];
        `;
    }

    vertexShaderSource += `
        ${customVars}
        uniform vec2 focal;
        uniform float orthoZoom;
        uniform int orthographicMode;
        uniform int pointCloudModeEnabled;
        uniform float inverseFocalAdjustment;
        uniform vec2 viewport;
        uniform vec2 basisViewport;
        uniform vec2 centersColorsTextureSize;
        uniform int sphericalHarmonicsDegree;
        uniform vec2 sphericalHarmonicsTextureSize;
        uniform int sphericalHarmonics8BitMode;
        uniform int sphericalHarmonicsMultiTextureMode;
        uniform float visibleRegionRadius;
        uniform float visibleRegionFadeStartRadius;
        uniform float firstRenderTime;
        uniform float currentTime;
        uniform int fadeInComplete;
        uniform vec3 sceneCenter;
        uniform float splatScale;
        uniform float sphericalHarmonics8BitCompressionRangeMin[${Constants.MaxScenes}];
        uniform float sphericalHarmonics8BitCompressionRangeMax[${Constants.MaxScenes}];

        varying vec4 vColor;
        varying vec2 vUv;
        varying vec2 vPosition;

        mat3 quaternionToRotationMatrix(float x, float y, float z, float w) {
            float s = 1.0 / sqrt(w * w + x * x + y * y + z * z);
        
            return mat3(
                1. - 2. * (y * y + z * z),
                2. * (x * y + w * z),
                2. * (x * z - w * y),
                2. * (x * y - w * z),
                1. - 2. * (x * x + z * z),
                2. * (y * z + w * x),
                2. * (x * z + w * y),
                2. * (y * z - w * x),
                1. - 2. * (x * x + y * y)
            );
        }

        const float sqrt8 = sqrt(8.0);
        const float minAlpha = 1.0 / 255.0;

        const vec4 encodeNorm4 = vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0);
        const uvec4 mask4 = uvec4(uint(0x000000FF), uint(0x0000FF00), uint(0x00FF0000), uint(0xFF000000));
        const uvec4 shift4 = uvec4(0, 8, 16, 24);
        vec4 uintToRGBAVec (uint u) {
           uvec4 urgba = mask4 & u;
           urgba = urgba >> shift4;
           vec4 rgba = vec4(urgba) * encodeNorm4;
           return rgba;
        }

        vec2 getDataUV(in int stride, in int offset, in vec2 dimensions) {
            vec2 samplerUV = vec2(0.0, 0.0);
            float d = float(splatIndex * uint(stride) + uint(offset)) / dimensions.x;
            samplerUV.y = float(floor(d)) / dimensions.y;
            samplerUV.x = fract(d);
            return samplerUV;
        }

        vec2 getDataUVF(in uint sIndex, in float stride, in uint offset, in vec2 dimensions) {
            vec2 samplerUV = vec2(0.0, 0.0);
            float d = float(uint(float(sIndex) * stride) + offset) / dimensions.x;
            samplerUV.y = float(floor(d)) / dimensions.y;
            samplerUV.x = fract(d);
            return samplerUV;
        }

        const float SH_C1 = 0.4886025119029199f;
        const float[5] SH_C2 = float[](1.0925484, -1.0925484, 0.3153916, -1.0925484, 0.5462742);

        void main () {

            uint oddOffset = splatIndex & uint(0x00000001);
            uint doubleOddOffset = oddOffset * uint(2);
            bool isEven = oddOffset == uint(0);
            uint nearestEvenIndex = splatIndex - oddOffset;
            float fOddOffset = float(oddOffset);

            uvec4 sampledCenterColor = texture(centersColorsTexture, getDataUV(1, 0, centersColorsTextureSize));
            vec3 splatCenter = uintBitsToFloat(uvec3(sampledCenterColor.gba));

            uint sceneIndex = uint(0);
            if (sceneCount > 1) {
                sceneIndex = texture(sceneIndexesTexture, getDataUV(1, 0, sceneIndexesTextureSize)).r;
            }
        `;

    if (enableOptionalEffects) {
      vertexShaderSource += `
                float splatOpacityFromScene = sceneOpacity[sceneIndex];
                int sceneVisible = sceneVisibility[sceneIndex];
                if (splatOpacityFromScene <= 0.01 || sceneVisible == 0) {
                    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                    return;
                }
            `;
    }

    if (dynamicMode) {
      vertexShaderSource += `
                mat4 transform = transforms[sceneIndex];
                mat4 transformModelViewMatrix = viewMatrix * transform;
            `;
    } else {
      vertexShaderSource += `mat4 transformModelViewMatrix = modelViewMatrix;`;
    }

    vertexShaderSource += `
            float sh8BitCompressionRangeMinForScene = sphericalHarmonics8BitCompressionRangeMin[sceneIndex];
            float sh8BitCompressionRangeMaxForScene = sphericalHarmonics8BitCompressionRangeMax[sceneIndex];
            float sh8BitCompressionRangeForScene = sh8BitCompressionRangeMaxForScene - sh8BitCompressionRangeMinForScene;
            float sh8BitCompressionHalfRangeForScene = sh8BitCompressionRangeForScene / 2.0;
            vec3 vec8BitSHShift = vec3(sh8BitCompressionRangeMinForScene);

            vec4 viewCenter = transformModelViewMatrix * vec4(splatCenter, 1.0);

            vec4 clipCenter = projectionMatrix * viewCenter;

            float clip = 1.2 * clipCenter.w;
            if (clipCenter.z < -clip || clipCenter.x < -clip || clipCenter.x > clip || clipCenter.y < -clip || clipCenter.y > clip) {
                gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                return;
            }

            vec3 ndcCenter = clipCenter.xyz / clipCenter.w;

            vPosition = position.xy;
            vColor = uintToRGBAVec(sampledCenterColor.r);
        `;

    // Proceed to sampling and rendering 1st degree spherical harmonics
    if (maxSphericalHarmonicsDegree >= 1) {
      vertexShaderSource += `   
            if (sphericalHarmonicsDegree >= 1) {
            `;

      if (dynamicMode) {
        vertexShaderSource += `
                    vec3 worldViewDir = normalize(splatCenter - vec3(inverse(transform) * vec4(cameraPosition, 1.0)));
                `;
      } else {
        vertexShaderSource += `
                    vec3 worldViewDir = normalize(splatCenter - cameraPosition);
                `;
      }

      vertexShaderSource += `
                vec3 sh1;
                vec3 sh2;
                vec3 sh3;
            `;

      if (maxSphericalHarmonicsDegree >= 2) {
        vertexShaderSource += `
                    vec3 sh4;
                    vec3 sh5;
                    vec3 sh6;
                    vec3 sh7;
                    vec3 sh8;
                `;
      }

      // Determining how to sample spherical harmonics textures to get the coefficients for calculations for a given degree
      // depends on how many total degrees (maxSphericalHarmonicsDegree) are present in the textures. This is because that
      // number affects how they are packed in the textures, and therefore the offset & stride required to access them.

      // Sample spherical harmonics textures with 1 degree worth of data for 1st degree calculations, and store in sh1, sh2, and sh3
      if (maxSphericalHarmonicsDegree === 1) {
        vertexShaderSource += `
                    if (sphericalHarmonicsMultiTextureMode == 0) {
                        vec2 shUV = getDataUVF(nearestEvenIndex, 2.5, doubleOddOffset, sphericalHarmonicsTextureSize);
                        vec4 sampledSH0123 = texture(sphericalHarmonicsTexture, shUV);
                        shUV = getDataUVF(nearestEvenIndex, 2.5, doubleOddOffset + uint(1), sphericalHarmonicsTextureSize);
                        vec4 sampledSH4567 = texture(sphericalHarmonicsTexture, shUV);
                        shUV = getDataUVF(nearestEvenIndex, 2.5, doubleOddOffset + uint(2), sphericalHarmonicsTextureSize);
                        vec4 sampledSH891011 = texture(sphericalHarmonicsTexture, shUV);
                        sh1 = vec3(sampledSH0123.rgb) * (1.0 - fOddOffset) + vec3(sampledSH0123.ba, sampledSH4567.r) * fOddOffset;
                        sh2 = vec3(sampledSH0123.a, sampledSH4567.rg) * (1.0 - fOddOffset) + vec3(sampledSH4567.gba) * fOddOffset;
                        sh3 = vec3(sampledSH4567.ba, sampledSH891011.r) * (1.0 - fOddOffset) + vec3(sampledSH891011.rgb) * fOddOffset;
                    } else {
                        vec2 sampledSH01R = texture(sphericalHarmonicsTextureR, getDataUV(2, 0, sphericalHarmonicsTextureSize)).rg;
                        vec2 sampledSH23R = texture(sphericalHarmonicsTextureR, getDataUV(2, 1, sphericalHarmonicsTextureSize)).rg;
                        vec2 sampledSH01G = texture(sphericalHarmonicsTextureG, getDataUV(2, 0, sphericalHarmonicsTextureSize)).rg;
                        vec2 sampledSH23G = texture(sphericalHarmonicsTextureG, getDataUV(2, 1, sphericalHarmonicsTextureSize)).rg;
                        vec2 sampledSH01B = texture(sphericalHarmonicsTextureB, getDataUV(2, 0, sphericalHarmonicsTextureSize)).rg;
                        vec2 sampledSH23B = texture(sphericalHarmonicsTextureB, getDataUV(2, 1, sphericalHarmonicsTextureSize)).rg;
                        sh1 = vec3(sampledSH01R.rg, sampledSH23R.r);
                        sh2 = vec3(sampledSH01G.rg, sampledSH23G.r);
                        sh3 = vec3(sampledSH01B.rg, sampledSH23B.r);
                    }
                `;
        // Sample spherical harmonics textures with 2 degrees worth of data for 1st degree calculations, and store in sh1, sh2, and sh3
      } else if (maxSphericalHarmonicsDegree === 2) {
        vertexShaderSource += `
                    vec4 sampledSH0123;
                    vec4 sampledSH4567;
                    vec4 sampledSH891011;

                    vec4 sampledSH0123R;
                    vec4 sampledSH0123G;
                    vec4 sampledSH0123B;

                    if (sphericalHarmonicsMultiTextureMode == 0) {
                        sampledSH0123 = texture(sphericalHarmonicsTexture, getDataUV(6, 0, sphericalHarmonicsTextureSize));
                        sampledSH4567 = texture(sphericalHarmonicsTexture, getDataUV(6, 1, sphericalHarmonicsTextureSize));
                        sampledSH891011 = texture(sphericalHarmonicsTexture, getDataUV(6, 2, sphericalHarmonicsTextureSize));
                        sh1 = sampledSH0123.rgb;
                        sh2 = vec3(sampledSH0123.a, sampledSH4567.rg);
                        sh3 = vec3(sampledSH4567.ba, sampledSH891011.r);
                    }
                `;
      }

      vertexShaderSource += `

                vColor.rgb = clamp(vColor.rgb, vec3(0.), vec3(1.));

            }

            `;
    }

    return vertexShaderSource;
  }

  static getVertexShaderFadeIn(): string {
    return `
            if (fadeInComplete == 0) {
                float opacityAdjust = 1.0;
                float centerDist = length(splatCenter - sceneCenter);
                float renderTime = max(currentTime - firstRenderTime, 0.0);

                float fadeDistance = 0.75;
                float distanceLoadFadeInFactor = step(visibleRegionFadeStartRadius, centerDist);
                distanceLoadFadeInFactor = (1.0 - distanceLoadFadeInFactor) +
                                        (1.0 - clamp((centerDist - visibleRegionFadeStartRadius) / fadeDistance, 0.0, 1.0)) *
                                        distanceLoadFadeInFactor;
                opacityAdjust *= distanceLoadFadeInFactor;
                vColor.a *= opacityAdjust;
            }
        `;
  }

  static getUniforms(
    dynamicMode = false,
    enableOptionalEffects = false,
    maxSphericalHarmonicsDegree = 0,
    splatScale = 1.0,
    pointCloudModeEnabled = false
  ): UniformsType {
    const uniforms: UniformsType = {
      sceneCenter: {
        value: new THREE.Vector3(),
      },
      fadeInComplete: {
        value: 0,
      },
      orthographicMode: {
        value: 0,
      },
      visibleRegionFadeStartRadius: {
        value: 0.0,
      },
      visibleRegionRadius: {
        value: 0.0,
      },
      currentTime: {
        value: 0.0,
      },
      firstRenderTime: {
        value: 0.0,
      },
      centersColorsTexture: {
        value: null,
      },
      sphericalHarmonicsTexture: {
        value: null,
      },
      sphericalHarmonicsTextureR: {
        value: null,
      },
      sphericalHarmonicsTextureG: {
        value: null,
      },
      sphericalHarmonicsTextureB: {
        value: null,
      },
      sphericalHarmonics8BitCompressionRangeMin: {
        value: [],
      },
      sphericalHarmonics8BitCompressionRangeMax: {
        value: [],
      },
      focal: {
        value: new THREE.Vector2(),
      },
      orthoZoom: {
        value: 1.0,
      },
      inverseFocalAdjustment: {
        value: 1.0,
      },
      viewport: {
        value: new THREE.Vector2(),
      },
      basisViewport: {
        value: new THREE.Vector2(),
      },
      debugColor: {
        value: new THREE.Color(),
      },
      centersColorsTextureSize: {
        value: new THREE.Vector2(1024, 1024),
      },
      sphericalHarmonicsDegree: {
        value: maxSphericalHarmonicsDegree,
      },
      sphericalHarmonicsTextureSize: {
        value: new THREE.Vector2(1024, 1024),
      },
      sphericalHarmonics8BitMode: {
        value: 0,
      },
      sphericalHarmonicsMultiTextureMode: {
        value: 0,
      },
      splatScale: {
        value: splatScale,
      },
      pointCloudModeEnabled: {
        value: pointCloudModeEnabled ? 1 : 0,
      },
      sceneIndexesTexture: {
        value: null,
      },
      sceneIndexesTextureSize: {
        value: new THREE.Vector2(1024, 1024),
      },
      sceneCount: {
        value: 1,
      },
    };
    for (let i = 0; i < Constants.MaxScenes; i++) {
      uniforms.sphericalHarmonics8BitCompressionRangeMin.value.push(
        -Constants.SphericalHarmonics8BitCompressionRange / 2.0
      );
      uniforms.sphericalHarmonics8BitCompressionRangeMax.value.push(
        Constants.SphericalHarmonics8BitCompressionRange / 2.0
      );
    }

    if (enableOptionalEffects) {
      const sceneOpacity: number[] = [];
      for (let i = 0; i < Constants.MaxScenes; i++) {
        sceneOpacity.push(1.0);
      }
      uniforms["sceneOpacity"] = {
        value: sceneOpacity,
      };

      const sceneVisibility: number[] = [];
      for (let i = 0; i < Constants.MaxScenes; i++) {
        sceneVisibility.push(1);
      }
      uniforms["sceneVisibility"] = {
        value: sceneVisibility,
      };
    }

    if (dynamicMode) {
      const transformMatrices: THREE.Matrix4[] = [];
      for (let i = 0; i < Constants.MaxScenes; i++) {
        transformMatrices.push(new THREE.Matrix4());
      }
      uniforms["transforms"] = {
        value: transformMatrices,
      };
    }

    return uniforms;
  }
}
