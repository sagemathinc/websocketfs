import * as tmp from "tmp-promise";
import bind from "./bind";
import fs from "fs/promises";
import path from "path";

let dir1, dir2, fuse, source, target;

beforeAll(async () => {
  // Create temporary directories
  dir1 = await tmp.dir({ unsafeCleanup: true });
  dir2 = await tmp.dir({ unsafeCleanup: true });
  fuse = await bind(dir1.path, dir2.path);
  source = dir1.path;
  target = dir2.path;
});

afterAll(async () => {
  // Clean up
  await dir1?.cleanup();
  await dir2?.cleanup();
  await fuse?.unmount();
});

describe("Check many functions...", () => {
  it("Directory listing is initially empty", async () => {
    expect(await fs.readdir(source)).toEqual([]);
    expect(await fs.readdir(target)).toEqual([]);
  });
  it("Writes a file, then checks that it is there", async () => {
    await fs.writeFile(path.join(source, "a.txt"), "test");
    // make sure we wrote it properly
    expect((await fs.readFile(path.join(source, "a.txt"))).toString()).toBe(
      "test",
    );
    // now read it from the bind mount as well
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      "test",
    );
    // check it appears in the listing
    expect(await fs.readdir(target)).toEqual(["a.txt"]);
  });
});
