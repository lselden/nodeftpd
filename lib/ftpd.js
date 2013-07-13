'use strict';

var FTP_PORT = 21,
	FTP_HOST = null,
	PASSIVE_MODE_SUPPORTED = true; // set to false if server is behind firewall (use active mode only)

var path = require('path'),
	net = require('net'),
	fs = require('./ftpd.fs'); // abstracted filesystem

/**
 * FtpServer - FTP server in node
 *
 * 	@param {object} cfg - may have:
 *		{string} host - IP or hostname.
 *		{number} port - port to use.  defaults to 21
 *		{string} root - root directory for filesystem
 *		{number} debugging - set verbosity of console logging. 0 is silent. 10 is pretty much everything
 * 
 */
		
var FtpServer = function (cfg) {

	var option;
	// Set up some properties used all around
	for (option in cfg) {
		if (!this[option] && cfg.hasOwnProperty(option)) {
			this[option] = cfg[option];
		}
	}

	this.root = this.root || "./incoming"; // change to root for filesystem
	this.port = this.port || FTP_PORT;
	this.host = this.host || FTP_HOST;

	this.debugging = this.debugging || 4;

	this._createServer(this.port, this.host);

	// replace via options to change authentication method
	this.authentication = this.authentication || new Authentication(this.server);

	return this;
};

/**
 *	This class/function handles authenticating users.
 *  This implementation accepts connections as long as they
 *	supply a username and password
 *
 * Consider this an Interface.  You should create your own class to handle authentication
 */
var Authentication = function (server) {
	server.on('client:connected', function (socket) {
		var username = null;
		console.log("client connected: " + socket.remoteAddress);
		socket.on('command:user', function (user, callback) {
			if (user) {
				console.log("set username to ", username);
				username = user;
				callback(null);
			} else {
				callback(new Error("no username"));
			}
		});
		socket.on('command:pass', function (pass, callback) {
			if (pass) {
				callback(null);
			} else {
				callback(new Error("bad password"));
			}
		});
	});
};


/**
 * Standard messages for status (RFC 959)
 */
var messages = {
	"200": "Command okay.",
	"500": "Syntax error, command unrecognized.", // This may include errors such as command line too long.
	"501": "Syntax error in parameters or arguments.",
	"202": "Command not implemented, superfluous at this site.",
	"502": "Command not implemented.",
	"503": "Bad sequence of commands.",
	"504": "Command not implemented for that parameter.",
	"110": "Restart marker reply.", // In this case, the text is exact and not left to the particular implementation; it must read: MARK yyyy = mmmm Where yyyy is User-process data stream marker, and mmmm server's equivalent marker (note the spaces between markers and "=").
	"211": "System status, or system help reply.",
	"212": "Directory status.",
	"213": "File status.",
	"214": "Help message.", // On how to use the server or the meaning of a particular non-standard command. This reply is useful only to the human user.
	"215": "NodeFTP server emulator.", // NAME system type. Where NAME is an official system name from the list in the Assigned Numbers document.
	"120": "Service ready in %s minutes.",
	"220": "Service ready for new user.",
	"221": "Service closing control connection.", // Logged out if appropriate.
	"421": "Service not available, closing control connection.", // This may be a reply to any command if the service knows it must shut down.
	"125": "Data connection already open; transfer starting.",
	"225": "Data connection open; no transfer in progress.",
	"425": "Can't open data connection.",
	"226": "Closing data connection.", // Requested file action successful (for example, file transfer or file abort).
	"426": "Connection closed; transfer aborted.",
	"227": "Entering Passive Mode.", // (h1,h2,h3,h4,p1,p2).
	"230": "User logged in, proceed.",
	"530": "Not logged in.",
	"331": "User name okay, need password.",
	"332": "Need account for login.",
	"532": "Need account for storing files.",
	"150": "File status okay; about to open data connection.",
	"250": "Requested file action okay, completed.",
	"257": "\"%s\" created.",
	"350": "Requested file action pending further information.",
	"450": "Requested file action not taken.", // File unavailable (e.g., file busy).
	"550": "Requested action not taken.", // File unavailable (e.g., file not found, no access).
	"451": "Requested action aborted. Local error in processing.",
	"551": "Requested action aborted. Page type unknown.",
	"452": "Requested action not taken.", // Insufficient storage space in system.
	"552": "Requested file action aborted.", // Exceeded storage allocation (for current directory or dataset).
	"553": "Requested action not taken.", // File name not allowed.
};

