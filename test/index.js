var util = require('util'),
		TestServer = require('./server'),
		JsFtp = require('jsftp'),
		fs = require('fs'),
		EventEmitter = require('events').EventEmitter;

// robot is running the tests
var robot = new EventEmitter();
robot.queue = [];
robot.next = function (message) {
	console.log(message);
	fn = robot.queue.shift();
	if(fn) {
		fn();
	} else {
		console.log('test complete!');
		robot.client.destroy();
		testServer.close();;
	}
}
robot.die = function(err) {
	console.error('OH NOS!');
	throw (err instanceof Error) ? err : new Error(err);
}

robot.testString = "around the world\naround the world\naround the world";
robot.testFilename = "hello.txt";


var cfg = {
	debugging: 10,
	root: './data',
	port: 21,
	host: '127.0.0.1',
	onReady: function() {
		robot.next("beginning tests");
	},
	onError: function(e) {
		console.error("unable to start server");
		robot.die(e);
	}
};

var testServer = new TestServer(cfg);

robot.queue = [
	function() {
		robot.client = new JsFtp({
			host: '127.0.0.1',
			port: 21,
			user: 'testuser',
			pass: 'testtesttest',
			onConnect: robot.next,
			onError: robot.die
		});
	},
	function() { // list
		robot.client.list('.', function(err, buff) {
			if(err) {
				robot.die(err);
			} else {
				robot.next("got dir contents\n" + buff.toString('ascii') )
			}
		});
	},
	function() { // store
		console.log("sending", robot.testString);
		robot.client.put( robot.testFilename, robot.testString, function(err, data) {
			if(err) {
				robot.die(err);
			} else {
				robot.next("Successful upload\n" + data.toString());
			}
		});
	},
	function() { // get
		robot.client.get('hello.txt', function(err, data) {
			var str = (data || '').toString('ascii');
			
			if(err) {
				robot.die(err);
			} else if ( str != robot.testString ) {
				console.log("\nFILE MISMATCH\n", robot.testString, str);
			} else {
				console.log("FILES MATCH");
				robot.next("retrieved: " + str);
			}
		});
	},
];

console.log('TEST','running');