var util = require('util')
  , fs = require('fs')
  , ftpd = require('lib/ftpd'),
  , FileWatcher = require('lib/filewatcher.js');

/**
 * This is a sample of utilizing the nodeftpd class to track uploads/downloads from clients
 * it allows you to add in event hooks on events, such as processing a file once it's been 
 * successfully uploaded
 * 
 * see lib/ftpd.js for full functionality of the FTP server
 *
 */
var Workflow = function (cfg) {
	var self = this;
	this.sessions = {};
	
	// use Workflow as authentication mechanism
	// it will authenticate on a socket's command:user and command:pass events
	cfg.authentication = self;
	this.ftpdaemon = ftpd.createServer(cfg);
	
	if (typeof cfg.onReady == 'function') {
		this.ftpdaemon.server.on('server:ready', this.onReady);
	}
	
	if (typeof cfg.onError == 'function') {
		this.ftpdaemon.server.on('server:error', this.onError);	
	}
	
	// initialize session for client socket
	this.ftpdaemon.server.on('client:connected', function (socket) {
	
		console.log('WORKFLOW','client connected: ' + socket.remoteAddress);
		
		// keep track of client's session
		var session = {
			username: null,
			password: null,
			incomingFiles: {},
			outgoingFiles: {},
			dir: '',
			addr: socket.remoteAddress,
			active: true,
			sessionNum: 1
		};
		
		if (self.sessions[socket.remoteAddress] != null && self.sessions[socket.remoteAddress].active) {
			console.warn('client previously connected ' + session.sessionNum + ' times.  NOT overwriting!');
			
			// indicate that this is not the first session from this client
			session.sessionNum += 1;
			
			// put in as unique value
			self.sessions[socket.remoteAddress + '_' + Math.random().toString(16).slice(2)] = session;
		} else {
			self.sessions[socket.remoteAddress] = session;
		}
		
		// authenticate user.  right now it will take any user.  add your own authentication here
		socket.on('command:user', function (user, callback) {
			if (!user) {
				callback( new Error('Invalid Username') );
				return;
			}
			
			session.username = user;
			callback(null);
		});
		
		// authenticate password. right now it will take anything.  add your own authentication here
		socket.on('command:pass', function (pass, callback) {
			if (!pass) {
				callback( new Error('Invalid Password') );
				return;
			}
			
			console.log('WORKFLOW','saved password');
			session.password = pass;
			callback(null);
		});
		
		// triggered on directory change
		socket.on('command:cwd', function (dir) {
			console.log('WORKFLOW','changing directory');
			session.dir = dir;
		});
		
		// save a reference to the file requested by client
		socket.on('command:retr', function (filename) {
			console.log('WORKFLOW','retrieving file');
			session.outgoingFiles[filename] = {
				filename: filename,
				dir: session.dir,
				startFTP: null,
				endFTP: null
			};
		});
		
		// track when started
		socket.on('command:retr:begin', function (filename) {
			console.log('WORKFLOW','begin transfer', session.addr);
			session.outgoingFiles[filename].startFTP = Date.now();
		});
		
		// track when ended
		socket.on('command:retr:end', function (filename) {
			console.log('WORKFLOW','transfer complete', session.addr);
			session.outgoingFiles[filename].endFTP = Date.now();
		});
		
		// save a reference to file sent by client
		socket.on('command:stor', function (filename) {
			console.log('WORKFLOW','beginning save of ', filename, session.addr);
			session.incomingFiles[filename] = {
				filename: filename,
				dir: session.dir,
				startFTP: null,
				endFTP: null
			};

		});
		
		// when store begins add a FileWatcher to poll for changes in filesystem
		// this is helpful for some older FTP clients, which may not close the socket once complete
		socket.on('command:stor:begin', function (filename, absolutePath) {
			console.log('WORKFLOW','begin transfer', session.addr);
			session.incomingFiles[filename].startFTP = Date.now();
			session.incomingFiles[filename].absolutePath = absolutePath;
			
			session._watcher = new FileWatcher(absolutePath, function(err, stats) {
				if(err) {
					console.warn('STOR', 'Error watching for writes', err);
					return;
				}
				
				// this occurs if there's been no updates for 15 sec
				// (set via FileWatcherFILESIZE_TIMEOUT_MS in filewatcher.js)
				console.log('write timeout!', stats);
				// continue with process, since file should be done now.
				if (!session.incomingFiles[filename].endFTP) {
					socket.emit('command:stor:end', filename, absolutePath);
				}
				
			});
			
			session._watcher.on('modified', function (stats) {
				console.log('STOR', 'MODIFIED', stats.mtime.toLocaleTimeString());
			});
			
			session._watcher.on('change', function (kbps) {
				console.log('STOR speed: %s', kbps);
			});
			
		});
		
		// error on save
		socket.on('command:stor:error', function (err) {
			console.log('\nSTOR', 'DATA SOCKET ERROR', err, ' - PROBABLE TRANSMISSION FAILURE\n');
			
			var timeSinceLastWrite = Date.now() - session._watcher.lastWriteTime;
			
			console.log('STOR', 'time since last write: ', (timeSinceLastWrite/1000).toFixed(2));
		});
		
		// file has been saved
		socket.on('command:stor:end', function (filename, absolutePath) {
			console.log('WORKFLOW','transfer complete', session.addr);
			
			session.incomingFiles[filename].endFTP = Date.now();
			
			if (session._watcher) {
				session._watcher.close();
				delete session._watcher;
			}
			
			// ... do something with this new file you just received ...
			
		});
		
		socket.on('command:quit', function () {
			console.log('WORKFLOW','client connection closed', session.addr);
			session.active = false;
		});
		
	});
	
};

// gets the public IP based on DNS records
Workflow.prototype.getIP = function (callback) {
	var os = require('os');
	var dns = require('dns');
	dns.resolve4(os.hostname(), function (err, address) {
		if (err) return callback(err);
		else callback(null, address[0]);
	});
};


module.exports = Workflow;

if (!module.parent) {

	var args = process.argv.slice(2) // first 2 args are node and script filename
	  , host = args[0] || '127.0.0.1'
	  , port = args[1] || 21;
	  , root = args[2] || './test/incoming';
	  , cfg = {
			debugging: 10,
			root: root,
			port: port,
			host: host
		};
	
	worker = new Workflow(cfg);
	console.log('WORKFLOW','running');
}