/**
 * These commands do not require authorization for use
 */
var bypassAuthorizationCommands = ["ABOR", "FEAT", "PASS", "USER", "QUIT", "SYST", "NOOP", "STAT"];

/**
 * Commands implemented by the FTP server
 */
var commands = {
	/**
	* Unsupported commands
	* They're specifically listed here as a roadmap, but any unexisting command will reply with 202 Not supported
	*/
	"ABOR": function () { this.reply(202); }, // Abort an active file transfer.
	"ACCT": function () { this.reply(202); }, // Account information
	"ADAT": function () { this.reply(202); }, // Authentication/Security Data (RFC 2228)
	"ALLO": function () { this.reply(202); }, // Allocate sufficient disk space to receive a file.
	"APPE": function () { this.reply(502); }, // Append.
	"AUTH": function () { this.reply(202); }, // Authentication/Security Mechanism (RFC 2228)
	"CCC":  function () { this.reply(202); }, // Clear Command Channel (RFC 2228)
	"CONF": function () { this.reply(202); }, // Confidentiality Protection Command (RFC 697)
	"ENC":  function () { this.reply(202); }, // Privacy Protected Channel (RFC 2228)
	"EPRT": function () { this.reply(202); }, // Specifies an extended address and port to which the server should connect. (RFC 2428)
	"EPSV": function () { this.reply(202); }, // Enter extended passive mode. (RFC 2428)
	"HELP": function () { this.reply(202); }, // Returns usage documentation on a command if specified, else a general help document is returned.
	"LANG": function () { this.reply(202); }, // Language Negotiation (RFC 2640)
	"LPRT": function () { this.reply(202); }, // Specifies a long address and port to which the server should connect. (RFC 1639)
	"LPSV": function () { this.reply(202); }, // Enter long passive mode. (RFC 1639)
	"MDTM": function () { this.reply(202); }, // Return the last-modified time of a specified file. (RFC 3659)
	"MIC":  function () { this.reply(202); }, // Integrity Protected Command (RFC 2228)
	"MLSD": function () { this.reply(202); }, // Lists the contents of a directory if a directory is named. (RFC 3659)
	"MLST": function () { this.reply(202); }, // Provides data about exactly the object named on its command line, and no others. (RFC 3659)
	"MODE": function () { this.reply(202); }, // Sets the transfer mode (Stream, Block, or Compressed).
	"NOOP": function () { this.reply(202); }, // No operation (dummy packet; used mostly on keepalives).
	"OPTS": function () { this.reply(202); }, // Select options for a feature. (RFC 2389)
	"REIN": function () { this.reply(202); }, // Re initializes the connection.
	"STOU": function () { this.reply(202); }, // Store file uniquely.
	"STRU": function () { this.reply(202); }, // Set file transfer structure.
	"PBSZ": function () { this.reply(202); }, // Protection Buffer Size (RFC 2228)
	"SITE": function () { this.reply(202); }, // Sends site specific commands to remote server.
	"SMNT": function () { this.reply(202); }, // Mount file structure.
	"RMD":  function () { this.reply(502); }, // Remove a directory.
	"STAT": function () { this.reply(502); }, //
	
	/** GENERAL INFO **/
	
	"FEAT": function () {
		this.write("211-Extensions supported\r\n");
		this.write(" SIZE\r\n");
		this.reply(211, "End");
	},
	"SYST": function () {
		this.reply(215, "Node FTP server");
	},
	
	/** PATH COMMANDS **/
	
	// Change to parent directory
	"CDUP": function () {
		commands.CWD.call(this, '..');
	},
	// Change working directory
	"CWD":  function (dir) {
		var socket = this;

		socket.fs.chdir(dir, function (err, cwd) {
			if (err) {
				socket.reply(err.code || 550, err.message || "Folder note found.");
				return;
			} else {
				socket.reply(250, "Directory changed to \"" + cwd + "\"");
				socket.emit('command:cwd', dir);
			}
		});
	},
	"PWD":  function () { // Get working directory

		this.reply(257, '"' + this.fs.pwd() + '"');
	},
	"XPWD": function () { // Alias to PWD
		commands.PWD.call(this);
	},
	
	// Set data encoding
	"TYPE": function (dataEncoding) {

		if (dataEncoding === "A" || dataEncoding === "I") {
			this.dataEncoding = (dataEncoding === "A") ? "ascii" : "binary";
			this.reply(200, "Type set to " + dataEncoding);
		} else {
			this.reply(501);
		}
	},
	
	/** AUTHENTICATION **/
	
	"USER": function (username) {
		var socket = this;

		socket.authenticated = false;
		socket.emit('command:user', username, function (err) {
			if (err) {
				socket.reply(err.code || 530, err.message || "Invalid username: " + username);
			} else {
				socket.username = username;
				socket.reply(331);
			}
		});
	},
	"PASS": function (password) {
		var socket = this;

		if (!socket.username) {
			return socket.reply(503);
		}
		socket.emit('command:pass', password, function (err) {
			if (err) {
				socket.reply(err.code || 530, err.message || "Invalid password");
				socket.authFailures++;
				socket.username = null;
				socket.authenticated = false;
			} else {
				socket.reply(230);
				socket.authenticated = true;
			}
		});
	},
	
	/** DATA TRANSFER **/
	
	// Enter passive mode
	"PASV": function () {
		var socket = this,
			dataListener,
			dataPort = 0; // listen to random port

		if (!PASSIVE_MODE_SUPPORTED) {
			socket.reply(500, "Passive mode not supported");
			return;
		}

		if (socket.dataListener) {
			try {
				socket.dataListener.close();
			} catch (e) { }; // ignore already closed errors
			socket.dataListener = null;
		}
		
		// passive streams data on a different port, so make server to handle secondary connection
		dataListener = net.createServer();

		dataListener.on('connection', function (dataSocket) {

			socket.logIf(1, "Incoming passive data connection", socket);
			
			dataSocket.on('close', function () {
				socket.reply(dataSocket.error ? 426 : 226, "Limit");
				dataListener.close();
			});


			dataSocket.on('error', function (err) {
				dataSocket.error = err;
				socket.reply(err.code || 500, err.message);
			});

			//dataSocket.setEncoding(socket.dataEncoding);
			socket.logIf(1, "Passive data event: connect", socket);
			// Unqueue method that has been queued previously
			if (socket.dataTransfer.queue.length) {
				socket.dataTransfer.queue.shift().call(dataSocket);
			} else {
				dataSocket.emit('error', {'code': 421});
				socket.end();
			}
		});

		dataListener.listen(dataPort, function () {
			var port = dataListener.address().port;
			var host = socket.server.address().address;

			socket.logIf(3, "PASV listening: Port: " + port +  " host: " + host);
			socket.passive = true;
			
			// once listening let client know it's okay to send data, and on what port
			socket.dataInfo = { host: host, port: port };
			socket.reply(227, [
				"PASV OK (", 
				host.replace(/\./g,',') , ",", 
				parseInt(port / 256, 10), ",", 
				(port % 256), 
				")"
			].join(''));

			dataListener.on('close', function () {
				socket.dataListener = null;
				socket.passive = false;
			});
		});

		socket.dataListener = dataListener;

	},
	// Active mode.  client tells server what port to use
	"PORT": function (info) {

		var socket = this;
		socket.passive = false;
		if (socket.dataListener) {
			socket.dataListener.close();
		}
		socket.dataListener = null;

		var addr = info.split(',');
		var host = addr.slice(0, 4).join('.');
		var port = (parseInt(addr[4], 10) * 256) + parseInt(addr[5], 10);

		socket.dataInfo = { host: host, port: port };

		socket.reply(200, "PORT command successful");
	},
	
	/** FILESYSTEM **/
	
	// list all files in directory
	"LIST": function (target) {
		var socket = this;

		socket.dataTransfer(function (dataSocket, callback) {
			//dataSocket.setEncoding(socket.dataEncoding);
			socket.fs.list(target || socket.fs.pwd(), function (err, result) {
				if (err) {
					callback(err);
					return;
				}

				// supports streaming to socket, or just writing string
				if (typeof result === 'object' && result.pipe) {

					result.on('error', function (err) {
						socket.logIf(4, 'list stream error' + err.message);
					});

					result.on('end', function () {
						callback(null);
					});

					result.pipe(dataSocket, {end: false });
				} else {
					dataSocket.write(result, callback);
				}

			});
		});
	},
	"NLST": function (target) {
		// TODO: just the list of file names
		this.reply(202);
	},
	
	// send file
	"RETR": function (file) {
		var socket = this;

		// allows callbacks on retrieving file
		socket.emit('command:retr', file);
		
		// dataTransfer handles active/passive mode differences
		socket.dataTransfer(function (dataSocket, callback) {
			socket.emit('command:retr:begin', file);
			socket.fs.readFile(file, function (err, stream) {
				if (err) {
					return callback(err);
				} else {
					stream.pipe(dataSocket);
				}
				
				dataSocket.on('close', function () {
					socket.emit('command:retr:end', file);
				});
			});
		});
	},
	
	// save file
	"STOR": function (file) {
		var socket = this
			, absolutePath = socket.fs.resolve(file);

		// can listen to storing files as well
		socket.emit('command:stor', file);
		
		// dataTransfer handles active/passive mode differences
		socket.dataTransfer(function (dataSocket, callback) {

			socket.emit('command:stor:begin', file, absolutePath);

			socket.fs.writeFile(file, function (err, stream) {
				if (err) {
					return callback(err);
				}

				dataSocket.pipe(stream);

				dataSocket.on('close', function () {
					socket.emit('command:stor:end', file, absolutePath);
				});
				
				dataSocket.on('error', function (err) {
					// callback(err) ???
					socket.emit('command:stor:error', file, err);
				});
			});
		});
	},
	
	// Make directory.
	"MKD":  function (dir) {
		var socket = this;
		socket.fs.mkdir(dir, function (err) {
			if (err) {
				socket.reply(err.code || 550, err.message || "Cannot create directory.");
			} else {
				socket.reply(250, "Directory created");
			}
		});
	},
	// delete file
	"DELE": function (file) {
		var socket = this;
		socket.fs.unlink(file, function (err) {
			if (err) {
				socket.reply(err.code || 550, err.message || "Permission denied.");
			} else {
				socket.reply(250, "File deleted");
			}
		});
	},
	// Rename from.
	"RNFR": function (name) {
		var socket = this;

		socket.fs.exists(name, function (exists) {
			if (exists) {
				socket.reply(350, "File exists, ready for destination name");
				socket.fileFrom = name;
			} else {
				socket.reply(350, "Command failed, file does not exist");
				socket.fileFrom = null;
			}
		});
	},
	// Rename to
	"RNTO": function (fileTo) {
		var socket = this;
		if (!socket.fileFrom) {
			return socket.reply(503); // bad sequence, call rnfr first
		}
		socket.fs.rename(fileTo, socket.fileFrom, function (err) {
			if (err) {
				socket.reply(550, "Rename failed");
			} else {
				socket.fileFrom = null;
				socket.reply(250, "File renamed successfully");
			}
		});

	},
	// Allow restart interrupted transfer
	"REST": function (start) {
		// Restart transfer from the specified point.
		this.reply(202); // TODO

	},
	// Get size of file
	"SIZE": function (file) {
		var socket = this;
		socket.fs.stat(file, function (err, stats) {
			if (err) {
				socket.reply(450, "Failed to get size of file");
			} else {
				socket.reply(213, stats.size);
			}
		});
	},
	
	/** DISCONNECT **/
	
	"QUIT": function () {
		this.reply(221);
		this.end();
		this.emit('command:quit');
	}
};

