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
  it("readdir starts empty", async () => {
    expect(await fs.readdir(source)).toEqual([]);
    expect(await fs.readdir(target)).toEqual([]);
  });

  it("readFile and readdir", async () => {
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

  it("stat (getattr)", async () => {
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
      "birthtimeMs",
      "birthtime",
      "blocks", // blocks = not implemented (not part of base sftp?)
    ]) {
      delete source_stat[name];
      delete target_stat[name];
    }
    expect(source_stat).toEqual(target_stat);
  });

  it("readlink", async () => {
    // create a symbolic link
    await fs.symlink("a.txt", path.join(source, "b.txt"));
    const link = await fs.readlink(path.join(target, "b.txt"));
    expect(link).toBe("a.txt");
  });

  it("chmod", async () => {
    const { mode } = await fs.stat(path.join(source, "a.txt"));
    await fs.chmod(path.join(target, "a.txt"), 33261); // -rwxr-xr-x
    const { mode: mode0 } = await fs.stat(path.join(source, "a.txt"));
    const { mode: mode1 } = await fs.stat(path.join(target, "a.txt"));
    expect(mode0).toBe(33261);
    expect(mode1).toBe(33261);
    // set it back
    await fs.chmod(path.join(target, "a.txt"), mode);
  });

  it("open -- write to a file in the fuse filesystem", async () => {
    const data = "Hi From WebSocketFS!";
    await fs.writeFile(path.join(target, "a.txt"), data);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      data,
    );
    expect((await fs.readFile(path.join(source, "a.txt"))).toString()).toBe(
      data,
    );
    // and also append
    await fs.appendFile(path.join(target, "a.txt"), data);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      data + data,
    );
    // and write again (confirming truncate happened)
    await fs.writeFile(path.join(target, "a.txt"), data);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      data,
    );
  });
  it("open -- write to a file in source filesystem and see reflected in fuse", async () => {
    const data = "Hello again";
    await fs.writeFile(path.join(source, "a.txt"), data);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      data,
    );
  });
});