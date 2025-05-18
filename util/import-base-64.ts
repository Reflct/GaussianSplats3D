import { createFilter } from "@rollup/pluginutils";
import { readFileSync } from "fs";

interface Base64Options {
  include: string | Array<string>;
  exclude?: string | Array<string>;
}

interface TransformResult {
  code: string;
  map: null;
}

export function base64(opts: Base64Options = {} as Base64Options) {
  if (!opts.include) {
    throw Error("include option must be specified");
  }

  const filter = createFilter(opts.include, opts.exclude);
  return {
    name: "base64",
    transform(data: string, id: string): TransformResult | undefined {
      if (filter(id)) {
        const fileData = readFileSync(id);
        return {
          code: `export default "${fileData.toString("base64")}";`,
          map: null,
        };
      }
      return undefined;
    },
  };
}
