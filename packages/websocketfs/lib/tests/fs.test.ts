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
    expect(await fs.readdir(target)).toEqual(["foo"]);
  });

  it("returns multiple directories", async () => {
    await fs.mkdir(join(target, "ab"));
    await fs.mkdir(join(target, "bar"));
    expect(new Set(await fs.readdir(target))).toEqual(
      new Set(["ab", "foo", "bar"]),
    );
  });

  it("returns empty array when dir empty", async () => {
    await fs.mkdir(join(target, "empty"));
    expect(await fs.readdir(join(target, "empty"))).toEqual([]);
  });

  it("respects symlinks", async () => {
    await fs.mkdir(join(target, "a"));
    await fs.writeFile(join(target, "a", "x"), "hello");
    await fs.mkdir(join(target, "b"));
    await fs.symlink("../a", join(target, "b", "b"));
    expect(await fs.readdir(join(target, "b", "b"))).toEqual(["x"]);
  });

  it("respects recursive symlinks", async () => {
    await clean();
    await fs.symlink(".", join(target, "foo"));
    expect(await fs.readdir(target)).toEqual(["foo"]);
  });
});

describe(".read(fd, buffer, offset, length, position)", () => {
  beforeAll(clean);

  it("Basic read file", async () => {
    await fs.writeFile(join(target, "test.txt"), "01234567");
    let fd;
    try {
      fd = await fs.open(join(target, "test.txt"), "r");
      const buffer = Buffer.alloc(3, 0);
      const { bytesRead } = await fd.read(buffer, 0, 3, 3);
      expect(bytesRead).toBe(3);
      expect(buffer.equals(Buffer.from("345"))).toBe(true);
    } finally {
      await fd.close();
    }
  });

  it("Read more than buffer space", async () => {
    await fs.writeFile(join(target, "test.txt"), "01234567");
    let fd;
    try {
      fd = await fs.open(join(target, "test.txt"), "r");
      const buffer = Buffer.alloc(2, 0);
      expect(async () => {
        await fd.read(buffer, 0, 3, 3);
      }).rejects.toThrow("out of range");
    } finally {
      await fd.close();
    }
  });

  it("Read over file boundary", async () => {
    await fs.writeFile(join(target, "test.txt"), "01234567");
    let fd;
    try {
      fd = await fs.open(join(target, "test.txt"), "r");
      const buffer = Buffer.alloc(10, 0);
      const { bytesRead } = await fd.read(buffer, 0, 10, 3);
      expect(bytesRead).toBe("01234567".length - 3); // instead of 10
      expect(buffer.toString().slice(0, 5)).toEqual("34567");
    } finally {
      await fd.close();
    }
  });

  it("Read multiple times; caret position should adjust", async () => {
    await fs.writeFile(join(target, "test.txt"), "01234567");
    let fd;
    try {
      fd = await fs.open(join(target, "test.txt"), "r");
      const buffer = Buffer.alloc(4, 0);
      const { bytesRead } = await fd.read(buffer, 0, 3);
      expect(bytesRead).toBe(3);
      expect(buffer.toString().slice(0, 3)).toEqual("012");
      const { bytesRead: bytesRead2 } = await fd.read(buffer, 0, 4);
      expect(bytesRead2).toBe(4);
      expect(buffer.toString()).toEqual("3456");
      // explicit position:
      const { bytesRead: bytesRead3 } = await fd.read(buffer, 0, 4, 0);
      expect(bytesRead3).toBe(4);
      expect(buffer.toString()).toEqual("0123");
    } finally {
      await fd.close();
    }
  });
});

describe(".realpath(...)", () => {
  it("works with symlinks", async () => {
    await fs.mkdir(join(target, "a"));
    await fs.writeFile(join(target, "a", "x"), "hello");
    await fs.mkdir(join(target, "b"));
    await fs.symlink("../a", join(target, "b", "b"));
    const path = await fs.realpath(join(target, "b", "b"));
    expect(path).toBe(join(dir2.path, "a"));
  });

  it("returns the root correctly", async () => {
    expect(await fs.realpath(target)).toBe(target);
  });
});

describe("rename(fromPath, toPath)", () => {
  it("Renames -- a simple case", async () => {
    await clean();
    await fs.writeFile(join(target, "foo"), "bar");
    await fs.rename(join(target, "foo"), join(target, "foo2"));
    expect(await fs.readdir(target)).toEqual(["foo2"]);
  });

  it("Updates deep links properly when renaming a directory", async () => {
    await clean();
    await fs.mkdir(join(target, "foo/bar/qux"), { recursive: true });
    expect(await fs.readdir(target)).toEqual(["foo"]);
    await fs.writeFile(join(target, "foo/bar/qux/a.txt"), "hello");
    await fs.rename(join(target, "foo"), join(target, "faa"));
    expect(
      await fs.readFile(join(target, "faa/bar/qux/a.txt"), "utf8"),
    ).toEqual("hello");
    expect(await fs.readdir(target)).toEqual(["faa"]);

    await fs.rename(
      join(target, "faa/bar/qux/a.txt"),
      join(target, "faa/bar/qux/b.txt"),
    );
    expect(await fs.readdir(join(target, "faa/bar/qux"))).toEqual(["b.txt"]);
    expect(
      await fs.readFile(join(target, "faa/bar/qux/b.txt"), "utf8"),
    ).toEqual("hello");

    await fs.rename(join(target, "faa/bar"), join(target, "faa/bur"));
    expect(
      await fs.readFile(join(target, "faa/bur/qux/b.txt"), "utf8"),
    ).toEqual("hello");
  });
});

