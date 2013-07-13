'use strict'

var fs = require('fs')
  , util = require('util')
  , EventEmitter = require('events').EventEmitter
  , FILESIZE_TIMEOUT_MS = 15 * 1000	         // if no change in size for 15 seconds consider done
  , POLL_INTERVAL_MS = 1 * 1000; // 1 second watch interval

/**
 * this file is used to monitor an active upload, and detect when a file has stopped being updated
 *
 * emits 'change' events that include file stats and change speed in kbps
 *
 * @param {string} filepath - absolute path of file to watch
 * @param {function} callback - called once x seconds have gone by with no change in filesize
 *
 */
 
var FileWatcher = module.exports = function(filepath, callback) {
	if (!(this instanceof FileWatcher)) return new FileWatcher(filepath, callback);
	
	EventEmitter.call(this);
	
	var self = this;
	
	this.filepath = filepath;
	this.callback = callback || function () {};

	this.lastWriteTime = Date.now();
	
	// get starting file data then run watcher / polling
	fs.stat(filepath, function (err, stats) {
		if (err) {
			// don't do anything -- file may not be created yet
		}
		
		// watch for any file changes using node's built in method
		var watchOpts = {persistent: false, interval: FileWatcher.POLL_INTERVAL_MS};
		
		fs.watchFile(filepath, watchOpts, function (currentStats, previousStats) {
			var isModified = currentStats.mtime - previousStats.mtime
				, sizeDelta = currentStats.size - previousStats.size
				, isSizeDifferent = !!sizeDelta
				, now = Date.now()
				, writeKbps = (sizeDelta / (now - self.lastWriteTime)) * (1000/1024)
			
			if (isModified) self.emit('modified', currentStats);
			
			if (isSizeDifferent) self.lastWriteTime = now;
			
			self.emit('change', writeKbps);
			
		});
		
		// poll file statistics (node's watch implementation is buggy)
		self.checkForWrites(stats);
	});
	
	return this;
}

util.inherits(FileWatcher, EventEmitter);

/**
 * Check to see if filesize has changed since last called
 */
FileWatcher.prototype.checkForWrites = function (previousStats) {
	var self = this
		, filepath = this.filepath
		, previousSize = previousStats && previousStats.size;
	
	if (this.checkWriteTimer) {
		clearTimeout(this.checkWriteTimer);
		delete this.checkWriteTimer;
	}
	
	this.checkWriteTimer = setTimeout(fs.stat.bind(fs, filepath, function (err, currentStats) {
		if (err) {
			self.emit('fail', err);
			self.callback(err);
			return;
		}
		
		var isSizeDifferent = currentStats.size - previousSize
			, isTimeoutElapsed = (Date.now() - self.lastWriteTime) > FileWatcher.FILESIZE_TIMEOUT_MS;
		
		if (isTimeoutElapsed && !isSizeDifferent) {
			
			// writing is complete -- filesize has stayed the same
			self.emit('complete', currentStats.size);
			self.callback(null, currentStats);
			
		} else {
			
			// run listen cycle again
			self.checkForWrites.call(self, currentStats);
			
		}
		
	}), FileWatcher.FILESIZE_TIMEOUT_MS);
}

FileWatcher.prototype.close = function() {
	if (this.checkWriteTimer) clearTimeout(this.checkWriteTimer);
	fs.unwatchFile(this.filepath, this.listener);
	
	return this;
}
	
// TODO make this defaults / configurable on an instance level
FileWatcher.FILESIZE_TIMEOUT_MS = FILESIZE_TIMEOUT_MS; // allow changing at runtime
FileWatcher.POLL_INTERVAL_MS = POLL_INTERVAL_MS;
