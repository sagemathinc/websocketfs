/*
Port of tests from https://github.com/streamich/memfs/tree/master/src/__tests__

*/

import * as tmp from "tmp-promise";
import bind from "../bind";
import { join } from "path";
import fs from "fs/promises";
import fscb from "fs";
import { callback, delay } from "awaiting";
//import { execFile } from "child_process";

let dir1, dir2, fuse, target;

beforeAll(async () => {
  // Create temporary directories
  dir1 = await tmp.dir({ unsafeCleanup: true });
  dir2 = await tmp.dir({ unsafeCleanup: true });
  fuse = await bind(dir1.path, dir2.path);
  target = dir2.path;
});

afterAll(async () => {
  // Clean up
  await dir1?.cleanup();
  await dir2?.cleanup();
  await fuse?.unmount();
});

async function clean() {
  for (const file of await fs.readdir(target)) {
    await fs.rm(join(target, file), { recursive: true });
  }
}

describe("appendFile(file, data[, options], callback)", () => {
  beforeAll(clean);
  let path;
  it("Simple write to non-existing file", async () => {
    path = join(target, "test");
    await fs.appendFile(path, "hello");
    expect(await fs.readFile(path, "utf8")).toEqual("hello");
  });
  it("Append to existing file", async () => {
    await fs.appendFile(path, "c");
    expect(await fs.readFile(path, "utf8")).toEqual("helloc");
  });
});

function numHandles() {
  // @ts-ignore this is poking deep into the private api
  const clients = Array.from(fuse.server._wss.clients) as any[];
  if (clients.length != 1) {
    throw Error("assume only one client");
  }
  const handles = clients[0].session._fs._handles;
  //console.log(handles);
  let i = 0;
  for (const handle of handles) {
    if (handle != null) {
      i += 1;
    }
  }
  return i;
}

describe(".close(fd)", () => {
  beforeAll(clean);

  it("Closes file without errors", async () => {
    const fd = await fs.open(join(target, "test.txt"), "w");
    await fd.close();
  });

  it("Closing same file descriptor twice throws EBADF", async () => {
    const fd = await callback(fscb.open, join(target, "test.txt"), "w");
    await callback(fscb.close, fd);
    expect(async () => {
      await callback(fscb.close, fd);
    }).rejects.toThrow("EBADF");
  });

  it("Closing a file decreases the number of open files", async () => {
    const fd = await fs.open(join(target, "test.txt"), "w");
    const before = numHandles();
    await fd.close();
    // NOTE: it doesn't get freed on server instantly.
    await delay(100);
    const after = numHandles();
    expect(after).toBe(before - 1);
  });
});

describe("copyFile(src, dest[, flags])", () => {
  beforeAll(clean);

  it("Make a file", async () => {
    await fs.appendFile(join(target, "test"), "hello");
  });

  it("copies file", async () => {
    await fs.copyFile(join(target, "test"), join(target, "test2"));
    expect(await fs.readFile(join(target, "test2"), "utf8")).toEqual("hello");
  });

  describe("when COPYFILE_EXCL flag set", () => {
    it("should copy file, if destination does not exit", async () => {
      await fs.copyFile(
        join(target, "test2"),
        join(target, "test3"),
        fs.constants.COPYFILE_EXCL,
      );
      expect(await fs.readFile(join(target, "test3"), "utf8")).toEqual("hello");
    });

    it("should throw, if file already exists", () => {
      expect(
        async () =>
          await fs.copyFile(
            join(target, "test2"),
            join(target, "test3"),
            fs.constants.COPYFILE_EXCL,
          ),
      ).rejects.toThrow("EEXIST");
    });
  });

  describe("when COPYFILE_FICLONE flag set", () => {
    it("should copy file, if destination does not exit", async () => {
      await fs.copyFile(
        join(target, "test2"),
        join(target, "test4"),
        fs.constants.COPYFILE_FICLONE,
      );
      expect(await fs.readFile(join(target, "test4"), "utf8")).toEqual("hello");
    });
    it("when COPYFILE_FICLONE_FORCE flag set, it always fails with ENOTSUP", () => {
      expect(
        async () =>
          await fs.copyFile(
            join(target, "test2"),
            join(target, "test5"),
            fs.constants.COPYFILE_FICLONE_FORCE,
          ),
      ).rejects.toThrow("ENOTSUP");
    });
  });
});

