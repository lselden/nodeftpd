'use strict';

var util = require('util')
	, path = require('path')
	, fs = require('fs')
	, stream = require('stream');

var FtpError = module.exports.FtpError = function (code, message) {
	this.code = code || 550;
	this.message = message || 'Error';
};

util.inherits(FtpError, Error);
FtpError.prototype.name = 'Ftp Error';


/**
 * FileSystem is a virtual wrapper over the actual filesystem.
 * In this implementation it's used to emulate a UNIX filesystem
 * on Windows machines.  It *should* still work on UNIX, but
 * I haven't tested.
 *
 * Be sure to set root in options.  Otherwise uses current working directory.
 *
 */
var FileSystem = function (options) {
	var self = this
		, option, keys;
	
	options || (options = {});
	
	this.options = {};
	
	keys = Object.keys(this.defaultOptions).concat(Object.keys(options));
	
	keys.forEach(function (key) {
		self.options[key] = (key in options) ? options[key] : self.defaultOptions[key];
	});
	
	this.root = this.options.root;
	
	this.cwd = this.options.cwd;
	
	return this;
};

(function () {
	this.defaultOptions = {
		root: '.',
		cwd: '',
		autocreateDirectories: true
	};

	this.relative = function (unsanitizedPath) {
		// sanitize to restrict to root directory
		// if path starts with slash then don't use cwd
		var unixPath = /^([\/\\]|\w:)/.test(unsanitizedPath) 
					? path.join('/', unsanitizedPath)
					: path.join('/', this.cwd, unsanitizedPath)
			, relativePath = unixPath.replace(/^([\/\\]+)/, '');
			
		return relativePath;
	};
	
	this.resolve = function (p) {
		var absolutePath = path.resolve(this.root, this.relative(p))
		// ensure root as limit
			, relativeToRoot = path.relative(path.resolve(this.root), absolutePath);
		
		if ( /\.\./.test(relativeToRoot) ) return null;
		
		return absolutePath;
	};
	
	this.pwd = function (callback) {
		var unixPath = '/' + this.cwd.replace(path.sep, '/');
		if (callback) callback(null, unixPath);
		else return unixPath;
	};
	
	this.chdir = function (dir, callback) {
		callback = callback || function () {};
		
		var absoluteDir = this.resolve(dir);
		
		if (!fs.existsSync(absoluteDir)) {
			if (this.options.autocreateDirectories) {
				try {
					this.mkdir(dir);
				} catch (e) {
					callback( new FtpError(431, "No such directory") );
					return;
				}
			} else {
				callback( new FtpError(431, "No such directory") );
				return;
			}
		}
		
		this.cwd = this.relative(dir);
		callback( null, this.pwd() );
		
		return this.pwd();		
	};
	
	this.mkdir = function (dir, callback) {
		var self = this
			, dirParts = this.relative(dir).split('/')
				// [x,y,z] becomes [x, x/y, x/y/z]
			, dirs = dirParts.reduce(function (memo, dir) {
					return (memo) ? memo.concat( memo.slice(-1) + path.sep + dir ) : [dir];
				}, null);
				
		callback || (callback = function(err, res) { if (err) throw e; });
		
		try {
			dirs.forEach(function (dir) {
				var absoluteDir = self.resolve(dir)
					, exists = fs.existsSync(absoluteDir);
				if (!exists) {
					// TODO use async instead -- would require recursion instead of for loop
					fs.mkdirSync(absoluteDir);
				}
			});
		} catch (e) {
			callback(e);
			return;
		}
		
		callback();
	};
	
	this.exists = function (name, callback) {
		var exists = fs.existsSync( this.resolve(name) );
		if (callback) callback(exists);
		return exists;		
	};
	
	this.rename = function (oldPath, newPath, callback) {
		callback(new FTPError(431, "rename not implemented yet"));
	};
	

	/* LIST helper functions */

	// one liner to left pad a string to given length
	// TODO ninja-foo -- maybe make this clearer?
	var lpad = function (str, len) {
		return (0).toPrecision(len-1).replace(/./g, ' ').slice(0,-(str+'').length).concat(str);
	};

	// convert date to UNIX str
	// TODO - not clear - maybe expand out or use date library rather than ninja-foo
	var formatDate = function (date) {
		date = (date instanceof Date) ? date : new Date(date);
		return [
			date.toDateString().replace(
				/(\S+)\s(\S+)\s(\d+)\s(\d+)/, // Wed Jan 09 2012
				function (str, day, m, d, y) { return [m, d.replace(/^0/,' ')].join(' '); }
			),
			date.toTimeString().slice(0, 5)	
		].join(' ');
	};
	
	var bitmasks = [
		[16384, 'd'], // 0040000 directory
		[256, 'r'], [128, 'w'], [64, 'x'], // 0400, 0200, 0100
		[32, 'r'], [16, 'w'], [8, 'x'],
		[4, 'r'], [2, 'w'], [1, 'x']
	];
	
	/**
	 * list - reads directory and outputs contents
	 * IMPORTANT NOTE: this implementation uses the old version of Streams,
	 * and may not be fully compatible with node > 0.9.1 and above.
	 * The alternative is to use the syncronous (blocking) method, which is commented out.
	 */
	this.list = function (directory, callback) {
		var self = this;
		
		directory = this.resolve(directory);
		
		if (!this.exists(directory)) {
			callback( new FtpError(431, "No such directory") );
			return;
		}
		
		var output = new stream.Readable();
		// var output = new stream.Stream();
		//var output = []; // sync
		output._read = function(size) { }; // we're pushing ourselves

		
		fs.readdir(directory, function (err, files) {
			if (err) {
				output.emit('error', new FtpError(451, "Error reading directory contents") );
				return;
			}
			
			// empty directory
			if (!files.length) {
				//output.emit('end');
				output.push(null);
			}
			
			files.forEach(function (filename) {
				var filepath = path.join(directory, filename)
					, stats = fs.statSync(filepath)
					, line = [];
				
				// set permissions
				bitmasks.forEach(function (mask) {
					line.push( (mask[0] & stats.mode) ? mask[1] : '-' );
				});
				
				// don't pass user/group information (pad names to 8 chars
				line.push("    1 ftp      ftp      ");
				line.push(lpad(stats.size, 8), " " );
				line.push(formatDate(stats.mtime), " " );
				line.push(filename, "\r\n");
				
				//output.emit('data', line.join(''), 'ascii' );
				output.push(line.join(''));
				//output.push( line.join('') ); // sync
			});
			//output.emit('data', '\r\n'); // sync
			//output.emit('end');
			output.push(null); // end equivalent
			// callback(null, output.join('\r\n') + '\r\n'); // sync
		});

		// return stream		
		callback(null, output);
	};
	
	this.readFile = function (file, callback) {
	  var self = this
			, target = this.resolve(file);
		
		fs.stat(target, function (err, stats) {
			if (err || !stats.isFile()) {
				callback( new FtpError(431, "No such file") );
				return;
			}
				
			var stream = fs.createReadStream(target);
			//stream.on('error', function () {
			//	callback( new FtpError(451, "Error reading file") );
			//});
			
			callback(null, stream);
		
		});
	};
	
	this.writeFile = function (file, callback) {
		var self = this
			, target = this.resolve(file)
			, stream = fs.createWriteStream(target);
		
		callback(null, stream);
	};
	
	this.unlink = function (file, callback) {
		var target = this.resolve(file);
		fs.unlink(target, callback);
	};
	
}).call(FileSystem.prototype);

//all cb return err, data

module.exports.FileSystem = FileSystem;