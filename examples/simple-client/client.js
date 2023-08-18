const SFTP = require("../..");

// url, credentials and options
const url = "ws://localhost:4001";

// connect to the server
const client = new SFTP.Client();

client.connect(url, {}, function (err) {
  if (err) {
    // handle error
    console.log("Error: %s", err.message);
    return;
  }

  // display a message
  console.log("Connected to %s", url);

  // retrieve directory listing
  client.list(".", function (err, list) {
    if (err) {
      // handle error
      console.log("Error: %s", err.message);
      return;
    }

    // display the listing
    list.forEach(function (item) {
      console.log(item.longname);
    });
  });

  console.log("opening and reading README.md");
  client.open("README.md", "r", (err, handle) => {
    if (err) {
      console.log("failed to open README.md");
    } else {
      console.log("open got handle ", handle._handle);
      const buffer = Buffer.alloc(100);
      client.read(handle, buffer, 0, 100, 0, (err, buffer2, bytesRead) => {
        console.log("read got back", {
          err,
          buf: buffer.slice(0, bytesRead).toString(),

          bytesRead,
        });

        // disconnect
        client.end();
      });
    }
  });
});

client.on("error", (err) => {
  console.log("on error:", { err });
});

exports.client = client;