describe("access(path)", () => {
  beforeAll(clean);

  it("Make a file", async () => {
    await fs.appendFile(join(target, "test"), "hello");
  });

  it("Works if file exists", async () => {
    await fs.access(join(target, "test"));
  });

  it("Error if file does not exist", async () => {
    expect(async () => {
      await fs.access(join(target, "test2"));
    }).rejects.toThrow("ENOENT");
  });
});

describe("mkdir", () => {
  beforeAll(clean);

  it("can create a directory", async () => {
    await fs.mkdir(join(target, "new-dir"));
    const stat = await fs.stat(join(target, "new-dir"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("root directory is directory", async () => {
    const stat = await fs.stat(target);
    expect(stat.isDirectory()).toBe(true);
  });

  it("throws when re-creating existing directory", async () => {
    await fs.mkdir(join(target, "new-dir2"));
    expect(async () => {
      await fs.mkdir(join(target, "new-dir2"));
    }).rejects.toThrow("EEXIST");
  });

  it("throws when creating root directory", () => {
    expect(async () => {
      await fs.mkdir(target);
    }).rejects.toThrow("EEXIST");
  });
});

describe("open(path, mode[, flags])", () => {
  it("should return a file descriptor", async () => {
    const fd = await callback(fscb.open, join(target, "a"), "w");
    expect(typeof fd).toEqual("number");
    await callback(fscb.close, fd);
  });
});

describe("rmdir", () => {
  beforeAll(clean);

  it("removing a nonempty directory raises ENOTEMPTY", async () => {
    await fs.mkdir(join(target, "foo"));
    await fs.writeFile(join(target, "foo", "bar"), "hello");
    expect(async () => {
      await fs.rmdir(join(target, "foo"));
    }).rejects.toThrow("ENOTEMPTY");
  });
});

describe("readdir()", () => {
  beforeAll(clean);

  it("returns a single directory", async () => {
    await fs.mkdir(join(target, "foo"));
    await fs.writeFile(join(target, "foo", "bar"), "hello");
    const dirs = await fs.readdir(target);
    expect(dirs).toEqual(["foo"]);
  });

  /*
  it('returns multiple directories', () => {
    const vol = create({
      '/foo/bar': 'baz',
      '/tro/lo': 'lo',
      '/ab/ra': 'kadabra',
    });
    const dirs = vol.readdirSync('/');

    (dirs as any).sort();

    expect(dirs).toEqual(['ab', 'foo', 'tro']);
  });

  it('returns empty array when dir empty', () => {
    const vol = create({});
    const dirs = vol.readdirSync('/');

    expect(dirs).toEqual([]);
  });

  it('respects symlinks', () => {
    const vol = create({
      '/a/a': 'a',
      '/a/aa': 'aa',
      '/b/b': 'b',
    });

    vol.symlinkSync('/a', '/b/b/b');

    const dirs = vol.readdirSync('/b/b/b');

    (dirs as any).sort();

    expect(dirs).toEqual(['a', 'aa']);
  });

  it('respects recursive symlinks', () => {
    const vol = create({});

    vol.symlinkSync('/', '/foo');

    const dirs = vol.readdirSync('/foo');

    expect(dirs).toEqual(['foo']);
  });
  */
});

describe("rename(fromPath, toPath)", () => {
  beforeAll(clean);
  it("Renames -- a simple case", async () => {
    await clean();
    await fs.writeFile(join(target, "foo"), "bar");
    await fs.rename(join(target, "foo"), join(target, "foo2"));
    expect(await fs.readdir(target)).toEqual(["foo2"]);
  });
});
