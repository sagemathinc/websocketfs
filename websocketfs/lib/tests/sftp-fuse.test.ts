import * as tmp from "tmp-promise";
import bind from "../bind";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { callback } from "awaiting";
import { statvfs } from "@wwa/statvfs";

let dir1, dir2, fuse, source, target;

beforeAll(async () => {
  // Create temporary directories
  dir1 = await tmp.dir({ unsafeCleanup: true });
  dir2 = await tmp.dir({ unsafeCleanup: true });
  fuse = await bind(dir1.path, dir2.path, { cacheTimeout: 0 });
  source = dir1.path;
  target = dir2.path;
});

afterAll(async () => {
  // Clean up
  await dir1?.cleanup();
  await dir2?.cleanup();
  await fuse?.unmount();
});

describe("Simple tests of each of the FUSE operations...", () => {
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
    // console.log({ source_stat, target_stat });
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
    ]) {
      delete source_stat[name];
      delete target_stat[name];
    }
    expect(source_stat).toEqual(target_stat);
  });

  it("fstat -- use the file descriptor instead to stat a file", async () => {
    const stat1 = await fs.stat(path.join(target, "a.txt"));
    const fd = await fs.open(path.join(target, "a.txt"));
    const stat2 = await fd.stat(); // stat using file descriptor
    expect(stat1).toEqual(stat2);
    await fd.close();
  });

  it("readlink", async () => {
    // create a symbolic link
    await fs.symlink("a.txt", path.join(target, "b.txt"));
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

  it("creates a file -- via touch", async () => {
    const p = path.join(target, "new-file");
    await callback(execFile, "touch", [p]);
    expect((await fs.readFile(p)).toString()).toBe("");
  });

  it("creates a file via copy using the shell", async () => {
    const s = path.join(source, "a.txt");
    const p = path.join(target, "c.txt");
    await callback(execFile, "cp", [s, p]);
    expect((await fs.readFile(p)).toString()).toBe(
      (await fs.readFile(s)).toString(),
    );
  });

  it("create a symlink -- via ln -s", async () => {
    await callback(execFile, "ln", [
      "-s",
      "a.txt",
      path.join(target, "a-link.txt"),
    ]);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      (await fs.readFile(path.join(target, "a-link.txt"))).toString(),
    );

    const data = "some data";
    await fs.writeFile(path.join(source, "a-link.txt"), data);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      data,
    );
  });

  it("create a hard link -- via ln", async () => {
    await callback(execFile, "ln", [
      path.join(target, "a.txt"),
      path.join(target, "a-link2.txt"),
    ]);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      (await fs.readFile(path.join(target, "a-link2.txt"))).toString(),
    );

    const data = "some data";
    await fs.writeFile(path.join(source, "a-link2.txt"), data);
    expect((await fs.readFile(path.join(target, "a.txt"))).toString()).toBe(
      data,
    );
  });

  it("creates and removes a directory", async () => {
    const p = path.join(target, "dir0");
    await fs.mkdir(p);
    await fs.rm(p, { recursive: true });
  });

  it("creates a directory -- and a file in it", async () => {
    await fs.mkdir(path.join(target, "a dir"));
    await fs.writeFile(path.join(target, "a dir", "a.txt"), "file in a subdir");
    expect(
      (await fs.readFile(path.join(target, "a dir", "a.txt"))).toString(),
    ).toBe("file in a subdir");
  });

  it("removes the directory with a file we just created", async () => {
    await fs.rm(path.join(target, "a dir"), { recursive: true });
  });
});

describe("stat the filesystem (what df uses)", () => {
  it("stats the filesystem from fuse and native and get same thing (except type, which should differ)", async () => {
    const statsTarget = await statvfs(target);
    const statsSource = await statvfs(source);
    expect(statsTarget.type == statsSource.type).toBe(false);
    statsTarget.type = statsSource.type = 0;
    // free space can change slightly as a function of time.
    for (const key in statsSource) {
      expect(Math.abs(statsTarget[key] - statsSource[key]) < 100).toBe(true);
    }
  });
});

describe("filesystem name", () => {
  // Disabled because it leaves a lock and can't unmount fs.  Maybe a "bug" in df...
  // EBUSY: resource busy or locked, rmdir
  // And there is no way to get this same info from nodejs directly via a library call.
  xit("confirm that filesystem name is set (and starts with ws:// via df)", async () => {
    const df = await callback(execFile, "df", [target], { cwd: "/" });
    expect(df).toContain("ws://");
  });
});