(function () {
	// private function that actually sets up the server
	// creates FTP server listing on port/host
	this._createServer = function (port, host) {
		var self = this;

		// put defer on to make sure this completes?
		if (this.server && this.server.close) {
			this.server.close();
		}

		var server = net.createServer();

		server.debugging = this.debugging;

		// debugging helper function
		var logIf = function (level, message, socket) {
			if (server.debugging >= level) {
				if (socket) {
					console.log(socket.remoteAddress + ": " + message);
				} else {
					console.log(message);
				}
			}
		};

		server.on('listening', function () {
			console.log("nodeFTPd server up and ready for connections");
			server.emit('server:ready', server);
		});

		// set up new client session
		server.on('connection', function (socket) {
			server.emit('client:connected', socket); // pass socket so they can listen for client-specific events

			socket.setTimeout(0); // We want to handle timeouts ourselves
			socket.setNoDelay();

			// TODO should this default to ascii or binary?
			//socket.setEncoding("ascii"); // force data String not Buffer, so can parse FTP commands as a string

			socket.passive = false;
			socket.dataListener = null;
			socket.dataInfo = null;

			// Authentication
			socket.authenticated = false;
			socket.authFailures = 0; // 3 tries then we disconnect you
			socket.username = null;

			// debug helper function
			socket.logIf = logIf;

			// TODO sync with new class
			//socket.fs = new FtpServer.Filesystem();
			socket.fs = new fs.FileSystem({root: self.root});

			// TODO necessary?
			socket.server = server;

			socket.reply = function (status, message, callback) {
				if (!message) {
					message = messages[status + ''] || "No information";
				}

				socket.logIf(5, "Reply: " + status + ' ' + message);
				socket.write([status, ' ', message, '\r\n'].join(''), callback);
			};

			/**
			 * Data transfer
			 * this function handles passive/active data connections
			 */
			socket.dataTransfer = function (handle) {
				// wrap callback in queue process
				var execute = function () {
					var dataSocket = this;

					socket.reply(150);

					handle.call(socket, dataSocket, function (err) {

						if (err) {
							dataSocket.emit('error', err);
						} else {
							dataSocket.end();
						}
					});
				};

				if (socket.passive) { // Will be unqueued in PASV command
					socket.dataTransfer.queue.push(execute);

				} else { // Or we initialize directly the connection to the client
					var dataSocket = net.createConnection(socket.dataInfo.port, socket.dataInfo.host);
					
					dataSocket.on('error', function (err) {
						socket.reply(err.code || 500, err.message);
					});
					dataSocket.on('close', function () {
						console.log('sending reply from dataTransfer');
						socket.reply(dataSocket.error ? 426 : 226, "Limit");
					});
					execute.call(dataSocket);
				}
			};
			socket.dataTransfer.queue = [];

			// route incoming commands
			socket.on('readable', function () {
				var data = socket.read();
				data = (data || '').toString().trim();
				
				var parts = data.match(/(\w+)\b\s?(.*)/);
				
				if (!data || !parts) {
					// empty input, nothing to do
					// TODO should we return anything?
					return socket.reply(502);
				}
				var command = parts[1].toUpperCase()
					, arg = parts[2]
					, callable = commands[command];

				socket.logIf(2, "FTP command: " + command, socket);

				// ignore unknown commands
				if (!callable) {
					return socket.reply(502);
				}
				
				// throw security exception if not authorized for given command
				if ((bypassAuthorizationCommands.indexOf(command) === -1) && !socket.authenticated) {
					return socket.reply(530);
				}
				
				callable.call(socket, arg);

			});

			socket.on('end', function () {
				socket.logIf(1, "Client connection ended", socket);
			});

			socket.on('error', function (err) {
				socket.logIf(0, "Client connection error: " + err, socket);
			});

			// on connect tell client ready
			socket.logIf(1, "Connection", socket);
			socket.write("220 FTP server (nodeftpd) ready\r\n");
		});

		var connectAttempts = 0;
		server.on('error', function (e) {
			if (e.code === 'EADDRINUSE') {
				logIf(1, "Address in use, retrying..." + port + ", " + host);

				connectAttempts += 1;
				if (connectAttempts >= 60) {
					throw e; // make sure there's a limit
				}

				setTimeout(function () {
					server.close();
					server.listen(port, host);
				}, 1000);
			} else {
				console.warn('unknown server error', e);
				server.emit('server:error', e);
			}
		});

		server.listen(port, host);

		this.server = server;
	},
	
	this.close = function(callback) {
		this.server.close(callback);
	}

}).call(FtpServer.prototype);

module.exports.messages = messages;
module.exports.commands = commands;
module.exports.bypassAuthorizationCommands = bypassAuthorizationCommands;
module.exports.FtpServer = FtpServer;
module.exports.createServer = function (cfg) {
	return new FtpServer(cfg);
};