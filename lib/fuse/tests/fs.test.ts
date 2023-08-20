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
    // realpath resolves all the way to the source filesystem somehow.
    expect(path).toBe(join(dir1.path, "a"));
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

    //     expect(fs.toJSON()).toEqual(
    //       path.join(target, "faa/bar/qux/a.txt": "hello")
    //     });

    //     await fs.rename(path.join(target, "faa/bar/qux/a.txt", path.join(target, "faa/bar/qux/b.txt");
    //     expect(fs.toJSON()).toEqual({
    //       path.join(target, "faa/bar/qux/b.txt": "hello")
    //     });

    //     await fs.rename(path.join(target, "faa/", path.join(target, "fuu/");
    //     expect(fs.toJSON()).toEqual({
    //       path.join(target, "fuu/bar/qux/b.txt": "hello")
    //     });

    //     await fs.rename(path.join(target, "fuu/bar/", path.join(target, "fuu/bur/");
    //     expect(fs.toJSON()).toEqual({
    //       path.join(target, "fuu/bur/qux/b.txt": "hello")
    //     });
  });

  /*
  
  it('Rename file two levels deep', () => {
    const vol = create({ '/1/2': 'foobar' });
    vol.renameSync('/1/2', '/1/3');
    expect(vol.toJSON()).toEqual({ '/1/3': 'foobar' });
  });
  it('Rename file three levels deep', () => {
    const vol = create({
      '/foo1': 'bar',
      '/foo2/foo': 'bar',
      '/foo3/foo/foo': 'bar',
    });
    vol.renameSync('/foo3/foo/foo', '/foo3/foo/foo2');
    expect(vol.toJSON()).toEqual({
      '/foo1': 'bar',
      '/foo2/foo': 'bar',
      '/foo3/foo/foo2': 'bar',
    });
  });
  it('Throws on no params', () => {
    const vol = create();
    expect(() => {
      (vol as any).renameSync();
    }).toThrowErrorMatchingSnapshot();
  });
  it('Throws on only one param', () => {
    const vol = create({ '/foo': 'bar' });
    expect(() => {
      (vol as any).renameSync('/foo');
    }).toThrowErrorMatchingSnapshot();
  });
  it('Throws if path is of wrong type', () => {
    const vol = create({ '/foo': 'bar' });
    expect(() => {
      (vol as any).renameSync('/foo', 123);
    }).toThrowErrorMatchingSnapshot();
  });
  */
});
