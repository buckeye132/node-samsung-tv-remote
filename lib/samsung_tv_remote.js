var debug = require('debug')('node-samsung-tv-remote:SamsungTvRemote');
var net = require('net');

var PORT = 55000;
var SO_AUTHENTICATE_TIMEOUT = 300 * 1000; // Socket read timeout while authenticating (waiting for user response) in milliseconds.
var APP_STRING = "iphone.iapp.samsung";
var IDLE_TIMEOUT = 3000;

var ALLOWED = "64000100"; // TV return payload.
var DENIED = "64000000";
var TIMEOUT = "6500";

var NAME = 'node-remote';

function SamsungTvRemote(ip) {
	var self = this;
	self.ip = ip;
	self.authed = false;
	self.authInProgress = false;
	self.storedCommand = null;

	self.socket = new net.Socket();
	self.socket.setTimeout(IDLE_TIMEOUT);

	reconnectAndAuthenticate(self);
}

SamsungTvRemote.prototype.sendKeycode = function(keycode) {
	var self = this;

	var keycodeString = String.fromCharCode(0x00);
	keycodeString += prepStringToSend(APP_STRING);
	keycodeString += prepStringToSend(getKeycodePayload(keycode));

	debug("Sending keycode string: %s", Buffer.from(keycodeString).toString('hex'));

	if (self.authed) {
		self.socket.write(keycodeString);
	} else if (!self.authInProgress) {
		debug("Attempted to send keycode when not authed, saving and attempting auth");
		self.storedCommand = keycodeString;
		reconnectAndAuthenticate(self);
	} else {
		debug("Attempted to send keycode while socket connecting");
		self.storedCommand = keycodeString;
	}
};

/*
 * helpers
 */

function reconnectAndAuthenticate(remote) {
	if (!remote.authed) {
		debug("Reconnecting socket");
		remote.authInProgress = true;
		remote.socket.connect(PORT, remote.ip, function() {
			debug("Connected");
			remote.socket.setTimeout(IDLE_TIMEOUT);

			// send authentication
			var localIp = remote.socket.localAddress;

			debug("Authenticating with ip: %s, id: %s, name: %s.", localIp, localIp, NAME);
			var authString = String.fromCharCode(0x00);
			authString += prepStringToSend(APP_STRING);
			authString += prepStringToSend(getAuthenticationPayload(localIp, localIp, NAME));

			debug("Authentication Message: %s", Buffer.from(authString).toString('hex'));
			remote.socket.write(authString);
			remote.authInProgress = true;
		});

		// setup event listeners
		remote.socket.on('data', function(data) {
			debug("Data Recieved: " + data.toString('hex'));
			checkForAuthSuccess(remote, parseMsgFromBuf(data));
			if (remote.authed && remote.storedCommand) {
				debug("Sending saved command");
				remote.socket.write(remote.storedCommand);
				remote.storedCommand = null;
			}
		});
		remote.socket.on('close', function(had_err) {
			debug("Socket closed");
			remote.authed = false;
			remote.authInProgress = false;
		});
		remote.socket.on('error', function(err) {
			debug("Socket error: %s", err);
		});
		remote.socket.on('timeout', function() {
			debug("Socket timeout");
			remote.socket.end();
		});
	}
}

function prepStringToSend(string) {
	var lengthBuf = Buffer.alloc(2);
	lengthBuf.writeUInt16LE(string.length);

	var result = lengthBuf.toString();
	result += string;

	return result;
}

function prepBase64StringToSend(string) {
	return prepStringToSend(Buffer.from(string).toString('base64'));
}

function getAuthenticationPayload(ip, id, name) {
	var result = String.fromCharCode(0x64);
	result += String.fromCharCode(0x00);
	result += prepBase64StringToSend(ip);
	result += prepBase64StringToSend(id);
	result += prepBase64StringToSend(name);
	return result;
}

function parseMsgFromBuf(buf) {
	var headerLength = buf.readUInt16LE(1);
	var headerString = buf.slice(3, 3 + headerLength).toString('utf-8');
	var payloadLength = buf.readUInt16LE(3 + headerLength);
	var payload = buf.slice(3 + 2 + headerLength, 3 + 2 + headerLength + payloadLength);

	debug("Recieved message - %s:%s", headerString, payload.toString('hex'));

	return {
		header: headerString,
		payload: payload
	};
}

function checkForAuthSuccess(self, msg) {
	var payload = msg.payload.toString('hex');

	if (payload === ALLOWED) {
		debug("Auth success");
		self.authed = true;
		self.authInProgress = false;
	} else if (payload === DENIED) {
		debug("Auth denied");
		self.authed = false;
		self.authInProgress = false;
	} else if (payload === TIMEOUT) {
		debug("Auth timeout");
		self.authed = false;
		self.authInProgress = false;
	}
}

function getKeycodePayload(keycode) {
	var result = String.fromCharCode(0x00);
	result += String.fromCharCode(0x00);
	result += String.fromCharCode(0x00);
	result += prepBase64StringToSend(keycode);

	return result;
}

exports.SamsungTvRemote = SamsungTvRemote;