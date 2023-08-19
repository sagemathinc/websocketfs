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

  it("Check stat of a path, which calls getattr", async () => {
    const source_stat = await fs.stat(path.join(source, "a.txt"));
    const target_stat = await fs.stat(path.join(target, "a.txt"));
    //console.log({ source_stat, target_stat });
    // check times are within 1000
    for (const name of [
      "atimeMs",
      "mtimeMs",
      "ctimeMs",
      "atime",
      "mtime",
      "ctime",
    ]) {
      expect(Math.abs(source_stat[name] - target_stat[name])).toBeLessThan(
        1000,
      );
    }

    // Delete attributes that shouldn't match exactly.
    for (const name of [
      "dev",
      "ino",
      "atimeMs", // because time is low resolution
      "mtimeMs",
      "ctimeMs",
      "atime",
      "mtime",
      "ctime",
      "blocks", // blocks = not implemented (not part of base sftp?)
    ]) {
      delete source_stat[name];
      delete target_stat[name];
    }
    expect(source_stat).toEqual(target_stat);
  });

//   it("Check readlink", async () => {
//     // create a symbolic link
//     await fs.link(path.join(source, "a.txt"), path.join(source, "b.txt"));
//     const link0 = await fs.readlink(path.join(source, "b.txt"));
//     //const link = await fs.readlink(path.join(target, "b.txt"));
//     console.log({ link0 });
//   });
});
