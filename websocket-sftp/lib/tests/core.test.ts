import assert from "assert";
import Path from "path";
import fs from "fs";
import { Client, IItem, IStats, Server } from "../sftp";
import { SftpFlags } from "../sftp-misc";
import getPort from "port-get";
import { dir as createTmpDir } from "tmp-promise";
import { callback } from "awaiting";

let tmpdir;
let tmp: string;

async function initTmp() {
  tmpdir = await createTmpDir({ unsafeCleanup: true });
  tmp = tmpdir.path;
  fs.writeFileSync(Path.join(tmp, "readme.txt"), "This is a readme file.");
  fs.writeFileSync(Path.join(tmp, "sample.txt"), "This is a sample file.");
  fs.mkdirSync(Path.join(tmp, "empty"));
  fs.mkdirSync(Path.join(tmp, "full"));
  fs.mkdirSync(Path.join(tmp, "full/subdir01"));

  for (let n = 0; n < 200; n++) {
    fs.writeFileSync(
      Path.join(tmp, "full", "file" + n + "-quite-long-name.txt"),
      "This is a sample file number " + n,
    );
  }
}

let server, client, port;
function initClient(cb) {
  client = new Client();

  client.connect(`ws://localhost:${port}`, {});

  client.on("error", (err) => {
    if (err.message == "Simulated callback error") {
      return;
    }
    cb(err);
    // jest seems to swallow uncaught errors, so we make them very explicit!
    console.error("Uncaught error:", err);
    process.exit(255);
  });

  client.on("ready", cb);
}

function patchIt() {
  const iti = it;
  // @ts-ignore
  it = (expectation, assertion: Function) => {
    if (assertion.length == 0) {
      iti(expectation, function () {
        // @ts-ignore
        return assertion.call(this);
      });
    } else if (assertion.length == 1) {
      iti(expectation, function (done) {
        // @ts-ignore
        return assertion.call(this, done);
      });
    } else {
      throw new Error("Unsupported assertion");
    }
  };

  // @ts-ignore
  it.only = () => {
    // @ts-ignore
    return iti.only.apply(this, arguments);
  };
  // @ts-ignore
  it.skip = () => {
    // @ts-ignore
    return iti.skip.apply(this, arguments);
  };
}

beforeAll(async () => {
  patchIt();
  await initTmp();
  port = await getPort();
  server = new Server({
    port,
    virtualRoot: tmp,
  });
  await callback(initClient);
});

afterAll(async () => {
  client.end();
  server.end();
  await tmpdir?.cleanup();
});

function check(err: Error, done: Function, cb: Function) {
  if (err) return done(err);

  try {
    cb();
  } catch (err) {
    done(err);
  }
}

function error(
  err: Error,
  done: Function,
  expectedCode: string,
  expectedDescription?: string,
) {
  try {
    assert.ok(err, "Error expected");

    const actualCode = err["code"];
    const actualDescription = err["description"];

    assert.equal(
      actualCode,
      expectedCode,
      "Unexpected error code: " + actualCode,
    );

    if (typeof expectedDescription !== "undefined")
      assert.equal(
        actualDescription,
        expectedDescription,
        "Unexpected description: " + actualDescription,
      );

    done();
  } catch (err) {
    done(err);
  }
}

function equalStats(attrs: IStats, stats: fs.Stats): void {
  assert.equal(attrs.size, stats.size, "size mismatch");
  if (attrs.mtime == null) {
    throw Error("bug");
  }
  assert.equal(
    (attrs.mtime.getTime() / 1000) | 0,
    (stats.mtime.getTime() / 1000) | 0,
    "mtime mismatch",
  );
  if (attrs.atime == null) {
    throw Error("bug");
  }
  assert.equal(
    (attrs.atime.getTime() / 1000) | 0,
    (stats.atime.getTime() / 1000) | 0,
    "atime mismatch",
  );
  assert.equal(attrs.mode, stats.mode, "mode mismatch");
  assert.equal(attrs.uid, stats.uid, "uid mismatch");
  assert.equal(attrs.gid, stats.gid, "gid mismatch");
}

