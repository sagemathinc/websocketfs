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

    // disconnect
    //client.end();
  });
});

client.on("error", (err) => {
  console.log("on error:", {err});
});



exports.client = client;
