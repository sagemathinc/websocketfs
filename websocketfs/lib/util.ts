/*
Various utilities

*/
import { compressFrame, decompressFrame } from "lz4-napi";
import { readFile, writeFile } from "fs/promises";

// See cocalc's packages/util/misc for comments
function getMethods(obj: object): string[] {
  let properties = new Set<string>();
  let current_obj = obj;
  do {
    Object.getOwnPropertyNames(current_obj).map((item) => properties.add(item));
  } while ((current_obj = Object.getPrototypeOf(current_obj)));
  return [...properties.keys()].filter(
    (item) => typeof obj[item] === "function",
  );
}

export function bindMethods<T extends object>(
  obj: T,
  method_names: undefined | string[] = undefined,
): T {
  if (method_names === undefined) {
    method_names = getMethods(obj);
    method_names.splice(method_names.indexOf("constructor"), 1);
  }
  for (const method_name of method_names) {
    obj[method_name] = obj[method_name].bind(obj);
  }
  return obj;
}

const PERMISSIONS = {
  r: 4,
  w: 2,
  x: 1,
  "-": 0,
} as const;

export function symbolicToMode(symbolic): number {
  // Remove the 'd' at the beginning if it exists
  let mode;
  if (symbolic.charAt(0) === "d") {
    mode = "40";
  } else if (symbolic.charAt(0) === "l") {
    mode = "120";
  } else {
    mode = "100";
  }
  symbolic = symbolic.slice(1);
  const parts = symbolic.split("");

  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const permission = parts[i];
    n += PERMISSIONS[permission];
    if (i % 3 == 2) {
      mode += `${n}`;
      n = 0;
    }
  }

  return parseInt(mode, 8);
}

export async function readFileLz4(path: string): Promise<Buffer> {
  const content = await readFile(path);
  return await decompressFrame(content);
}

export async function writeFileLz4(path: string, contents: string) {
  const compressed = await compressFrame(Buffer.from(contents));
  await writeFile(path, compressed);
}