const wrongPath = "ENOENT";

const getFileName = (function () {
  let n = 1;
  return function () {
    return "file" + n++ + ".txt";
  };
})();

describe("Basic Tests", function () {
  it("flags", () => {
    for (let flags = 0; flags < 64; flags++) {
      const aflags = SftpFlags.fromNumber(flags)[0];
      const nflags = SftpFlags.toNumber(aflags);
      const sflags = SftpFlags.fromNumber(nflags)[0];
      assert.equal(aflags, sflags);
    }
  });

  it("callback(fail)", (done) => {
    const message = "Simulated callback error";
    client.once("error", (err) => {
      assert.equal(err.message, message, "Unexpected error message");
      done();
    });

    client.realpath(".", (_err, _resolvedPath) => {
      throw new Error(message);
    });
  });

  it("realpath('.')", (done) => {
    client.realpath(".", (err, resolvedPath) =>
      check(err, done, () => {
        assert.equal("/", resolvedPath, "Unexpected resolved path");
        done();
      }),
    );
  });

  it("realpath(no-path)", (done) => {
    const name = "dir000/subdir";
    client.realpath(name, (err) => error(err, done, "ENOENT", wrongPath));
  });

  it("realpath(path)", (done) => {
    client.realpath(
      "./full/subdir01/../file0-quite-long-name.txt",
      (err, resolvedPath) =>
        check(err, done, () => {
          assert.equal(
            "/full/file0-quite-long-name.txt",
            resolvedPath,
            "Unexpected resolved path",
          );
          done();
        }),
    );
  });

  it("mkdir(no-path)", (done) => {
    const name = "dir000/subdir";
    client.mkdir(name, {}, (err) => error(err, done, "ENOENT", wrongPath));
  });

  it("mkdir(path)", (done) => {
    const name = "dir001";
    client.mkdir(name, {}, (err) =>
      check(err, done, () => {
        const stats = fs.statSync(Path.join(tmp, name));
        assert.ok(stats.isDirectory, "Directory expected");
        done();
      }),
    );
  });

  it("rmdir(no-path)", (done) => {
    const name = "dir000";

    client.rmdir(name, (err) => error(err, done, "ENOENT", wrongPath));
  });

  it("rmdir(path)", (done) => {
    const name = "dir002";
    fs.mkdirSync(Path.join(tmp, name));

    client.rmdir(name, (err) =>
      check(err, done, () => {
        const exists = fs.existsSync(Path.join(tmp, name));
        assert.ok(!exists, "Directory not expected");
        done();
      }),
    );
  });

  it("opendir(no-path)", (done) => {
    const name = "dir000";

    client.opendir(name, (err, _handle) =>
      error(err, done, "ENOENT", wrongPath),
    );
  });

  it("opendir(path)/readdir/close", (done) => {
    const name = "full";

    const list = fs.readdirSync(Path.join(tmp, name));
    list.push(".", "..");

    client.opendir(name, (err, handle) =>
      check(err, done, () => {
        assert.ok(handle);
        readdir();

        function readdir() {
          client.readdir(handle, (err, items: IItem[]) =>
            check(err, done, () => {
              if (items) {
                assert.ok(Array.isArray(items), "Not an array");

                for (let i = 0; i < items.length; i++) {
                  const item = items[i];

                  //console.log(JSON.stringify(item));

                  const n = list.indexOf(item.filename);
                  assert.ok(n >= 0, "File '" + item.filename + "' not found");
                  list.splice(n, 1);
                }

                readdir();
              } else {
                assert.ok(<any>items === false, "Unexpected result");
                assert.equal(list.length, 0, "Not all items listed");
                client.close(handle, done);
              }
            }),
          );
        }
      }),
    );
  });

  it("rename(no-path, no-file", (done) => {
    const name1 = "dir000/file.txt";
    const name2 = getFileName();

    client.rename(name1, name2, (err) => error(err, done, "ENOENT", wrongPath));
  });

  it("rename(file1, no-path)", (done) => {
    const name1 = getFileName();
    const name2 = "dir000/file.txt";
    const body = "This is a file.";

    fs.writeFileSync(Path.join(tmp, name1), body);

    client.rename(name1, name2, (err) => error(err, done, "ENOENT", wrongPath));
  });

  it("rename(file1, no-file)", (done) => {
    const name1 = getFileName();
    const name2 = getFileName();
    const body = "This is a file.";

    fs.writeFileSync(Path.join(tmp, name1), body);
    assert.ok(!fs.existsSync(Path.join(tmp, name2)), "File should not exist");

    client.rename(name1, name2, (err) =>
      check(err, done, () => {
        assert.ok(
          !fs.existsSync(Path.join(tmp, name1)),
          "File should not exist",
        );
        const body2 = fs.readFileSync(Path.join(tmp, name2), {
          encoding: "utf8",
        });
        assert.equal(body2, body, "File content mismatch");
        done();
      }),
    );
  });

  it("rename(file1, file2, false)", (done) => {
    const name1 = getFileName();
    const name2 = getFileName();
    const body = "This is a file.";
    const body2 = "This is another file.";

    fs.writeFileSync(Path.join(tmp, name1), body);
    fs.writeFileSync(Path.join(tmp, name2), body2);

    client.rename(name1, name2, (err) =>
      error(err, done, "EFAILURE", "EEXIST"),
    );
  });

  it("rename(file1, file2, true)", (done) => {
    const name1 = getFileName();
    const name2 = getFileName();
    const body = "This is a file.";
    const body2 = "This is another file.";

    fs.writeFileSync(Path.join(tmp, name1), body);
    fs.writeFileSync(Path.join(tmp, name2), body2);

    client.rename(name1, name2, true, (err) =>
      check(err, done, () => {
        assert.ok(
          !fs.existsSync(Path.join(tmp, name1)),
          "File should not exist",
        );
        const body3 = fs.readFileSync(Path.join(tmp, name2), {
          encoding: "utf8",
        });
        assert.equal(body3, body, "File content mismatch");
        done();
      }),
    );
  });

  it("link(path1, no-path)", (done) => {
    const name1 = getFileName();
    const name2 = "dir000/file.txt";
    const body = "This is a file.";

    fs.writeFileSync(Path.join(tmp, name1), body);

    client.link(name1, name2, (err) => error(err, done, "ENOENT", wrongPath));
  });

  it("link(path1, path2)", (done) => {
    const name1 = getFileName();
    const name2 = getFileName();
    let body = "This is a file.";

    fs.writeFileSync(Path.join(tmp, name1), body);
    assert.ok(!fs.existsSync(Path.join(tmp, name2)), "File should not exist");

    client.link(name1, name2, (err) =>
      check(err, done, () => {
        body = "This is a changed file.";
        fs.writeFileSync(Path.join(tmp, name1), body, { flag: "r+" });

        const body2 = fs.readFileSync(Path.join(tmp, name2), {
          encoding: "utf8",
        });
        assert.equal(body2, body, "File content mismatch");
        done();
      }),
    );
  });

  it("unlink(no-path)", (done) => {
    const name = getFileName();

    client.unlink(name, (err) => error(err, done, "ENOENT", wrongPath));
  });

  it("unlink(path)", (done) => {
    const name = getFileName();
    const body = "This is a file.";

    fs.writeFileSync(Path.join(tmp, name), body);

    client.unlink(name, (err) =>
      check(err, done, () => {
        assert.ok(
          !fs.existsSync(Path.join(tmp, name)),
          "File should not exist",
        );
        done();
      }),
    );
  });

  it("open(no-path, 'r+')", (done) => {
    const name = getFileName();

    client.open(name, "r+", {}, (err, _handle) =>
      error(err, done, "ENOENT", wrongPath),
    );
  });

  it("open(path, 'r+')/read/close", (done) => {
    const name = getFileName();

    const body =
      "0123456789" +
      "9876543210" +
      "00112233445566778899" +
      "abcdefghijklmnopqrstuvwxyz" +
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    fs.writeFileSync(Path.join(tmp, name), body);

    client.open(name, "r+", {}, (err, handle) =>
      check(err, done, () => {
        const buffer = Buffer.alloc(35);
        buffer.fill(0);

        client.read(handle, buffer, 0, 30, 10, (err) =>
          check(err, done, () => {
            client.read(handle, buffer, 30, 5, 66, (err) =>
              check(err, done, () => {
                client.read(handle, buffer, 10, 3, 40, (err) =>
                  check(err, done, () => {
                    const body2 = buffer.toString();
                    assert.equal(
                      body2,
                      "9876543210" + "abc" + "12233445566778899" + "ABCDE",
                      "File content mismatch",
                    );

                    client.read(
                      handle,
                      buffer,
                      0,
                      10,
                      1000,
                      (err, buf, bytesRead) =>
                        check(err, done, () => {
                          assert.equal(
                            buf.length,
                            0,
                            "Unexpected buffer length",
                          );
                          assert.equal(bytesRead, 0, "Unexpected bytesRead");

                          client.close(handle, done);
                        }),
                    );
                  }),
                );
              }),
            );
          }),
        );
      }),
    );
  });

  it("open(no-path, 'w+')/write/close", (done) => {
    const name = getFileName();

    client.open(name, "w+", {}, (err, handle) =>
      check(err, done, () => {
        const stats = fs.statSync(Path.join(tmp, name));
        assert.ok(stats.isFile, "Not a file");
        assert.equal(stats.size, 0, "Unexpected file size");

        const buffer = Buffer.from(
          "0123456789" +
            "9876543210" +
            "00112233445566778899" +
            "abcdefghijklmnopqrstuvwxyz" +
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        );

        client.write(handle, buffer, 10, 30, 0, (err) =>
          check(err, done, () => {
            client.write(handle, buffer, 66, 5, 30, (err) =>
              check(err, done, () => {
                client.write(handle, buffer, 40, 3, 10, (err) =>
                  check(err, done, () => {
                    const body2 = fs.readFileSync(Path.join(tmp, name), {
                      encoding: "utf8",
                    });
                    assert.equal(
                      body2,
                      "9876543210" + "abc" + "12233445566778899" + "ABCDE",
                      "File content mismatch",
                    );

                    client.close(handle, done);
                  }),
                );
              }),
            );
          }),
        );
      }),
    );
  });

  it("read(no-handle)", (done) => {
    try {
      client.read(123, Buffer.alloc(10), 0, 10, 0, done);
      assert.fail("Call should have failed");
    } catch (error) {
      assert.equal(error.message, "Invalid handle");
      done();
    }
  });

  it("write(no-handle)", (done) => {
    try {
      client.write(123, Buffer.alloc(10), 0, 10, 0, done);
      assert.fail("Call should have failed");
    } catch (error) {
      assert.equal(error.message, "Invalid handle");
      done();
    }
  });

  it("close(no-handle)", (done) => {
    try {
      client.close(123, done);
      assert.fail("Call should have failed");
    } catch (error) {
      assert.equal(error.message, "Invalid handle");
      done();
    }
  });

  it("fstat(no-handle)", (done) => {
    try {
      client.fstat(123, done);
      assert.fail("Call should have failed");
    } catch (error) {
      assert.equal(error.message, "Invalid handle");
      done();
    }
  });

  it("stat(no-path)", (done) => {
    const name = "dir000/file.txt";

    client.stat(name, (err, _attrs) => error(err, done, "ENOENT", wrongPath));
  });

  it("stat(path)", (done) => {
    const name = "full/file1-quite-long-name.txt";

    const stats = fs.statSync(Path.join(tmp, name));
    //console.log(stats);

    client.stat(name, (err, attrs) =>
      check(err, done, () => {
        //console.log(attrs);
        equalStats(attrs, stats);
        done();
      }),
    );
  });

  it("lstat(no-path)", (done) => {
    const name = "dir000/file.txt";

    client.lstat(name, (err, _attrs) => error(err, done, "ENOENT", wrongPath));
  });

  it("lstat(path)", (done) => {
    const name = "full/file1-quite-long-name.txt";

    const stats = fs.statSync(Path.join(tmp, name));
    //console.log(stats);

    client.lstat(name, (err, attrs) =>
      check(err, done, () => {
        //console.log(attrs);
        equalStats(attrs, stats);
        done();
      }),
    );
  });

  it("fstat(closed-handle)", (done) => {
    const name = "full/file2-quite-long-name.txt";

    client.open(name, "r+", {}, (err, handle) =>
      check(err, done, () => {
        client.close(handle, (err) =>
          check(err, done, () => {
            client.fstat(handle, (err, _attrs) =>
              error(err, done, "EFAILURE", "Invalid handle"),
            );
          }),
        );
      }),
    );
  });

  it("fstat(handle)", (done) => {
    const name = "full/file2-quite-long-name.txt";

    client.open(name, "r+", {}, (err, handle) =>
      check(err, done, () => {
        const stats = fs.statSync(Path.join(tmp, name));
        //console.log(stats);

        client.fstat(handle, (err, attrs) =>
          check(err, done, () => {
            //console.log(attrs);
            equalStats(attrs, stats);
            client.close(handle, done);
          }),
        );
      }),
    );
  });

  it("setstat(no-path)", (done) => {
    const name = "dir000/file.txt";

    client.setstat(name, { size: 12 }, (err) =>
      error(err, done, "ENOENT", wrongPath),
    );
  });

  it("setstat(path)", (done) => {
    const name = getFileName();

    const body = "0123456789" + "0123456789" + "0123456789";
    fs.writeFileSync(Path.join(tmp, name), body);

    const mtime = new Date(2014, 8);
    const atime = new Date(2014, 9);

    client.setstat(name, { size: 12, mtime: mtime, atime: atime }, (err) =>
      check(err, done, () => {
        const stats = fs.statSync(Path.join(tmp, name));
        //console.log(stats);

        assert.equal(stats.size, 12);
        assert.equal(stats.mtime.getTime() / 1000, mtime.getTime() / 1000);
        assert.equal(stats.atime.getTime() / 1000, atime.getTime() / 1000);

        done();
      }),
    );
  });

  it("open(path)/fsetstat", (done) => {
    const name = getFileName();

    const body = "0123456789" + "0123456789" + "0123456789";
    fs.writeFileSync(Path.join(tmp, name), body);

    const mtime = new Date(2014, 8);
    const atime = new Date(2014, 9);

    client.open(name, "r+", {}, (err, handle) =>
      check(err, done, () => {
        client.fsetstat(
          handle,
          { size: 12, mtime: mtime, atime: atime },
          (err) =>
            check(err, done, () => {
              const stats = fs.statSync(Path.join(tmp, name));
              //console.log(stats);

              assert.equal(stats.size, 12);
              assert.equal(
                (stats.mtime.getTime() / 1000) | 0,
                (mtime.getTime() / 1000) | 0,
              );
              assert.equal(
                (stats.atime.getTime() / 1000) | 0,
                (atime.getTime() / 1000) | 0,
              );

              client.close(handle, done);
            }),
        );
      }),
    );
  });

  /*
    TODO: (Unix-only)
    symlink(targetpath: string, linkpath: string, callback ?: (err: Error) => any): void;
    readlink(path: string, callback?: (err: Error, linkString: string) => any): void;
    lstat(path: string, callback?: (err: Error, attrs: IStats) => any): void;
    */
});