describe("rmSync", () => {
  it("remove directory with two files", async () => {
    await clean();
    await fs.mkdir(join(target, "foo"));
    await fs.writeFile(join(target, "foo", "bar"), "baz");
    await fs.writeFile(join(target, "foo", "baz"), "qux");
    await fs.writeFile(join(target, "oof"), "zab");
    await fs.rm(join(target, "foo"), { force: true, recursive: true });
    expect(await fs.readdir(target)).toEqual(["oof"]);
  });

  it("removes a single file", async () => {
    await clean();
    await fs.mkdir(join(target, "foo"));
    await fs.writeFile(join(target, "foo", "a.txt"), "zab");
    await fs.rm(join(target, "foo", "a.txt"));
    expect(await fs.readdir(join(target, "foo"))).toEqual([]);
  });

  describe("when file does not exist", () => {
    it("throws by default", async () => {
      await clean();
      expect(async () => {
        await fs.rm(join(target, "bar.txt"));
      }).rejects.toThrow("ENOENT");
    });

    it('does not throw if "force" is set to true', async () => {
      await fs.rm(join(target, "bar.txt"), { force: true });
    });
  });

  describe("when deleting a directory", () => {
    it("throws by default", async () => {
      await clean();
      await fs.mkdir(join(target, "foo"));
      expect(async () => {
        await fs.rm(join(target, "foo"));
      }).rejects.toThrow("EISDIR");
    });

    it("throws when force flag is set", async () => {
      expect(async () => {
        await fs.rm(join(target, "foo"), { force: true });
      }).rejects.toThrow("EISDIR");
    });

    it("deletes all directory contents when recursive flag is set", async () => {
      await fs.writeFile(join(target, "foo", "a.txt"), "zab");
      await fs.rm(join(target, "foo"), { recursive: true });
      expect(await fs.readdir(target)).toEqual([]);
    });

    it("deletes all directory contents recursively when recursive flag is set", async () => {
      await clean();
      await fs.mkdir(join(target, "foo"));
      await fs.mkdir(join(target, "foo/bar"));
      await fs.mkdir(join(target, "foo/bar/c"));
      await fs.mkdir(join(target, "foo/baz"));
      await fs.rm(join(target, "foo"), { recursive: true });
      expect(await fs.readdir(target)).toEqual([]);
    });
  });
});

describe(".stat(...)", () => {
  it("works with symlinks", async () => {
    await clean();
    await fs.mkdir(join(target, "a"));
    await fs.mkdir(join(target, "c"));
    await fs.writeFile(join(target, "c", "index.js"), "alert(389+5077);");
    await fs.symlink("../c", join(target, "a/b"));
    const stats0 = await fs.stat(join(target, "c/index.js"));
    const stats = await fs.stat(join(target, "a/b/index.js"));
    expect(stats.size).toBe(stats0.size);
    expect(stats.mode).toBe(stats0.mode);
  });
});

describe("writeFile(path, data[, options])", () => {
  const data = "asdfasidofjasdf";

  it("Create a file at root (writeFile.txt)", async () => {
    await clean();
    const path = join(target, "writeFile.txt");
    await fs.writeFile(path, data);
    expect(await fs.readFile(path, "utf8")).toEqual(data);
  });
  /*
  it("Write to file by file descriptor", () => {
    const vol = create();
    const fd = vol.openSync("/writeByFd.txt", "w");
    vol.writeFileSync(fd, data);
    const node = tryGetChildNode(vol.root, "writeByFd.txt");
    expect(node).toBeInstanceOf(Node);
    expect(node.getString()).toBe(data);
  });
  it("Write to two files (second by fd)", () => {
    const vol = create();

    // 1
    vol.writeFileSync("/1.txt", "123");

    // 2, 3, 4
    const fd2 = vol.openSync("/2.txt", "w");
    const fd3 = vol.openSync("/3.txt", "w");
    const fd4 = vol.openSync("/4.txt", "w");

    vol.writeFileSync(fd2, "456");

    expect(tryGetChildNode(vol.root, "1.txt").getString()).toBe("123");
    expect(tryGetChildNode(vol.root, "2.txt").getString()).toBe("456");
  });
  it("Write at relative path that does not exist throws correct error", () => {
    const vol = create();
    try {
      vol.writeFileSync("a/b", "c");
      throw new Error("not_this");
    } catch (err) {
      expect(err.code).toBe("ENOENT");
    }
  });
  */
});
