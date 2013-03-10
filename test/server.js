var util = require('util'),
		ftpd = require('../lib/ftpd');
		
var TestServer = function(cfg) {
	var self = this;
	this.sessions = {};
	
	// use TestServer as authentication mechanism
	cfg.authentication = self;
	this.ftpdaemon = ftpd.createServer(cfg);
	
	this.onReady = cfg.onReady || function() {};
	this.onError = cfg.onError || function() {};
	this.ftpdaemon.server.on('server:ready', this.onReady);
	this.ftpdaemon.server.on('server:error', this.onError);
	
	// initialize session for socket
	this.ftpdaemon.server.on('client:connected', function(socket) {
		console.log('TEST',"client connected: " + socket.remoteAddress);
		self.sessions[socket.remoteAddress] = {
			username: null,
			password: null,
			incomingFile: null,
			addr: socket.remoteAddress
		};
		
		socket.on('command:user', function(user, callback) {
			if(!user) {
				callback( new Error('Invalid Username') );
				return;
			}
			
			self.sessions[socket.remoteAddress].username = user;
			callback(null);
		});
				
		socket.on('command:pass', function(pass, callback) {
			if(!pass) {
				callback( new Error('Invalid Password') );
				return;
			}
			
			console.log('TEST','saved password');
			self.sessions[socket.remoteAddress].password = pass;
			callback(null);
		});
		
		socket.on('command:cwd', function(dir) {
			console.log('TEST','changing directory');
			self.sessions[socket.remoteAddress].dir = dir;
		});
		
		socket.on('command:retr', function(file) {
			console.log('TEST','retrieving file');
			self.sessions[socket.remoteAddress].getFile = file;
		});
		
		socket.on('command:stor', function(file) {
			console.log('TEST','beginning save of ', file);
			self.sessions[socket.remoteAddress].incomingFile = file;
		});
		
		socket.on('command:stor:begin', function() {
			console.log('TEST','begin transfer');
		});
		
		socket.on('command:stor:end', function() {
			console.log('TEST','transfer complete');
			console.log('TEST','begin next process');
			self.doNextProcess(self.sessions[socket.remoteAddress]);
		});
		
		socket.on('command:quit', function() {
			console.log('TEST','client connection closed');
		});
		
	});
	
};

TestServer.prototype.doNextProcess = function(session) {
	console.log('TEST','user has uploaded file, now we can do something with it.');
	console.log('TEST',session);	
};

TestServer.prototype.close = function(callback) {
	this.ftpdaemon.close(callback);
}

module.exports = TestServer;

/**
 * If run from commandline use args to set host, port and root directory
 */

if (!module.parent) {
	var args = process.argv.slice(2); // first 2 args are node and script filename
	var host = args[0] || '127.0.0.1';
	var port = args[1] || 21;
	var root = args[2] || './data';
	
	var server = new TestServer({
		root: root, 
		host: host,
		port: port
	});
}
