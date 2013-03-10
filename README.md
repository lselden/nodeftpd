# FTP Server -- FTP server

A ftp server for node that supports most necessary commands (get, put, list, remove, etc).  The filesystem is abstracted, and unlike other ftp implementations for node works on Windows (should also work on UNIX, but haven't fully tested).

## Install

## Usage

ftpd = require('ftp-server');

var ftpServer = ftpd.createServer(
	host: '127.0.0.1',
	port: 21,
	root: './data'
);

See test directory for example usage.

## Paternity

This is a merge of two related Node Ftp Server implementations:
[@alanszlosek 's from GitHub](https://github.com/alanszlosek/nodeftpd)
[@naholyr 's from GitHub](https://github.com/naholyr/node-ftp-server)
